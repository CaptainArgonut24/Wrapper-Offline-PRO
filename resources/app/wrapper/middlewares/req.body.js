const formidable = require("formidable");
const httpz = require("@octanuary/httpz")

/**
 * request body
 * @param {httpz.Request} req
 * @param {httpz.Response} res
 * @param {Function} next 
 * @returns {void}
 */
module.exports = async function reqBody(req, res, next) {
	req.body = {};
	const isCustomVoiceImport = req.method == "POST" &&
		req.url.split("?")[0] == "/api/tts/custom-voices/import";
	if (req.method == "POST")
		await new Promise(resolve =>
			new formidable.IncomingForm(isCustomVoiceImport ? {
				maxFileSize: 2 * 1024 * 1024 * 1024
			} : {}).parse(req, (error, fields, files) => {
				req.body = fields || {};
				req.files = files || {};
				if (error && isCustomVoiceImport) req.bodyParsingError = error;
				resolve();
			}
		));
	next();
};
