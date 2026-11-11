const { spawn } = require("child_process");
const ffmpeg = require("fluent-ffmpeg");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { pipeline } = require("stream");
const { promisify } = require("util");
const database = require("../../data/database");

ffmpeg.setFfmpegPath(require("@ffmpeg-installer/ffmpeg").path);

const pipelineAsync = promisify(pipeline);
const settings = new database(true);
const savedFolder = path.join(__dirname, "../../", process.env.SAVED_FOLDER);

function runFfmpeg(inputPath, outputPath, configure) {
	return new Promise((resolve, reject) => {
		configure(ffmpeg(inputPath))
			.on("end", resolve)
			.on("error", reject)
			.save(outputPath);
	});
}

function runApplio(inputPath, outputPath, voice, corePath, python) {
	return new Promise((resolve, reject) => {
		const modelDirectory = path.join(savedFolder, "custom-voices", voice.id);
		const modelPath = path.join(modelDirectory, "model.pth");
		const indexPath = path.join(modelDirectory, "features.index");
		if (!fs.existsSync(modelPath)) {
			reject(new Error("The selected RVC model file is missing."));
			return;
		}

		const args = [
			corePath,
			"infer",
			"--input-path", inputPath,
			"--output-path", outputPath,
			"--pth-path", modelPath
		];
		if (voice.hasIndex && fs.existsSync(indexPath)) {
			args.push("--index-path", indexPath);
		}

		let output = "";
		let settled = false;
		const child = spawn(python, args, {
			cwd: path.dirname(corePath),
			stdio: ["ignore", "pipe", "pipe"],
			windowsHide: true
		});
		const timeout = setTimeout(() => {
			if (settled) return;
			settled = true;
			child.kill();
			reject(new Error("Applio did not finish voice conversion within 10 minutes."));
		}, 10 * 60 * 1000);
		const collectOutput = chunk => {
			output = (output + chunk.toString()).slice(-4000);
		};
		child.stdout.on("data", collectOutput);
		child.stderr.on("data", collectOutput);
		child.on("error", error => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			reject(new Error(`Unable to start Applio: ${error.message}`));
		});
		child.on("close", code => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			if (code != 0) {
				reject(new Error(`Applio voice conversion failed${output ? `: ${output.trim()}` : "."}`));
				return;
			}
			resolve();
		});
	});
}

function removeTemporaryDirectory(directory) {
	if (!fs.existsSync(directory)) return;
	try {
		for (const filename of ["source.mp3", "source.wav", "converted.wav", "converted.mp3"]) {
			const filepath = path.join(directory, filename);
			if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
		}
		fs.rmdirSync(directory);
	} catch (error) {
		console.error("Unable to clean up temporary RVC conversion files:", error);
	}
}

module.exports = async function convertWithRvc(sourceStream, voice) {
	const { APPLIO_CORE_PATH, APPLIO_PYTHON } = settings.select();
	const corePath = String(APPLIO_CORE_PATH || "").trim();
	const python = String(APPLIO_PYTHON || "python").trim();
	if (!corePath || !path.isAbsolute(corePath) || !fs.existsSync(corePath)) {
		throw new Error("Set the absolute path to Applio's core.py in Settings → Custom Voices.");
	}
	if (path.extname(corePath).toLowerCase() != ".py") {
		throw new Error("Applio path must point to its core.py command-line entry point.");
	}
	if (!python) {
		throw new Error("Set the Python command for Applio in Settings → Custom Voices.");
	}

	const directory = fs.mkdtempSync(path.join(os.tmpdir(), "wrapper-rvc-"));
	const sourceMp3 = path.join(directory, "source.mp3");
	const sourceWav = path.join(directory, "source.wav");
	const convertedWav = path.join(directory, "converted.wav");
	const convertedMp3 = path.join(directory, "converted.mp3");
	try {
		await pipelineAsync(sourceStream, fs.createWriteStream(sourceMp3));
		await runFfmpeg(sourceMp3, sourceWav, command =>
			command.audioCodec("pcm_s16le").toFormat("wav")
		);
		await runApplio(sourceWav, convertedWav, voice, corePath, python);
		if (!fs.existsSync(convertedWav) || fs.statSync(convertedWav).size == 0) {
			throw new Error("Applio completed without creating converted audio.");
		}
		await runFfmpeg(convertedWav, convertedMp3, command =>
			command.audioCodec("libmp3lame").audioBitrate("128k").toFormat("mp3")
		);
		const result = fs.createReadStream(convertedMp3);
		result.on("close", () => removeTemporaryDirectory(directory));
		return result;
	} catch (error) {
		if (fs.existsSync(directory)) removeTemporaryDirectory(directory);
		throw error;
	}
};
