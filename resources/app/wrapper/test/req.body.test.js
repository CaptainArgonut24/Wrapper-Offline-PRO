const assert = require("node:assert/strict");
const { PassThrough } = require("stream");
const reqBody = require("../middlewares/req.body");

function runMiddleware(contentType, body) {
	const req = new PassThrough();
	req.method = "POST";
	req.headers = { "content-type": contentType };
	const res = {
		statusCode: 200,
		json(value) {
			this.body = value;
		}
	};

	const result = new Promise((resolve, reject) => {
		reqBody(req, res, () => resolve({ req, res })).catch(reject);
	});
	req.end(body);
	return result;
}

describe("request body middleware", () => {
	it("parses JSON bodies used by the v2 asset API", async () => {
		const { req } = await runMiddleware(
			"application/json; charset=utf-8",
			JSON.stringify({ data: { type: "prop", themeId: "business" } })
		);

		assert.deepEqual(req.body, {
			data: { type: "prop", themeId: "business" }
		});
	});

	it("continues parsing URL-encoded legacy requests", async () => {
		const { req } = await runMiddleware(
			"application/x-www-form-urlencoded",
			"type=char&themeId=business"
		);

		assert.deepEqual(req.body, {
			type: "char",
			themeId: "business"
		});
	});

	it("rejects malformed JSON bodies", async () => {
		const { res } = await runMiddleware("application/json", "{");

		assert.equal(res.statusCode, 400);
		assert.deepEqual(res.body, {
			status: "error",
			msg: "Invalid JSON request body."
		});
	});
});
