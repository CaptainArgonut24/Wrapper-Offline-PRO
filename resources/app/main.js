/**
 * Wrapper: Offline
 * License: MIT
 */
// assign config and env.json stuff to process.env
const env = Object.assign(process.env, require("./env"), require("./config"));
// modules
const { app, BrowserWindow, Menu, session, dialog } = require("electron");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
// vars
const assets = path.join(__dirname, env.ASSET_FOLDER);
const cache = path.join(__dirname, env.CACHÉ_FOLDER);
const saved = path.join(__dirname, env.SAVED_FOLDER);
const installId = crypto.createHash("sha256")
	.update(path.resolve(__dirname))
	.digest("hex")
	.slice(0, 16);
const browserPartition = `persist:wrapper-browser-${installId}`;
process.env.BROWSER_PARTITION = browserPartition;
process.env.BROWSER_INSTALL_ID = installId;

/**
 * initialization
 */
// create directories if they're missing
if (!fs.existsSync(assets)) fs.mkdirSync(assets);
if (!fs.existsSync(cache)) fs.mkdirSync(cache);
if (!fs.existsSync(saved)) fs.mkdirSync(saved);
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
let browserWindow;
let browserWindowReady = false;
let pendingBrowserUrls = [];
function openBrowserTabInWindow(url, discordConfirmed, title) {
	if (!browserWindowReady || !browserWindow || browserWindow.isDestroyed()) {
		pendingBrowserUrls.push({ url, discordConfirmed, title });
		return;
	}
	browserWindow.webContents.executeJavaScript(
		`window.openBrowserTab(${JSON.stringify(url)}, ${discordConfirmed}, ${JSON.stringify(title)})`
	).catch(error => {
		console.error("Unable to open a browser tab:", error);
	});
}
function setupBrowserDownloads() {
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
			(target.pathname == "/browser" || target.pathname == "/player")) {
			event.preventDefault();
			const isPlayer = target.pathname == "/player";
			if (!isPlayer && browserWindow && !browserWindow.isDestroyed()) {
				browserWindow.show();
				browserWindow.focus();
				const startUrl = target.searchParams.get("startUrl");
				if (startUrl) {
					const discordConfirmed = target.searchParams.get("discordConfirmed") == "1";
					const title = target.searchParams.get("startTitle") || "";
					openBrowserTabInWindow(startUrl, discordConfirmed, title);
				}
				return;
			}
			const newWindow = new BrowserWindow({
				width: 1200,
				height: 800,
				title: isPlayer ? "Video Player - Wrapper: Offline" : "Wrapper Browser",
				icon: path.join(__dirname, "./server/favicon.ico"),
				parent: mainWindow,
				webPreferences: {
					contextIsolation: true,
					webviewTag: !isPlayer,
					plugins: isPlayer
				}
			});
			if (!isPlayer) {
				browserWindow = newWindow;
				browserWindowReady = false;
				pendingBrowserUrls = [];
				newWindow.webContents.once("did-finish-load", () => {
					browserWindowReady = true;
					for (const pending of pendingBrowserUrls) {
						openBrowserTabInWindow(pending.url, pending.discordConfirmed, pending.title);
					}
					pendingBrowserUrls = [];
				});
			}
			newWindow.loadURL(target.href).catch(error => {
				console.error(`Unable to open the ${isPlayer ? "video player" : "built-in browser"}:`, error);
			});
			if (!isPlayer) {
				newWindow.on("closed", () => {
					if (browserWindow == newWindow) {
						browserWindow = null;
						browserWindowReady = false;
						pendingBrowserUrls = [];
					}
				});
			}
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
	setupBrowserDownloads();
	// wait for the server
	setTimeout(createWindow, 2000);
});
app.on("window-all-closed", () => {
	if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
	if (mainWindow === null) createWindow();
});
