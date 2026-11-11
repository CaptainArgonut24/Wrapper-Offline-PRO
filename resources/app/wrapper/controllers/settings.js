/**
 * setting routes
 */
// modules
const httpz = require("@octanuary/httpz")
// stuff
const database = require("../../data/database"), DB = new database(true);

// create the group
const group = new httpz.Group();

group
	// list
	.route("GET", "/api/settings/list", (req, res) => {
		res.json(DB.select());
	})
	// update
	.route("POST", "/api/settings/update", (req, res) => {
		const { setting } = req.body;
		// convert true or false to a boolean
		const value = req.body.value == "true" ? true : 
			req.body.value == "false" ? false : req.body.value;
		res.assert(
			setting,
			typeof value != "undefined",
			400, { status: "error" }
		);

		const db = DB.select();
		// check if the setting exists
		res.assert(setting in db, 400, { status: "error" });

		if (setting == "LINK_BROWSER" && !["system", "wrapper"].includes(value)) {
			res.statusCode = 400;
			res.json({ status: "error", message: "Invalid browser selection." });
			return;
		}
		if (setting == "LINK_BROWSER_PROFILE" &&
			(typeof value != "string" || !/^[a-zA-Z0-9_-][a-zA-Z0-9 _-]{0,39}$/.test(value.trim()))) {
			res.statusCode = 400;
			res.json({ status: "error", message: "Profile names must be 1-40 letters, numbers, spaces, underscores, or hyphens." });
			return;
		}

		db[setting] = setting == "LINK_BROWSER_PROFILE" ? value.trim() : value;
		if (!DB.save(db)) {
			res.statusCode = 500;
			res.json({ status: "error" });
			return;
		}
		res.json({ status: "ok" });
	});

module.exports = group;
