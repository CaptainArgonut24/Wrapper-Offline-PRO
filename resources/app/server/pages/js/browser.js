(() => {
	const STORAGE = {
		bookmarks: "WRAPPER_BROWSER_BOOKMARKS",
		history: "WRAPPER_BROWSER_HISTORY",
		searches: "WRAPPER_BROWSER_SEARCHES"
	};
	const tabsElement = document.getElementById("browser-tabs");
	const webviewsElement = document.getElementById("browser-webviews");
	const address = document.getElementById("browser-address");
	const backButton = document.getElementById("browser-back");
	const forwardButton = document.getElementById("browser-forward");
	const sidebar = document.getElementById("browser-sidebar");
	const sidebarTitle = document.getElementById("browser-sidebar-title");
	const sidebarContent = document.getElementById("browser-sidebar-content");
	const status = document.getElementById("browser-status");
	const browserTabs = [];
	let activeTabId = null;
	let nextTabId = 0;
	let sidebarMode = "";

	function readSaved(key) {
		try {
			const value = JSON.parse(localStorage.getItem(key) || "[]");
			return Array.isArray(value) ? value : [];
		} catch (error) {
			console.error(`Unable to read saved browser data (${key}):`, error);
			return [];
		}
	}

	let bookmarks = readSaved(STORAGE.bookmarks);
	let history = readSaved(STORAGE.history);
	let searches = readSaved(STORAGE.searches);

	function saveSaved(key, value) {
		try {
			localStorage.setItem(key, JSON.stringify(value));
		} catch (error) {
			console.error(`Unable to save browser data (${key}):`, error);
			status.textContent = "Browser data could not be saved locally.";
		}
	}

	function saveHistoryEntry(entry) {
		const previous = history[0];
		if (!previous || previous.url !== entry.url) {
			history.unshift(entry);
			history = history.slice(0, 500);
			saveSaved(STORAGE.history, history);
		} else {
			history[0] = entry;
			saveSaved(STORAGE.history, history);
		}
		if (sidebarMode == "history") renderSidebar();
	}

	function getActiveTab() {
		return browserTabs.find(tab => tab.id == activeTabId);
	}

	function normalizeAddress(value) {
		const input = value.trim();
		if (!input) return null;
		if (/^https?:\/\//i.test(input)) {
			try {
				const url = new URL(input);
				return ["http:", "https:"].includes(url.protocol) ? url.href : null;
			} catch (error) {
				return null;
			}
		}
		if (/^[a-z][a-z\d+.-]*:/i.test(input)) return null;
		if (/\s/.test(input)) {
			searches.unshift({ query: input, visitedAt: new Date().toISOString() });
			searches = searches.slice(0, 200);
			saveSaved(STORAGE.searches, searches);
			return `https://www.google.com/search?q=${encodeURIComponent(input)}`;
		}
		try {
			const url = new URL(`https://${input}`);
			return url.href;
		} catch (error) {
			searches.unshift({ query: input, visitedAt: new Date().toISOString() });
			searches = searches.slice(0, 200);
			saveSaved(STORAGE.searches, searches);
			return `https://www.google.com/search?q=${encodeURIComponent(input)}`;
		}
	}

	function updateNavigation() {
		const tab = getActiveTab();
		if (!tab) return;
		address.value = tab.url || "";
		backButton.disabled = !tab.view.canGoBack();
		forwardButton.disabled = !tab.view.canGoForward();
		document.getElementById("browser-bookmark").textContent =
			bookmarks.some(item => item.url == tab.url) ? "★" : "☆";
	}

	function renderTabs() {
		tabsElement.replaceChildren();
		for (const tab of browserTabs) {
			const button = document.createElement("button");
			button.className = "browser-tab";
			button.type = "button";
			button.setAttribute("role", "tab");
			button.setAttribute("aria-selected", String(tab.id == activeTabId));
			button.title = tab.title || tab.url || "New tab";

			const title = document.createElement("span");
			title.className = "browser-tab-title";
			title.textContent = tab.title || tab.url || "New tab";
			button.append(title);
			button.addEventListener("click", () => activateTab(tab.id));

			const close = document.createElement("span");
			close.className = "browser-tab-close";
			close.setAttribute("role", "button");
			close.setAttribute("aria-label", `Close ${title.textContent}`);
			close.textContent = "×";
			close.addEventListener("click", event => {
				event.stopPropagation();
				closeTab(tab.id);
			});
			button.append(close);
			tabsElement.append(button);
		}
	}

	function activateTab(tabId) {
		activeTabId = tabId;
		for (const tab of browserTabs) tab.view.hidden = tab.id != activeTabId;
		renderTabs();
		updateNavigation();
	}

	function createTab(initialUrl) {
		const id = ++nextTabId;
		const view = document.createElement("webview");
		view.setAttribute("partition", document.body.dataset.browserPartition);
		view.setAttribute("webpreferences", "contextIsolation=yes, nodeIntegration=no");
		view.setAttribute("allowpopups", "");
		view.setAttribute("aria-label", "Website");
		view.hidden = true;
		const tab = { id, title: "New tab", url: "", view };
		browserTabs.push(tab);
		webviewsElement.append(view);

		view.addEventListener("did-navigate", (event) => {
			tab.url = event.url;
			saveHistoryEntry({ title: tab.title, url: tab.url, visitedAt: new Date().toISOString() });
			if (activeTabId == id) {
				updateNavigation();
				status.textContent = tab.url;
			}
		});
		view.addEventListener("did-navigate-in-page", (event) => {
			tab.url = event.url;
			saveHistoryEntry({ title: tab.title, url: tab.url, visitedAt: new Date().toISOString() });
			if (activeTabId == id) updateNavigation();
		});
		view.addEventListener("page-title-updated", event => {
			tab.title = event.title || tab.url || "New tab";
			renderTabs();
			if (activeTabId == id) saveHistoryEntry({ title: tab.title, url: tab.url, visitedAt: new Date().toISOString() });
		});
		view.addEventListener("did-fail-load", event => {
			if (event.errorCode == -3) return;
			if (activeTabId == id) status.textContent = `Unable to load page: ${event.errorDescription}`;
		});
		view.addEventListener("will-navigate", event => {
			try {
				if (!["http:", "https:"].includes(new URL(event.url).protocol)) event.preventDefault();
			} catch (error) {
				event.preventDefault();
			}
		});
		view.addEventListener("new-window", event => {
			event.preventDefault();
			const url = normalizeAddress(event.url);
			if (url) createTab(url);
		});

		activateTab(id);
		if (initialUrl) view.loadURL(initialUrl);
		renderTabs();
		return tab;
	}

	function closeTab(tabId) {
		const index = browserTabs.findIndex(tab => tab.id == tabId);
		if (index == -1) return;
		browserTabs[index].view.remove();
		browserTabs.splice(index, 1);
		if (!browserTabs.length) {
			createTab("https://www.google.com/");
			return;
		}
		if (activeTabId == tabId) activateTab(browserTabs[Math.max(0, index - 1)].id);
		else renderTabs();
	}

	function renderSidebar() {
		sidebarContent.replaceChildren();
		const isBookmarks = sidebarMode == "bookmarks";
		const entries = isBookmarks ? bookmarks : history;
		if (sidebarMode == "history" && searches.length) {
			const searchHeading = document.createElement("h3");
			searchHeading.textContent = "Searches";
			sidebarContent.append(searchHeading);
			for (const search of searches.slice(0, 30)) {
				const item = document.createElement("div");
				item.className = "browser-sidebar-item";
				const button = document.createElement("button");
				button.type = "button";
				button.textContent = search.query;
				button.addEventListener("click", () => navigate(search.query));
				item.append(button);
				sidebarContent.append(item);
			}
		}
		for (const entry of entries.slice(0, 100)) {
			const item = document.createElement("div");
			item.className = "browser-sidebar-item";
			const button = document.createElement("button");
			button.type = "button";
			button.textContent = entry.title || entry.url;
			button.title = entry.url;
			button.addEventListener("click", () => navigate(entry.url));
			const detail = document.createElement("small");
			detail.textContent = entry.url;
			item.append(button, detail);
			if (isBookmarks) {
				const remove = document.createElement("button");
				remove.type = "button";
				remove.textContent = "Remove bookmark";
				remove.addEventListener("click", () => {
					bookmarks = bookmarks.filter(bookmark => bookmark.url != entry.url);
					saveSaved(STORAGE.bookmarks, bookmarks);
					renderSidebar();
					updateNavigation();
				});
				item.append(remove);
			}
			sidebarContent.append(item);
		}
	}

	function showSidebar(mode) {
		sidebarMode = mode;
		sidebar.hidden = false;
		sidebarTitle.textContent = mode == "bookmarks" ? "Bookmarks" : "History";
		document.getElementById("browser-clear-history").hidden = mode != "history";
		renderSidebar();
	}

	function navigate(value) {
		const url = normalizeAddress(value);
		const tab = getActiveTab();
		if (!url || !tab) {
			status.textContent = "Enter a valid website address or search.";
			return;
		}
		tab.url = url;
		address.value = url;
		tab.view.loadURL(url);
	}

	document.getElementById("browser-new-tab").addEventListener("click", () => createTab("https://www.google.com/"));
	document.getElementById("browser-navigation").addEventListener("submit", event => {
		event.preventDefault();
		navigate(address.value);
	});
	backButton.addEventListener("click", () => {
		const tab = getActiveTab();
		if (tab && tab.view.canGoBack()) tab.view.goBack();
	});
	forwardButton.addEventListener("click", () => {
		const tab = getActiveTab();
		if (tab && tab.view.canGoForward()) tab.view.goForward();
	});
	document.getElementById("browser-refresh").addEventListener("click", () => {
		const tab = getActiveTab();
		if (tab) tab.view.reload();
	});
	document.getElementById("browser-bookmark").addEventListener("click", () => {
		const tab = getActiveTab();
		if (!tab || !tab.url) return;
		const existing = bookmarks.findIndex(item => item.url == tab.url);
		if (existing >= 0) bookmarks.splice(existing, 1);
		else bookmarks.unshift({ title: tab.title, url: tab.url, savedAt: new Date().toISOString() });
		saveSaved(STORAGE.bookmarks, bookmarks);
		updateNavigation();
		if (sidebarMode == "bookmarks") renderSidebar();
	});
	document.getElementById("browser-bookmarks-toggle").addEventListener("click", () => showSidebar("bookmarks"));
	document.getElementById("browser-history-toggle").addEventListener("click", () => showSidebar("history"));
	document.getElementById("browser-sidebar-close").addEventListener("click", () => {
		sidebar.hidden = true;
		sidebarMode = "";
	});
	document.getElementById("browser-clear-history").addEventListener("click", () => {
		history = [];
		searches = [];
		saveSaved(STORAGE.history, history);
		saveSaved(STORAGE.searches, searches);
		renderSidebar();
	});
	document.addEventListener("keydown", event => {
		if (!(event.ctrlKey || event.metaKey)) return;
		if (event.key.toLowerCase() == "t") {
			event.preventDefault();
			createTab("https://www.google.com/");
		} else if (event.key.toLowerCase() == "w") {
			event.preventDefault();
			const tab = getActiveTab();
			if (tab) closeTab(tab.id);
		} else if (event.key.toLowerCase() == "l") {
			event.preventDefault();
			address.focus();
			address.select();
		}
	});

	createTab("https://www.google.com/");
})();
