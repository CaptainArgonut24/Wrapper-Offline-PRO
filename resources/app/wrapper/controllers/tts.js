/**
 * tts routes
 */
const crypto = require("crypto");
const fs = require("fs");
const httpz = require("@octanuary/httpz");
const path = require("path");
const tempfile = require("tempfile");
const { pipeline } = require("stream");
const { promisify } = require("util");
const info = require("../data/voices");
const Asset = require("../models/asset");
const database = require("../../data/database");
const fileUtil = require("../../utils/realFileUtil");
const processVoice = require("../models/tts");
const convertWithRvc = require("../models/rvc");

const group = new httpz.Group();
const DB = new database();
const savedFolder = path.join(__dirname, "../../", process.env.SAVED_FOLDER);
const customVoiceFolder = path.join(savedFolder, "custom-voices");
const pipelineAsync = promisify(pipeline);
const MAX_MODEL_SIZE = 2 * 1024 * 1024 * 1024;
const MAX_MANIFEST_SIZE = 256 * 1024;

function xmlEscape(value) {
	return String(value == null ? "" : value)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

function customVoices() {
	return DB.select().customVoices || [];
}

function getVoiceMap() {
	const voices = Object.assign({}, info.voices);
	for (const custom of customVoices()) {
		const sourceVoice = info.voices[custom.sourceVoice];
		if (!sourceVoice) continue;
		voices[`custom_${custom.id}`] = {
			...sourceVoice,
			desc: custom.name,
			source: "custom_rvc",
			custom
		};
	}
	return voices;
}

function voiceListXml() {
	const voices = getVoiceMap();
	const languages = {};
	for (const [id, voice] of Object.entries(voices)) {
		const language = voice.language;
		languages[language] = languages[language] || [];
		languages[language].push(
			`<voice id="${xmlEscape(id)}" desc="${xmlEscape(voice.desc)}" sex="${xmlEscape(voice.gender)}" demo-url="" country="${xmlEscape(voice.country)}" plus="N"/>`
		);
	}
	return `${process.env.XML_HEADER}<voices>${
		Object.keys(languages).sort().map(language => {
			const label = info.languages[language] || language;
			return `<language id="${xmlEscape(language)}" desc="${xmlEscape(label)}">${languages[language].join("")}</language>`;
		}).join("")
	}</voices>`;
}

function getUpload(files, name) {
	const file = files && files[name];
	return Array.isArray(file) ? file[0] : file;
}

function badRequest(message) {
	const error = new Error(message);
	error.statusCode = 400;
	return error;
}

function unlinkUpload(file) {
	if (file && file.filepath && fs.existsSync(file.filepath)) {
		try {
			fs.unlinkSync(file.filepath);
		} catch (error) {
			console.error("Unable to remove temporary custom voice upload:", error);
		}
	}
}

function removeVoiceFiles(id) {
	if (!/^[a-f0-9]{16}$/.test(id)) return;
	const directory = path.join(customVoiceFolder, id);
	for (const filename of ["model.pth", "features.index"]) {
		const filepath = path.join(directory, filename);
		if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
	}
	if (fs.existsSync(directory)) fs.rmdirSync(directory);
}

function moveUpload(file, target) {
	try {
		fs.renameSync(file.filepath, target);
	} catch (error) {
		if (error.code != "EXDEV") throw error;
		fs.copyFileSync(file.filepath, target);
		fs.unlinkSync(file.filepath);
	}
}

function validatedSite(value) {
	const site = String(value || "").trim();
	if (!site) return "";
	let url;
	try {
		url = new URL(site);
	} catch (error) {
		throw badRequest("Site must be a valid HTTP or HTTPS URL.");
	}
	if (!["http:", "https:"].includes(url.protocol)) {
		throw badRequest("Site must be a valid HTTP or HTTPS URL.");
	}
	return url.href.slice(0, 2048);
}

function publicVoice(voice) {
	return {
		id: voice.id,
		name: voice.name,
		sourceVoice: voice.sourceVoice,
		site: voice.site,
		source: voice.source,
		ecf: voice.ecf,
		hasIndex: voice.hasIndex
	};
}

function errorXml(message) {
	return `1<error><code>ERR_ASSET_404</code><message>${xmlEscape(message)}</message><text></text></error>`;
}

group
	.route("GET", "/api/tts/source-voices", (req, res) => {
		res.json(Object.entries(info.voices).map(([id, voice]) => ({
			id,
			name: voice.desc,
			language: voice.language
		})));
	})
	.route("GET", "/api/tts/custom-voices", (req, res) => {
		res.json(customVoices().map(publicVoice));
	})
	.route("POST", "/api/tts/custom-voices/import", (req, res) => {
		const model = getUpload(req.files, "model");
		const index = getUpload(req.files, "index");
		const manifestFile = getUpload(req.files, "manifest");
		let voiceDirectory;
		try {
			if (req.bodyParsingError) {
				const error = req.bodyParsingError;
				error.statusCode = error.httpCode || 400;
				throw error;
			}
			if (!model || !model.filepath || path.extname(model.originalFilename || "").toLowerCase() != ".pth") {
				throw badRequest("Choose an RVC .pth model file.");
			}
			if (index && path.extname(index.originalFilename || "").toLowerCase() != ".index") {
				throw badRequest("The optional RVC index file must use the .index extension.");
			}
			if (fs.statSync(model.filepath).size > MAX_MODEL_SIZE ||
				(index && fs.statSync(index.filepath).size > MAX_MODEL_SIZE)) {
				throw badRequest("RVC model and index files must each be 2 GB or smaller.");
			}
			if (req.body.voiceConsent != "true") {
				throw badRequest("Confirm that you have permission to use this voice model.");
			}

			let manifest = {};
			if (manifestFile) {
				if (path.extname(manifestFile.originalFilename || "").toLowerCase() != ".json" ||
					fs.statSync(manifestFile.filepath).size > MAX_MANIFEST_SIZE) {
					throw badRequest("Voice definition files must be JSON and smaller than 256 KB.");
				}
				manifest = JSON.parse(fs.readFileSync(manifestFile.filepath, "utf8"));
				if (!manifest || typeof manifest != "object" || Array.isArray(manifest)) {
					throw badRequest("Voice definition JSON must contain an object.");
				}
			}

			const name = String(req.body.name || manifest.name || "").trim();
			const sourceVoice = String(req.body.sourceVoice || manifest.sourceVoice || "").trim();
			if (!name || name.length > 80) {
				throw badRequest("Enter a voice name between 1 and 80 characters.");
			}
			if (!Object.prototype.hasOwnProperty.call(info.voices, sourceVoice)) {
				throw badRequest("Choose an existing TTS voice to use as the source speech.");
			}
			const site = validatedSite(req.body.site || manifest.site);
			const source = String(req.body.source || manifest.source || "").trim().slice(0, 500);
			const ecf = String(req.body.ecf || manifest.ecf || "").trim().slice(0, 500);
			const id = crypto.randomBytes(8).toString("hex");
			voiceDirectory = path.join(customVoiceFolder, id);
			fs.mkdirSync(voiceDirectory, { recursive: true });
			moveUpload(model, path.join(voiceDirectory, "model.pth"));
			if (index) moveUpload(index, path.join(voiceDirectory, "features.index"));

			const data = DB.select();
			data.customVoices = data.customVoices || [];
			data.customVoices.push({
				id,
				name,
				sourceVoice,
				site,
				source,
				ecf,
				hasIndex: Boolean(index)
			});
			if (!DB.save(data)) {
				throw new Error("Unable to save the custom voice catalog.");
			}
			res.json({ status: "ok", voice: publicVoice(data.customVoices[data.customVoices.length - 1]) });
		} catch (error) {
			console.error("Unable to import a custom RVC voice:", error);
			if (voiceDirectory && fs.existsSync(voiceDirectory)) {
				const id = path.basename(voiceDirectory);
				try {
					removeVoiceFiles(id);
				} catch (cleanupError) {
					console.error("Unable to clean up failed custom voice import:", cleanupError);
				}
			}
			res.statusCode = error.statusCode || error.httpCode ||
				(error instanceof SyntaxError ? 400 : 500);
			res.json({ status: "error", message: error.message || "Unable to import this voice." });
		} finally {
			unlinkUpload(model);
			unlinkUpload(index);
			unlinkUpload(manifestFile);
		}
	})
	.route("POST", "/api/tts/custom-voices/delete", (req, res) => {
		const id = String(req.body.id || "");
		if (!/^[a-f0-9]{16}$/.test(id)) {
			res.statusCode = 400;
			res.json({ status: "error", message: "Invalid custom voice ID." });
			return;
		}
		const data = DB.select();
		const voices = data.customVoices || [];
		const index = voices.findIndex(voice => voice.id == id);
		if (index < 0) {
			res.statusCode = 404;
			res.json({ status: "error", message: "Custom voice not found." });
			return;
		}
		data.customVoices.splice(index, 1);
		if (!DB.save(data)) {
			res.statusCode = 500;
			res.json({ status: "error", message: "Unable to remove the custom voice." });
			return;
		}
		try {
			removeVoiceFiles(id);
		} catch (error) {
			console.error("Unable to remove custom voice model files:", error);
			res.statusCode = 500;
			res.json({ status: "error", message: "The voice was removed from the list, but its model files could not be deleted." });
			return;
		}
		res.json({ status: "ok" });
	})
	.route("POST", "/goapi/getTextToSpeechVoices/", (req, res) => {
		res.setHeader("Content-Type", "text/html; charset=UTF-8");
		res.end(voiceListXml());
	})
	.route("POST", "/goapi/convertTextToSoundAsset/", async (req, res) => {
		const { voice, text } = req.body;
		if (!voice || !text) {
			res.statusCode = 400;
			res.end(errorXml("Choose a voice and enter text."));
			return;
		}

		let filepath;
		try {
			const voices = getVoiceMap();
			const selectedVoice = voices[voice];
			if (!selectedVoice) throw new Error("The voice you requested is unavailable.");
			const readStream = selectedVoice.custom ?
				await convertWithRvc(await processVoice(selectedVoice.custom.sourceVoice, text), selectedVoice.custom) :
				await processVoice(voice, text);
			filepath = tempfile(".mp3");
			await pipelineAsync(readStream, fs.createWriteStream(filepath));
			const duration = await fileUtil.mp3Duration(filepath);
			const title = `[${selectedVoice.desc}] ${String(text).slice(0, 180)}`;
			const meta = { duration, type: "sound", subtype: "tts", title };
			const id = await Asset.save(filepath, "mp3", meta);
			res.end(`0<response><asset><id>${xmlEscape(id)}</id><enc_asset_id>${xmlEscape(id)}</enc_asset_id><type>sound</type><subtype>tts</subtype><title>${xmlEscape(title)}</title><published>0</published><tags></tags><duration>${duration}</duration><downloadtype>progressive</downloadtype><file>${xmlEscape(id)}</file></asset></response>`);
		} catch (error) {
			console.error("Error generating TTS:", error);
			res.statusCode = 500;
			res.end(errorXml(error.message || "Unable to generate speech."));
		} finally {
			if (filepath && fs.existsSync(filepath)) fs.unlinkSync(filepath);
		}
	});

module.exports = group;
