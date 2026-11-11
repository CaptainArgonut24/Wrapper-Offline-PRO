/**
 * Wrapper: Offline
 * License: MIT
 */
// assign config and env.json stuff to process.env
const env = Object.assign(process.env, require("./env"), require("./config"));
// modules
const { app, BrowserWindow, Menu, session, dialog, shell } = require("electron");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const database = require("./data/database");
const { getBrowserPartition } = require("./utils/browser");
// vars
const assets = path.join(__dirname, env.ASSET_FOLDER);
const cache = path.join(__dirname, env.CACHÉ_FOLDER);
const saved = path.join(__dirname, env.SAVED_FOLDER);
const installId = crypto.createHash("sha256")
	.update(path.resolve(__dirname))
	.digest("hex")
	.slice(0, 16);
process.env.BROWSER_INSTALL_ID = installId;

/**
 * initialization
 */
// create directories if they're missing
if (!fs.existsSync(assets)) fs.mkdirSync(assets);
if (!fs.existsSync(cache)) fs.mkdirSync(cache);
if (!fs.existsSync(saved)) fs.mkdirSync(saved);
const settings = new database(true);
// start discord rpc
const discord = require("./utils/discord");
// start the server
const server = require("./wrapper/server");
server();

/**
 * load flash player
 */
let pluginName;
switch (process.platform) {
	case "win32": {
		pluginName = "./extensions/pepflashplayer.dll";
		break;
	} case "darwin": {
		pluginName = "./extensions/PepperFlashPlayer.plugin";
		break;
	} case "linux": {
		pluginName = "./extensions/libpepflashplayer.so";
		// i don't know what this does but it makes flash work
		app.commandLine.appendSwitch("no-sandbox");
		break;
	}
}
app.commandLine.appendSwitch("ppapi-flash-path", path.join(__dirname, pluginName));
app.commandLine.appendSwitch("ppapi-flash-version", "32.0.0.371");

