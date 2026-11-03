const previewer = document.getElementById("previewer");
const previewObj = previewer.querySelector("#preview_player");
const studio = $("#obj");

/**
 * studio functions
 */
const tutorialReload = (new URLSearchParams(window.location.search)).get("tutorial");
const movieId = (new URLSearchParams(window.location.search)).get("movieId");
interactiveTutorial = {
	neverDisplay: function() {
		return tutorialReload ? false : true;
	}
};
function studioLoaded(arg) { console.log(arg) }
function quitStudio() { window.location.href = "/videolist" }

/**
 * show and hide widgets
 */
let importerVisible = false;
function showImporter() {
	switch(importerVisible) {
		case true: {
			hideImporter();
			break;
		}
		case false:
		default: {
			importerVisible = true;
			importer.show();
			if (!importer.data("importer"))
				importer.data("importer", new AssetImporter(importer));
		}
	}
	return true;
}
function hideImporter() {
	importerVisible = false;
	importer.hide();
}

let globalXml = "";
let pendingPreview = null;
const previewConfirmation = document.getElementById("studio-preview-confirmation");

function initPreviewPlayer(dataXmlStr, startFrame) {
	pendingPreview = { movieXml: dataXmlStr, startFrame };
	previewConfirmation.showModal();
	document.getElementById("studio-preview-cancel").focus();
}
function cancelStudioPreview() {
	pendingPreview = null;
	previewConfirmation.close();
}
function openStudioPreview() {
	if (!pendingPreview) return;

	if (movieId) {
		window.open(`/player?movieId=${encodeURIComponent(movieId)}`, "_blank");
		pendingPreview = null;
		previewConfirmation.close();
		return;
	}

	const previewWindow = window.open("about:blank", "_blank");
	if (!previewWindow) {
		alert("The preview window could not be opened. Please allow pop-ups and try again.");
		return;
	}

	previewWindow.name = "wrapper-preview:" + JSON.stringify(pendingPreview);
	previewWindow.location.href = `/player?preview=1&startFrame=${encodeURIComponent(pendingPreview.startFrame)}`;
	pendingPreview = null;
	previewConfirmation.close();
}
function retrievePreviewPlayerData() {
	const movieXml = globalXml.slice();
	globalXml = "";
	return movieXml;
}
function hidePreviewer() {
	previewObj.setAttribute("data", "");
	document.body.classList.remove("in_preview");
}

document.getElementById("studio-preview-ok").addEventListener("click", openStudioPreview);
document.getElementById("studio-preview-cancel").addEventListener("click", cancelStudioPreview);
previewConfirmation.addEventListener("cancel", () => {
	pendingPreview = null;
});
