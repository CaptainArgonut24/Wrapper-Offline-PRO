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
	if (req.method == "POST") {
		const contentType = (req.headers["content-type"] || "")
			.split(";")[0]
			.trim()
			.toLowerCase();

		if (contentType == "application/json" || contentType.endsWith("+json")) {
			const chunks = [];
			req.on("data", chunk => chunks.push(chunk));
			req.on("end", () => {
				let body;
				try {
					body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
				} catch (e) {
					res.statusCode = 400;
					res.json({
						status: "error",
						msg: "Invalid JSON request body."
					});
					return;
				}

				if (!body || typeof body != "object" || Array.isArray(body)) {
					res.statusCode = 400;
					res.json({
						status: "error",
						msg: "Invalid JSON request body."
					});
					return;
				}

				req.body = body;
				next();
			});
			return;
		}

		if (contentType == "application/x-www-form-urlencoded") {
			const chunks = [];
			req.on("data", chunk => chunks.push(chunk));
			req.on("end", () => {
				for (const [key, value] of new URLSearchParams(
					Buffer.concat(chunks).toString("utf8")
				)) {
					req.body[key] = value;
				}
				next();
			});
			return;
		}

		await new Promise((resolve, reject) =>
			new formidable.IncomingForm().parse(req, async (e, f, files) => {
				req.body = f;
				req.files = files;
				resolve();
			}
		));
	}
	next();
};
