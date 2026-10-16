/**
 * movie routes
 */
// modules
const { spawn } = require("child_process");
const fs = require("fs");
const httpz = require("@octanuary/httpz")
const path = require("path");
// stuff
const database = require("../../data/database"), DB = new database();
const Settings = new database(true);
const Movie = require("../models/movie");
const exportJobs = new Map();
const savedFolder = path.join(__dirname, "../../", process.env.SAVED_FOLDER);
const uploadThumbnail = path.join(__dirname, "../../server/pages/img/importer/video.png");
const MAX_EXPORT_JOBS = 30;

function addExportJob(job) {
	exportJobs.set(job.id, job);
	if (exportJobs.size > MAX_EXPORT_JOBS) {
		const oldestFinished = [...exportJobs.values()].find(item =>
			item.status == "complete" || item.status == "failed"
		);
		if (oldestFinished) exportJobs.delete(oldestFinished.id);
	}
}

function exportJobId() {
	return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function updateExportOutput(job, chunk) {
	job.output = (job.output + chunk.toString()).slice(-8000);
}

// create the group
const group = new httpz.Group();

group
	.route("POST", "/api/movie/upload", async (req, res) => {
		const file = req.files && req.files.import;
		res.assert(file && file.filepath, 400, { status: "error", message: "Choose a Wrapper movie ZIP file to upload." });
		if (path.extname(file.originalFilename || "").toLowerCase() != ".zip") {
			try {
				fs.unlinkSync(file.filepath);
			} catch (error) {
				console.error("Unable to remove rejected movie upload:", error);
			}
			res.status(400);
			res.json({ status: "error", message: "Movie uploads must be ZIP files." });
			return;
		}

		try {
			const movieZip = fs.readFileSync(file.filepath);
			await Movie.save(movieZip, fs.readFileSync(uploadThumbnail));
			res.redirect("/");
		} catch (error) {
			console.error("Error uploading movie:", error);
			res.status(400);
			res.json({ status: "error", message: "Unable to import this movie. Make sure it is a valid Wrapper movie ZIP containing movie.xml." });
		} finally {
			try {
				if (fs.existsSync(file.filepath)) fs.unlinkSync(file.filepath);
			} catch (error) {
				console.error("Unable to remove temporary movie upload:", error);
			}
		}
	})
	.route("POST", "/api/movies/organize", (req, res) => {
		const { id } = req.body;
		const archived = req.body.archived;
		res.assert(id, archived == "true" || archived == "false", 400, { status: "error", message: "A movie ID and archive state are required." });
		const data = DB.select();
		const movie = data.movies.find(item => item.id == id);
		res.assert(movie, 404, { status: "error", message: "Video not found." });
		movie.archived = archived == "true";
		if (!DB.save(data)) {
			res.status(500);
			res.json({ status: "error", message: "Unable to update video organization." });
			return;
		}
		res.json({ status: "ok" });
	})
	.route("POST", "/api/export/goexport", (req, res) => {
		const { id } = req.body;
		const movie = DB.select("movies").find(item => item.id == id);
		res.assert(movie, 404, { status: "error", message: "Video not found." });
		if ([...exportJobs.values()].some(job => job.status == "running")) {
			res.status(409);
			res.json({ status: "error", message: "Wait for the current GoExport job to finish before starting another export." });
			return;
		}

		const configuredPath = String(Settings.select().GOEXPORT_PATH || "").trim();
		res.assert(configuredPath, 400, { status: "error", message: "Set the GoExport executable or main.py path in Settings first." });
		let isFile = false;
		try {
			isFile = path.isAbsolute(configuredPath) && fs.statSync(configuredPath).isFile();
		} catch (error) {
			isFile = false;
		}
		if (!isFile) {
			res.status(400);
			res.json({ status: "error", message: "The configured GoExport path must be an existing absolute file path." });
			return;
		}

		const scriptMode = path.extname(configuredPath).toLowerCase() == ".py";
		if (!scriptMode && process.platform == "win32" && path.extname(configuredPath).toLowerCase() != ".exe") {
			res.status(400);
			res.json({ status: "error", message: "Choose GoExport.exe or its main.py entry point." });
			return;
		}

		const outputDirectory = path.join(savedFolder, "Exports");
		try {
			fs.mkdirSync(outputDirectory, { recursive: true });
		} catch (error) {
			res.status(500);
			res.json({ status: "error", message: `Unable to create the export directory: ${error.message}` });
			return;
		}
		const safeTitle = String(movie.title || "video")
			.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
			.replace(/[. ]+$/g, "")
			.slice(0, 100) || "video";
		const safeMovieId = String(movie.id).replace(/[^a-zA-Z0-9_-]/g, "_");
		const outputBasePath = path.join(outputDirectory, `${safeTitle}_${safeMovieId}`);
		const outputPath = `${outputBasePath}.mp4`;
		const job = {
			id: exportJobId(),
			movieId: movie.id,
			outputPath,
			status: "running",
			output: "",
			error: null
		};
		addExportJob(job);

		const executable = scriptMode ? String(Settings.select().GOEXPORT_PYTHON || "python").trim() : configuredPath;
		const args = scriptMode ? [configuredPath] : [];
		args.push(
			"--json",
			"record",
			"-id", movie.id,
			"-out", outputBasePath,
			"-f", "mp4",
			"--no-outro",
			"--url", "http://localhost:4343/",
			"--api-url", "http://localhost:4343/",
			"--swf-url", "http://localhost:4343/animation/414827163ad4eb60/player.swf",
			"--store-path", "http://localhost:4343/store/3a981f5cb2739137/<store>",
			"--client-theme-path", "http://localhost:4343/static/ad44370a650793d9/<client_theme>"
		);
		if (Settings.select().IS_WIDE == "0") args.push("--no-wide");
		let child;
		try {
			child = spawn(executable, args, {
				cwd: path.dirname(configuredPath),
				stdio: ["ignore", "pipe", "pipe"],
				windowsHide: true
			});
		} catch (error) {
			job.status = "failed";
			job.error = error.message;
			res.status(500);
			res.json({ status: "error", message: `Could not start GoExport: ${error.message}` });
			return;
		}
		child.stdout.on("data", chunk => updateExportOutput(job, chunk));
		child.stderr.on("data", chunk => updateExportOutput(job, chunk));
		child.on("error", error => {
			job.status = "failed";
			job.error = error.message;
		});
		child.on("close", code => {
			if (job.status != "failed") {
				job.status = code == 0 ? "complete" : "failed";
				if (code != 0) job.error = `GoExport exited with code ${code}.`;
			}
		});
		res.json({ status: "ok", jobId: job.id, outputPath });
	})
	.route("GET", /\/api\/export\/goexport\/([^/]+)$/, (req, res) => {
		const job = exportJobs.get(req.matches[1]);
		res.assert(job, 404, { status: "error", message: "Export job not found." });
		res.json({
			status: "ok",
			job: {
				id: job.id,
				movieId: job.movieId,
				outputPath: job.outputPath,
				state: job.status,
				output: job.output,
				error: job.error
			}
		});
	})
	.route("GET", /\/api\/export\/goexport\/([^/]+)\/file$/, (req, res) => {
		const job = exportJobs.get(req.matches[1]);
		res.assert(job, 404, { status: "error", message: "Export job not found." });
		res.assert(job.status == "complete", 409, { status: "error", message: "The export is not ready to download." });
		try {
			if (!fs.statSync(job.outputPath).isFile()) throw new Error("Export output is not a file.");
		} catch (error) {
			res.status(404);
			res.json({ status: "error", message: `Export output is unavailable: ${error.message}` });
			return;
		}
		res.setHeader("Content-Type", "video/mp4");
		res.setHeader("Content-Disposition", `attachment; filename="${path.basename(job.outputPath)}"`);
		const stream = fs.createReadStream(job.outputPath);
		stream.on("error", error => {
			console.error("Unable to stream exported video:", error);
			if (!res.headersSent) {
				res.status(500);
				res.end();
			}
		});
		stream.pipe(res);
	})
	// delete
	.route("GET", /\/api\/movie\/delete\/([^/]+)$/, async (req, res) => {
		const id = req.matches[1];

		console.log(`(Warning!) Deleting movie #${id}`);
		try {
			await Movie.delete(id);
			res.json({ status: "ok" });
		} catch (e) {
			console.error("This movie just won't die!", e);
			res.status(404);
			res.json({ status: "error" });
		}
	})
	// list
	.route("GET", "/api/movies/list", (req, res) => {
		res.json(DB.select("movies"));
	})
	// load
	.route(
		"*",
		["/goapi/getMovie/", /\/file\/movie\/file\/([^/]+)$/],
		async (req, res) => {
			const isGet = req.method == "GET";
			const id = isGet ?
				req.matches[1] :
				req.query.movieId;
			res.assert(id, 400, "");
			
			try {
				const buf = await Movie.load(id, isGet);
				res.setHeader("Content-Type", "application/zip");
				res.end(buf);
			} catch (e) {
				console.log("Error loading movie:", e);
				res.status(404);
				res.end();
			}
		}
	)
	// redirect
	.route("*", /\/videomaker\/full\/(\w+)\/tutorial$/, (req, res) => {
		const theme = req.matches[1];

		res.redirect(`/go_full?tray=${theme}&tutorial=0`);
	})

	// redirect
	.route("GET", "/dashboard/videos", (res) => {
		res.redirect(`/`);
	})
	// save
	//  #movies
	.route("POST", "/goapi/saveMovie/", async (req, res) => {
		res.assert(req.body.body_zip, 400, "1");
		const trigAutosave = req.body.is_triggered_by_autosave;
		res.assert(!(trigAutosave && !req.body.movieId), 200, "0");

		const body = Buffer.from(req.body.body_zip, "base64");
		const thumb = trigAutosave ?
			null : Buffer.from(req.body.thumbnail_large, "base64");

		const id = await Movie.save(body, thumb, req.body.movieId)
		res.end("0" + id);
	})
	//  #starter
	.route("POST", "/goapi/saveTemplate/", async (req, res) => {
		res.assert(req.body.body_zip, req.body.thumbnail_large, 400, "1");
		const body = Buffer.from(req.body.body_zip, "base64");
		const thumb = Buffer.from(req.body.thumbnail_large, "base64");

		const id = await Movie.save(body, thumb, req.body.movieId, true)
		res.end("0" + id);
	})
	// thumb
	.route("*", /\/file\/movie\/thumb\/([^/]+)$/, (req, res) => {
		const id = req.matches[1];

		const readStream = Movie.thumb(id);
		res.setHeader("Content-Type", "image/png");
		readStream.pipe(res); 
	});

module.exports = group;