let mainWindow;
let browserPrivacyAccepted = false;
function isDiscordUrl(value) {
	try {
		const hostname = new URL(value).hostname.toLowerCase();
		return hostname == "discord.gg" || hostname == "discord.com" || hostname.endsWith(".discord.com");
	} catch (error) {
		return false;
	}
}
function isAllowedBrowserUrl(value) {
	try {
		return ["http:", "https:"].includes(new URL(value).protocol);
	} catch (error) {
		return false;
	}
}
function confirmBrowserPrivacy(owner) {
	if (browserPrivacyAccepted) return true;
	const options = {
		type: "info",
		title: "Built-in Browser",
		message: "Website data is stored locally",
		detail: "Websites opened in these windows may save cookies and other site data in a separate local profile for this Wrapper installation. Wrapper does not upload or share this data.",
		buttons: ["Continue", "Cancel"],
		defaultId: 0,
		cancelId: 1
	};
	const result = owner ?
		dialog.showMessageBoxSync(owner, options) :
		dialog.showMessageBoxSync(options);
	browserPrivacyAccepted = result == 0;
	return browserPrivacyAccepted;
}
function openPlainBrowserWindow(
	url,
	title,
	discordConfirmed = false,
	browserPartition = getBrowserPartition(installId, settings.select().LINK_BROWSER_PROFILE)
) {
	if (!isAllowedBrowserUrl(url)) {
		console.error("Refusing to open a non-HTTP browser URL:", url);
		return;
	}
	if (!confirmBrowserPrivacy(mainWindow)) return;
	if (isDiscordUrl(url) && !discordConfirmed) {
		const options = {
			type: "warning",
			title: "Open Discord",
			message: "You are opening a Discord page in Wrapper's built-in browser. Continue?",
			buttons: ["Continue", "Cancel"],
			defaultId: 1,
			cancelId: 1
		};
		const result = mainWindow ?
			dialog.showMessageBoxSync(mainWindow, options) :
			dialog.showMessageBoxSync(options);
		if (result != 0) return;
	}

	setupBrowserDownloads(browserPartition);
	const browserWindow = new BrowserWindow({
		width: 1200,
		height: 800,
		title: title || new URL(url).hostname,
		icon: path.join(__dirname, "./server/favicon.ico"),
		parent: mainWindow,
		webPreferences: {
			partition: browserPartition,
			contextIsolation: true,
			nodeIntegration: false,
			webviewTag: false,
			plugins: true
		}
	});
	browserWindow.webContents.on("will-navigate", (event, targetUrl) => {
		if (!isAllowedBrowserUrl(targetUrl)) {
			event.preventDefault();
			return;
		}
		if (isDiscordUrl(targetUrl)) {
			const result = dialog.showMessageBoxSync(browserWindow, {
				type: "warning",
				title: "Open Discord",
				message: "You are opening a Discord page in Wrapper's built-in browser. Continue?",
				buttons: ["Continue", "Cancel"],
				defaultId: 1,
				cancelId: 1
			});
			if (result != 0) event.preventDefault();
		}
	});
	browserWindow.webContents.on("new-window", (event, targetUrl) => {
		event.preventDefault();
		openPlainBrowserWindow(targetUrl, "", false, browserPartition);
	});
	browserWindow.loadURL(url).catch(error => {
		console.error("Unable to open the built-in browser window:", error);
		browserWindow.close();
	});
}
const browserDownloadPartitions = new Set();
function setupBrowserDownloads(browserPartition) {
	if (browserDownloadPartitions.has(browserPartition)) return;
	browserDownloadPartitions.add(browserPartition);
	const browserSession = session.fromPartition(browserPartition);
	browserSession.on("will-download", (event, item, webContents) => {
		item.pause();
		const filename = path.basename(item.getFilename());
		const ownerContents = webContents.hostWebContents || webContents;
		const owner = BrowserWindow.fromWebContents(ownerContents) || mainWindow;
		const options = {
			defaultPath: path.join(app.getPath("downloads"), filename)
		};
		const saveDialog = owner ?
			dialog.showSaveDialog(owner, options) :
			dialog.showSaveDialog(options);
		saveDialog.then(({ canceled, filePath }) => {
			if (canceled || !filePath) {
				item.cancel();
				return;
			}
			item.setSavePath(filePath);
			item.resume();
		}).catch(error => {
			console.error("Unable to choose a browser download location:", error);
			item.cancel();
		});
	});
}
const createWindow = () => {
	mainWindow = new BrowserWindow({
		width: 1200,
		height: 700,
		title: "Wrapper: Offline",
		icon: path.join(__dirname, "./server/favicon.ico"),
		webPreferences: {
			plugins: true,
			contextIsolation: true,
			webviewTag: true
		}
	});
	// use it in external scripts
	process.env.MAIN_WINDOW_ID = mainWindow.id;
	mainWindow.maximize();

	mainWindow.webContents.on("new-window", (event, url, frameName) => {
		let target;
		try {
			target = new URL(url);
		} catch (error) {
			return;
		}
		if (target.protocol == "http:" &&
			target.hostname == "localhost" &&
			target.port == String(env.SERVER_PORT) &&
			(target.pathname == "/browser" || target.pathname == "/player" ||
				target.pathname == "/chrome" || target.pathname == "/open-link")) {
			event.preventDefault();
			if (target.pathname == "/open-link") {
				const linkUrl = target.searchParams.get("url");
				if (!isAllowedBrowserUrl(linkUrl)) {
					console.error("Refusing to open a non-HTTP link:", linkUrl);
					return;
				}
				if (settings.select().LINK_BROWSER != "wrapper") {
					shell.openExternal(linkUrl).catch(error => {
						console.error("Unable to open the system default browser:", error);
					});
					return;
				}
				const profilePartition = getBrowserPartition(
					installId,
					settings.select().LINK_BROWSER_PROFILE
				);
				openPlainBrowserWindow(
					linkUrl,
					target.searchParams.get("title") || "",
					target.searchParams.get("discordConfirmed") == "1",
					profilePartition
				);
				return;
			}
			if (target.pathname == "/chrome") {
				openPlainBrowserWindow("https://www.google.com/", "Wrapper Browser");
				return;
			}
			const isPlayer = target.pathname == "/player";
			if (!isPlayer) {
				const startUrl = target.searchParams.get("startUrl");
				if (startUrl) {
					openPlainBrowserWindow(
						startUrl,
						target.searchParams.get("startTitle") || "",
						target.searchParams.get("discordConfirmed") == "1",
						getBrowserPartition(installId, settings.select().LINK_BROWSER_PROFILE)
					);
				}
				return;
			}
			const newWindow = new BrowserWindow({
				width: 1200,
				height: 800,
				title: "Video Player - Wrapper: Offline",
				icon: path.join(__dirname, "./server/favicon.ico"),
				parent: mainWindow,
				webPreferences: {
					contextIsolation: true,
					webviewTag: false,
					plugins: true
				}
			});
			newWindow.loadURL(target.href).catch(error => {
				console.error("Unable to open the video player:", error);
			});
			return;
		}
		if (frameName != "wndstudio" ||
			!/^http:\/\/localhost(?::\d+)?\/go\/character_creator(?:\/|[?#])/.test(url)) {
			return;
		}
		event.preventDefault();
		mainWindow.loadURL(url).catch(error => {
			console.error("Unable to open the character editor:", error);
		});
	});

	// initialize stuff
	// clear the menu bar
	Menu.setApplicationMenu(Menu.buildFromTemplate([]));
	// load the video list
	mainWindow.loadURL("http://localhost:4343");
	mainWindow.on("closed", () => mainWindow = null);

};

app.whenReady().then(() => {
	setupBrowserDownloads(getBrowserPartition(installId, settings.select().LINK_BROWSER_PROFILE));
	// wait for the server
	setTimeout(createWindow, 2000);
});
app.on("window-all-closed", () => {
	if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
	if (mainWindow === null) createWindow();
});
