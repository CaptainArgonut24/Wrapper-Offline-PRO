function getBrowserProfileKey(profileName) {
	const profileKey = String(profileName || "Default")
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9_-]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 40);
	return profileKey || "default";
}

function getBrowserPartition(installId, profileName) {
	const profileKey = getBrowserProfileKey(profileName);
	const suffix = profileKey == "default" ? "" : `-${profileKey}`;
	return `persist:wrapper-browser-${installId}${suffix}`;
}

module.exports = { getBrowserProfileKey, getBrowserPartition };
