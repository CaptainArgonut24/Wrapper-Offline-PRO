(() => {
	const pageSize = 10;
	const categories = [
		{ id: "music", label: "Music" },
		{ id: "sfx", label: "SFX" },
		{ id: "voices", label: "Voices" },
		{ id: "tts", label: "TTS Generated" },
		{ id: "images", label: "Images" },
		{ id: "starters", label: "Starters" },
		{ id: "props", label: "Props" },
		{ id: "backgrounds", label: "Backgrounds" }
	];
	const imageExtensions = new Set(["gif", "jpg", "jpeg", "png", "swf", "webp"]);
	const categoryLabels = Object.fromEntries(categories.map(category => [category.id, category.label]));
	const library = document.getElementById("library-asset-list");
	if (!library) return;

	const search = document.getElementById("library-search");
	const categorySelect = document.getElementById("library-category");
	const previousButton = document.getElementById("library-previous");
	const nextButton = document.getElementById("library-next");
	const pageLabel = document.getElementById("library-page");
	const preview = document.getElementById("library-preview");
	const previewTitle = document.getElementById("library-preview-title");
	const previewContent = document.getElementById("library-preview-content");
	let assets = [];
	let page = 0;

	categorySelect.add(new Option("All categories", "all"));
	for (const category of categories) {
		categorySelect.add(new Option(category.label, category.id));
	}

	function assetCategories(asset) {
		const result = [];
		const extension = String(asset.id || "").split(".").pop().toLowerCase();
		if (asset.type == "movie") result.push("starters");
		if (asset.type == "sound") {
			const soundCategory = {
				bgmusic: "music",
				soundeffect: "sfx",
				voiceover: "voices",
				tts: "tts"
			}[asset.subtype];
			if (soundCategory) result.push(soundCategory);
		}
		if (asset.type == "bg") result.push("backgrounds");
		if (asset.type == "prop") result.push("props");
		if (
			["bg", "prop", "watermark"].includes(asset.type) &&
			imageExtensions.has(extension) &&
			asset.subtype != "video"
		) {
			result.push("images");
		}
		return result;
	}

	function filteredAssets() {
		const query = search.value.trim().toLocaleLowerCase();
		const selectedCategory = categorySelect.value;
		return assets.filter(asset => {
			const matchesCategory = selectedCategory == "all" ||
				asset.categories.includes(selectedCategory);
			const searchText = `${asset.title || ""} ${asset.subtype || ""} ${asset.id || ""}`.toLocaleLowerCase();
			return matchesCategory && searchText.includes(query);
		});
	}

	function assetUrl(asset) {
		return asset.type == "movie" ?
			`/file/movie/file/${encodeURIComponent(asset.id)}` :
			`/assets/${encodeURIComponent(asset.id)}`;
	}

	function thumbnailUrl(asset) {
		if (asset.type == "movie") return `/file/movie/thumb/${encodeURIComponent(asset.id)}`;
		if (asset.type == "sound") return "/pages/img/importer/sound.png";
		if (asset.subtype == "video") {
			return `/assets/${encodeURIComponent(String(asset.id).replace(/\.[^.]+$/, ".png"))}`;
		}
		if (imageExtensions.has(String(asset.id || "").split(".").pop().toLowerCase()) &&
			!String(asset.id).toLowerCase().endsWith(".swf")) {
			return assetUrl(asset);
		}
		return "/pages/img/importer/image.png";
	}

	function safeFilename(value) {
		return String(value || "uploaded-asset").replace(/[\\/:*?"<>|]/g, "_");
	}

	function render() {
		const matches = filteredAssets();
		const pageCount = Math.ceil(matches.length / pageSize);
		page = Math.min(page, Math.max(pageCount - 1, 0));
		library.replaceChildren();

		if (assets.length == 0) {
			library.append(Object.assign(document.createElement("p"), {
				className: "library-empty",
				textContent: "No uploaded assets yet. Upload a file above to add it to your library."
			}));
		} else if (matches.length == 0) {
			library.append(Object.assign(document.createElement("p"), {
				className: "library-empty",
				textContent: "No uploaded content matches your search."
			}));
		} else {
			for (const asset of matches.slice(page * pageSize, (page + 1) * pageSize)) {
				const item = document.createElement("article");
				item.className = "library-item";
				item.dataset.assetId = asset.id;
				item.dataset.assetType = asset.type;

				const image = document.createElement("img");
				image.className = "library-item-preview";
				image.src = thumbnailUrl(asset);
				image.alt = "";
				image.loading = "lazy";

				const details = document.createElement("div");
				details.className = "library-item-details";
				const title = document.createElement("h4");
				title.textContent = asset.title || "Untitled";
				const meta = document.createElement("p");
				meta.textContent = asset.categories.map(id => categoryLabels[id]).join(" · ");
				details.append(title, meta);

				const actions = document.createElement("div");
				actions.className = "library-item-actions";
				const previewButton = document.createElement("button");
				previewButton.type = "button";
				previewButton.dataset.action = "preview";
				previewButton.textContent = "Preview";
				previewButton.setAttribute("aria-label", `Preview ${asset.title || "uploaded asset"}`);
				const download = document.createElement("a");
				download.href = assetUrl(asset);
				const extension = asset.type == "movie" ? ".zip" :
					`.${String(asset.id).split(".").pop()}`;
				const filename = safeFilename(asset.title);
				download.download = filename.toLowerCase().endsWith(extension) ?
					filename : filename + extension;
				download.textContent = "Download";
				actions.append(previewButton, download);
				item.append(image, details, actions);
				library.append(item);
			}
		}

		pageLabel.textContent = pageCount == 0 ? "0 items" :
			`Page ${page + 1} of ${pageCount} · ${matches.length} item${matches.length == 1 ? "" : "s"}`;
		previousButton.disabled = page == 0 || pageCount == 0;
		nextButton.disabled = page >= pageCount - 1;
	}

	function showPreview(asset) {
		previewTitle.textContent = asset.title || "Uploaded asset";
		previewContent.replaceChildren();
		let content;

		if (asset.type == "movie") {
			content = document.createElement("iframe");
			content.src = `/player?movieId=${encodeURIComponent(asset.id)}`;
			content.title = `Preview: ${asset.title || "starter"}`;
			content.allowFullscreen = true;
		} else if (asset.type == "sound") {
			content = document.createElement("audio");
			content.src = assetUrl(asset);
			content.controls = true;
			content.autoplay = true;
		} else if (asset.subtype == "video") {
			content = document.createElement("img");
			content.src = thumbnailUrl(asset);
			content.alt = `Preview: ${asset.title || "uploaded video"}`;
		} else if (String(asset.id || "").toLowerCase().endsWith(".swf")) {
			content = document.createElement("object");
			content.data = assetUrl(asset);
			content.type = "application/x-shockwave-flash";
			content.setAttribute("aria-label", `Preview: ${asset.title || "uploaded asset"}`);
		} else {
			content = document.createElement("img");
			content.src = assetUrl(asset);
			content.alt = `Preview: ${asset.title || "uploaded image"}`;
		}

		content.classList.add("library-preview-media");
		previewContent.append(content);
		preview.hidden = false;
		document.getElementById("library-preview-close").focus();
	}

	search.addEventListener("input", () => {
		page = 0;
		render();
	});
	categorySelect.addEventListener("change", () => {
		page = 0;
		render();
	});
	previousButton.addEventListener("click", () => {
		if (page > 0) {
			page--;
			render();
		}
	});
	nextButton.addEventListener("click", () => {
		page++;
		render();
	});
	library.addEventListener("click", event => {
		const button = event.target.closest("button[data-action='preview']");
		if (!button) return;
		const item = button.closest(".library-item");
		const asset = assets.find(entry => entry.id == item.dataset.assetId);
		if (asset) showPreview(asset);
	});

	function closePreview() {
		preview.hidden = true;
		previewContent.replaceChildren();
	}
	document.getElementById("library-preview-close").addEventListener("click", closePreview);
	preview.addEventListener("click", event => {
		if (event.target == preview) closePreview();
	});
	document.addEventListener("keydown", event => {
		if (event.key == "Escape" && !preview.hidden) closePreview();
	});

	$.getJSON("/api/assets/list")
		.done(data => {
			assets = data
				.map(asset => ({ ...asset, categories: assetCategories(asset) }))
				.filter(asset => asset.categories.length > 0)
				.sort((a, b) => String(a.title || "").localeCompare(String(b.title || "")));
			render();
		})
		.fail(() => {
			library.textContent = "Unable to load uploaded assets. Please try again.";
			pageLabel.textContent = "Library unavailable";
			previousButton.disabled = true;
			nextButton.disabled = true;
		});
})();
