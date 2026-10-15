const brotli = require("brotli");
const { createGunzip, brotliDecompress } = require("zlib");
const qs = require("querystring");
const fileUtil = require("../../utils/realFileUtil");
const { convertToMp3 } = require("../../utils/fileUtil.js");
const https = require("https");
const voices = require("../data/voices.json").voices;

/**
 * uses tts demos to generate tts
 * @param {string} voiceName
 * @param {string} text
 * @returns {Promise<IncomingMessage>}
 */
module.exports = function processVoice(voiceName, rawText) {
	return new Promise((res, rej) => {
		const voice = voices[voiceName];
		if (!voice) {
			return rej("The voice you requested is unavailable.");
		}

		let flags = {};
		const pieces = rawText.split("#%");
		let text = pieces.pop().substring(0, 180);
		for (const rawFlag of pieces) {
			const index = rawFlag.indexOf("=");
			if (index == -1) continue;
			const name = rawFlag.substring(0, index);
			const value = rawFlag.substring(index + 1);
			flags[name] = value;
		}

		try {
			switch (voice.source) {
				case "polly": {
					const q = new URLSearchParams({
                        text: text,
                        voice: voice.arg,
					}).toString();

					https
						.get(`https://gospeech.replit.app/service/polly_makemp3?${q}`, res)
						.on("error", rej);
					break;
				}
				case "various1": {
					const q = new URLSearchParams({
						voice: voice.arg,
						text: text,
					}).toString();

					https.get({
						hostname: "gospeech.replit.app",
						path: `/service/seediffusion_makewav?${q}`,
					}, (r) => fileUtil.convertToMp3(r, "wav").then(res).catch(rej)).on("error", rej);
					break;
				}
				case "various2": {
					const q = new URLSearchParams({
                        text: text,
                        voice: voice.arg,
						rate: "0",
						pitch: "0",
					}).toString();

					https
						.get(`https://gospeech.replit.app/service/vampitts_makemp3?${q}`, res)
						.on("error", rej);
					break;
				}
				case "various3": {
					const q = new URLSearchParams({
                        text: text,
                        voice: voice.arg,
						provider: voice.engine,
					}).toString();

					https.get(
						{
							host: "voice.vampi.tech",
							path: `/api/synthesizeSpeech?${q}`,
							headers: {
								"Authorization": "865f6794ed7617b522af9b29275504a0"
							}
						},
						(r) => { res(r)
						}
					);
					break;
				}
				case "voiceforge": {
						const q = new URLSearchParams({
						voice: voice.arg,
						text: text,
						rate: 170,
						pitch: 1,
					}).toString();
					
					https.get({
						hostname: "gospeech.replit.app",
						path: `/service/voiceforge_makewav?${q}`,
					}, (r) => fileUtil.convertToMp3(r, "wav").then(res).catch(rej)).on("error", rej);
					break;
				}
				case "vocalware": {
						const [eid, lid, vid] = voice.arg;
						const q = new URLSearchParams({
							eid,
							lid,
							vid,
							txt: text,
						}).toString();
	
					https
						.get(`https://gospeech.replit.app/service/oddcast2_makemp3?${q}`, res)
						.on("error", rej);
					break;
				}
		        case "acapela": {
						const q = new URLSearchParams({
							text: text,
							voice: voice.arg,
							audio: "null"
						}).toString();

						https
							.get(`https://gospeech.replit.app/service/acapela_makemp3?${q}`, res)
							.on("error", rej);
						break;
					}
			case "ivona": {
				var q = qs.encode({
							text: text,
							pitch: "0",
							rate: "0",
							pauses: "0",
						}).toString();
						https
							.get(
								{
									hostname: "eric-generator.replit.app",
									path: "/" + voice.arg + "?" + q,
								}, res
							)
							.on("error", rej);
						break;
					}
			}
		} catch (e) {
			return rej(e);
		}
	});
};
