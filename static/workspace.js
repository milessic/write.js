/*
 * Workspace: the documents tree (file explorer), the opened documents (tabs) and the editors.
 * The tree (left, right, top or bottom) and the tabs bar (top or bottom) can be docked by drag-and-drop or from their right-click menu;
 * the layout, the opened tabs and the split editors are user preferences kept in localStorage.
 * Folders are listed on top of the tree and can hold sub-folders, up to maxFolderDepth levels;
 * a folder is known by its path, e.g. "work/projects". A document is in at most one folder.
 * The folders, which document is in which and the folders' colors are kept under foldersKey and go
 * to the cloud with the notebook. A folder's color tints it, its sub-folders without a color of their own
 * and the tabs of the documents in them.
 * Documents in the tree can be selected with Ctrl/Cmd+click (one more) and Shift+click (a range);
 * opening, deleting, moving and dragging then act on all the selected documents.
 *
 * Split view: up to 4 editor panes, each showing one opened tab. The focused pane's editor
 * carries id="editor" (and is editorObject), so the rest of the app works on it unchanged;
 * #doc-name shows the focused pane's document.
 *
 * Every opened document remembers where it was left, the editor's scroll and the caret, while it is opened and,
 * when saved, across visits (docPositionsKey); closing its tab forgets it.
 * The document window (docwindow.js) shows one document and keeps the app's tabs, editors and layout as they are.
 *
 * The top bar's name field has a v that opens a tray searching the documents, with the tree's rows (docSearch below); a right
 * click on it, on a tab or on an editor's head opens the document's menu (documentMenuItems): search in it, insert into it,
 * copy and export it.
 *
 * A document whose metadata (doclinks.js) has showTitle shows its name as a title above its text, line 0: not part of
 * the text (not in the table of contents, the exports or the word count), editing it renames the document like the
 * name field does, and the other way around. A document's menus show or hide it.
 */
const layoutKey = "__layout__";
const openedTabsKey = "__openedTabs__";
const openedEditorsKey = "__openedEditors__";
const foldersKey = "__folders__";
// the tree's width is a preference of this device only, it doesn't go to the cloud (isDeviceOnlyKey)
const treeWidthKey = "__treeWidth__";
// and its height docked above or below the editors
const treeHeightKey = "__treeHeight__";
// the pinned tree's width on phones and tablets is kept apart from the desktop one
const treeWidthMobileKey = "__treeWidthMobile__";
// phones and tablets: a pinned tree stays open beside the editor, without the scrim, and can be resized;
// device only as well (isDeviceOnlyKey)
const treePinnedKey = "__treePinned__";
// {documentName: {scroll, caret: {path, offset}}}: where each opened document was left, device only as well
const docPositionsKey = "__docPositions__";
const minTreeWidth = 160;
// the pinned tree on phones and tablets can be narrower, it shares the screen with the editor
const minTreeWidthMobile = minTreeWidth / 2;
const maxTreeWidth = 600;
// docked above or below the editors
const minTreeHeight = 80;
const maxTreeHeight = 600;
const folderSeparator = "/";
const maxFolderDepth = 5;
const untitledTabLabel = "Untitled";
const maxEditors = 4;
const tabDragType = "application/x-writejs-tab";
const documentDragType = "application/x-writejs-document";
const folderDragType = "application/x-writejs-folder";
// pastel background colors of folders; a folder stores the key, so the shades can be tuned later
const folderColors = [
	{ key: "rose", label: "Rose", color: "#f6c6cc" },
	{ key: "peach", label: "Peach", color: "#f8d5bd" },
	{ key: "butter", label: "Butter", color: "#f6eab2" },
	{ key: "lime", label: "Lime", color: "#ddeeb8" },
	{ key: "mint", label: "Mint", color: "#c3ead4" },
	{ key: "aqua", label: "Aqua", color: "#bfe6e8" },
	{ key: "sky", label: "Sky", color: "#c6dcf4" },
	{ key: "lavender", label: "Lavender", color: "#d6cff3" },
	{ key: "lilac", label: "Lilac", color: "#ebcbee" },
	{ key: "sand", label: "Sand", color: "#e3dacb" },
];
// how much of a folder's color goes over the theme's surface, in light themes and in dark ones (from the outermost
// folder's stripe to the folder's own); tabs are paler than the tree, the active or hovered one a bit stronger.
// Keep in line with --folder-bg in styles.css
const folderTints = {
	tree: { light: 75, dark: [14, 34] },
	tab: { light: 35, dark: [8, 20] },
	tabStrong: { light: 55, dark: [12, 26] },
};

let treePinned = notebookStorage.getItem(treePinnedKey) === "true";
// treeSide "left" / "right" / "top" / "bottom";
// the table of contents (toc.js): tocSide "left" / "right" / "top" / "bottom" on its own or "tree" as a tab next to the documents,
// treeTab is the tab the tree shows then
const layout = Object.assign(
	{ treeSide: "left", tabsSide: "top", treeHidden: false, collapsedFolders: [], tocSide: "right", tocHidden: true, treeTab: "documents" },
	readJsonSetting(layoutKey)
);
// {id, name, html, dirty}; html is only kept while a tab that isn't shown has unsaved changes
let tabs = [];
let tabSeq = 0;
// {tabId, el, editor}; the pane markup in index.html is the first one and the template of the others
const editorGrid = document.getElementById("editor-grid");
const paneTemplate = editorGrid.querySelector(".editor-pane").cloneNode(true);
paneTemplate.querySelector(".editor").removeAttribute("id");
let panes = [];
let focusedPane = null;
let renderedTreeKey = null;
let draggedTabId = null;
let draggedPane = null;
let draggedDocuments = null;
// documents selected in the tree; the anchor is where a Shift+click range starts
let selectedDocuments = new Set();
let selectionAnchor = null;
let draggedFolder = null;
let focusLayout = null; // focus mode with "Opened editors" (focusModeKey): the editors from before, shown again when leaving
let positionsTimer = 0;

const fileTreeList = document.getElementById("file-tree-list");
const docSearchTray = document.getElementById("doc-search-tray");
const docSearchInput = document.getElementById("doc-search-input");
const docSearchList = document.getElementById("doc-search-list");
const fileTreeSearch = document.getElementById("file-tree-search");
const tabsContainer = document.getElementById("tabs");
const contextMenu = document.getElementById("context-menu");

applyLayout();
applyTreePinned();
// pinned: the drawer is open from the start (it only takes effect on narrow screens)
if ( treePinned ) { document.body.classList.add("tree-drawer-open") }
focusedPane = setupPane(editorGrid.querySelector(".editor-pane"));
panes.push(focusedPane);
restoreOpenedTabs();
restoreEditors();
renderPanes();

window.addEventListener("load", () => {
	// nothing was opened on load (no consent, no last document): the editor becomes an untitled tab
	if ( !getActiveTab() ) {
		const tab = createTab(getDocumentName());
		tab.dirty = Boolean(editorObject.innerText.trim());
		focusedPane.tabId = tab.id;
		renderTabs();
	}
	migratePathFolders();
	refreshFileTree(true);
});
window.addEventListener("beforeunload", (e) => {
	// the focused document behaves as before; only warn about unsaved edits elsewhere. The document window has only
	// its document, its x has already asked (docwindow.js)
	if ( isDocWindow ? getActiveTab()?.dirty && !docWindowClosing : tabs.some(t => t.dirty && t.id !== focusedPane.tabId) ) { e.preventDefault() }
});
window.addEventListener("pagehide", savePositions);
// documents changed in another browser tab (a document window): tabs without unsaved edits show the new content
window.addEventListener("storage", (e) => {
	if ( e.key?.startsWith(docPrefix) && e.newValue !== null ) {
		const name = e.key.slice(docPrefix.length);
		const stored = splitDocumentId(e.newValue);
		const changed = (t) => stored.html !== paneOfTab(t).editor.innerHTML || JSON.stringify(stored.meta) !== JSON.stringify(t.meta ?? {});
		if ( tabs.some(t => t.name === name && !t.dirty && paneOfTab(t) && changed(t)) ) {
			reloadDocumentTabs(name);
		}
	}
	refreshFileTree();
	renderTabs();
});

documentNameObject.addEventListener("input", () => {
	const tab = getActiveTab();
	if ( !tab ) { return }
	tab.name = getDocumentName();
	tab.dirty = true;
	renderTabs();
});
document.addEventListener("keydown", (e) => {
	if ( (e.ctrlKey || e.metaKey) && e.key === "\\" ) { e.preventDefault(); splitEditor() }
});

document.getElementById("split-btn").addEventListener("click", () => splitEditor());
document.getElementById("file-tree-new").addEventListener("click", createNewDocument);
document.getElementById("file-tree-new-folder").addEventListener("click", () => createFolder());
document.getElementById("file-tree-pin").addEventListener("click", toggleTreePinned);
document.getElementById("file-tree-hide").addEventListener("click", hideFileTree);
document.getElementById("file-tree-scrim").addEventListener("click", hideFileTree);
fileTreeSearch.addEventListener("input", () => refreshFileTree());
fileTreeList.addEventListener("keydown", (e) => {
	if ( e.key === "Escape" && selectedDocuments.size ) { clearDocumentSelection() }
	if ( e.key === "Delete" && selectedDocuments.size ) { e.preventDefault(); deleteDocuments([...selectedDocuments]) }
});
fileTreeSearch.addEventListener("keydown", (e) => {
	if ( e.key === "Escape" ) { fileTreeSearch.value = ""; refreshFileTree() }
});
document.getElementById("file-tree").addEventListener("contextmenu", (e) => openContextMenu(e, treePanelMenuItems()));
document.getElementById("tab-bar").addEventListener("contextmenu", (e) => openContextMenu(e, tabsPanelMenuItems()));
// on the bar: the first click of a double click on another tab renders the tabs anew
tabsContainer.addEventListener("dblclick", (e) => {
	const el = e.target.closest(".tab");
	if ( el && !e.target.closest(".tab-close") ) { revealDocumentInTree(tabById(Number(el.dataset.tabId))?.savedName) }
});
setupDocking("file-tree-head", "tree");
setupDocking("documents-tab", "tree");
setupDocking("side-tabs", () => tocGroupedWithTree() ? "group" : "tree");
setupLongPressMenus(fileTreeList);
setupTreeResizing();
setupDocumentDropping();
setupDocking("tab-grip", "tabs");
setupNameTooltip();
setupDocSearch();
setupLongPressMenus(tabsContainer);
documentNameObject.addEventListener("contextmenu", (e) => openContextMenu(e, documentMenuItems(getActiveTab())));

// on press, in the capture phase: a right-click (its native menu), a drag or a button that stops its click close it too
document.addEventListener("pointerdown", (e) => { if ( !contextMenu.contains(e.target) ) { closeContextMenu() } }, true);
document.addEventListener("keydown", (e) => { if ( e.key === "Escape" ) { closeContextMenu() } });
window.addEventListener("resize", closeContextMenu);
window.addEventListener("blur", closeContextMenu);
// mobile: keep the top bar and the toolbar on screen; iOS doesn't resize the page for the keyboard
// (interactive-widget is ignored there), it pans the visual viewport over the page instead
if ( window.visualViewport ) {
	let viewportFrame = 0;
	const scheduleFit = () => {
		if ( !viewportFrame ) { viewportFrame = requestAnimationFrame(fitToVisualViewport) }
	};
	visualViewport.addEventListener("resize", scheduleFit);
	visualViewport.addEventListener("scroll", scheduleFit);
	window.addEventListener("scroll", scheduleFit);
	fitToVisualViewport();

	function fitToVisualViewport(){
		viewportFrame = 0;
		// the page never scrolls (styles.css); undo a scroll the browser did to reveal the caret
		if ( window.scrollY || window.scrollX ) { window.scrollTo(0, 0) }
		const style = document.body.style;
		const top = Math.max(0, Math.round(visualViewport.offsetTop));
		const height = Math.round(visualViewport.height);
		// pinch-zoomed (iOS ignores maximum-scale): let the user pan around the page
		if ( visualViewport.scale > 1.01 || (!top && height >= window.innerHeight) ) {
			style.removeProperty("--app-top");
			style.removeProperty("--app-height");
			return
		}
		// set only on change: every change re-lays out the editors
		if ( style.getPropertyValue("--app-top") !== top + "px" ) { style.setProperty("--app-top", top + "px") }
		if ( style.getPropertyValue("--app-height") !== height + "px" ) { style.setProperty("--app-height", height + "px") }
	}
}


// preferences
function readJsonSetting(key){
	try {
		return JSON.parse(notebookStorage.getItem(key)) || {};
	} catch ( err ) {
		return {};
	}
}

function saveLayout(){
	applyLayout();
	if ( validateUserConsent(false) && !isDocWindow ) { notebookStorage.setItem(layoutKey, JSON.stringify(layout)) }
}

function applyLayout(){
	document.body.dataset.treeSide = layout.treeSide;
	document.getElementById("file-tree-resizer").setAttribute("aria-orientation", dockedInRows(layout.treeSide) ? "horizontal" : "vertical");
	document.body.dataset.tabsSide = layout.tabsSide;
	document.body.classList.toggle("tree-hidden", layout.treeHidden);
	if ( typeof applyTocLayout === "function" ) { applyTocLayout() } // toc.js loads after this file
	requestAnimationFrame(() => window.WriteVi?.relayout());
}

function dockedInRows(side){
	// above or below the editors: the panel is resized by its height
	return side === "top" || side === "bottom";
}

function setupTreeResizing(){
	// the edge of the tree next to the editors is dragged to set its width, or its height above or below them
	const tree = document.getElementById("file-tree");
	const resizer = document.getElementById("file-tree-resizer");
	applyTreeWidth(Number(notebookStorage.getItem(treeWidthKey)) || null, false);
	applyTreeWidth(Number(notebookStorage.getItem(treeWidthMobileKey)) || null, true);
	applyTreeHeight(Number(notebookStorage.getItem(treeHeightKey)) || null);

	resizer.addEventListener("pointerdown", (e) => {
		if ( e.button !== 0 ) { return }
		e.preventDefault();
		resizer.setPointerCapture(e.pointerId);
		const mobile = isLowWidthViewport;
		// on phones and tablets the tree is beside the editor wherever it's docked (styles.css)
		const rows = dockedInRows(layout.treeSide) && !mobile;
		const start = rows ? e.clientY : e.clientX;
		const rect = tree.getBoundingClientRect();
		const startSize = rows ? rect.height : rect.width;
		// docked right or bottom, the edge is on the tree's left or top: dragging left or up makes it bigger
		const direction = layout.treeSide === "right" || (rows && layout.treeSide === "bottom") ? -1 : 1;
		document.body.classList.add("tree-resizing");
		document.body.classList.toggle("resizing-rows", rows);

		const move = (ev) => {
			const size = startSize + ((rows ? ev.clientY : ev.clientX) - start) * direction;
			rows ? applyTreeHeight(size) : applyTreeWidth(size, mobile);
		};
		const end = () => {
			resizer.removeEventListener("pointermove", move);
			resizer.removeEventListener("pointerup", end);
			resizer.removeEventListener("pointercancel", end);
			document.body.classList.remove("tree-resizing", "resizing-rows");
			const rect = tree.getBoundingClientRect();
			rows ? saveTreeHeight(Math.round(rect.height)) : saveTreeWidth(Math.round(rect.width), mobile);
		};
		resizer.addEventListener("pointermove", move);
		resizer.addEventListener("pointerup", end);
		resizer.addEventListener("pointercancel", end);
	});
	resizer.addEventListener("dblclick", () => {
		if ( dockedInRows(layout.treeSide) && !isLowWidthViewport ) {
			applyTreeHeight(null);
			saveTreeHeight(null);
			return
		}
		applyTreeWidth(null, isLowWidthViewport);
		saveTreeWidth(null, isLowWidthViewport);
	});
}

function applyTreeHeight(height){
	const style = document.getElementById("app-body").style;
	if ( !height ) { style.removeProperty("--tree-height"); return }
	style.setProperty("--tree-height", Math.min(maxTreeHeight, Math.max(minTreeHeight, height)) + "px");
}

function saveTreeHeight(height){
	if ( !validateUserConsent(false) ) { return }
	if ( height ) { notebookStorage.setItem(treeHeightKey, String(height)) }
	else { notebookStorage.removeItem(treeHeightKey) }
}

function applyTreeWidth(width, mobile){
	// set on the panels' container: the table of contents split with the tree (toc.js) takes the same room
	const style = document.getElementById("app-body").style;
	const property = mobile ? "--tree-width-mobile" : "--tree-width";
	if ( !width ) { style.removeProperty(property); return }
	const clamped = Math.min(maxTreeWidth, Math.max(mobile ? minTreeWidthMobile : minTreeWidth, width));
	style.setProperty(property, clamped + "px");
}

function saveTreeWidth(width, mobile){
	if ( !validateUserConsent(false) ) { return }
	const key = mobile ? treeWidthMobileKey : treeWidthKey;
	if ( width ) { notebookStorage.setItem(key, String(width)) }
	else { notebookStorage.removeItem(key) }
}

function applyTreePinned(){
	document.body.classList.toggle("tree-pinned", treePinned);
	const button = document.getElementById("file-tree-pin");
	button.setAttribute("aria-pressed", String(treePinned));
	button.title = treePinned ? "Unpin documents" : "Pin documents open";
}

function toggleTreePinned(){
	treePinned = !treePinned;
	applyTreePinned();
	if ( !validateUserConsent(false) ) { return }
	if ( treePinned ) { notebookStorage.setItem(treePinnedKey, "true") }
	else { notebookStorage.removeItem(treePinnedKey) }
}

function setTreeSide(side){
	layout.treeSide = side;
	layout.treeHidden = false;
	saveLayout();
}

function setTabsSide(side){
	layout.tabsSide = side;
	saveLayout();
}

function saveOpenedTabs(){
	if ( !validateUserConsent(false) || isDocWindow ) { return }
	saveOpenedEditors();
	const names = tabs.map(t => t.name).filter(name => name && documentExists(name));
	notebookStorage.setItem(openedTabsKey, JSON.stringify([...new Set(names)]));
	savePositions();
}

function saveOpenedEditors(){
	if ( !validateUserConsent(false) || isDocWindow ) { return }
	// in focus mode the editors from before are kept: the next visit doesn't start with every tab split
	const shownTabIds = focusLayout ? focusLayout.tabIds : panes.map(p => p.tabId);
	const names = shownTabIds.map(id => tabById(id)?.name || "");
	const focused = focusLayout ? Math.max(0, focusLayout.tabIds.indexOf(focusLayout.focused)) : panes.indexOf(focusedPane);
	notebookStorage.setItem(openedEditorsKey, JSON.stringify({ names, focused }));
}

function restoreEditors(){
	// split editors of the last visit; untitled and deleted documents are left out
	if ( isDocWindow ) { return }
	const saved = readJsonSetting(openedEditorsKey);
	const names = Array.isArray(saved.names) ? saved.names.slice(0, maxEditors) : [];
	const focusedName = names[saved.focused];
	const restored = names.filter(name => name && documentExists(name));
	restored.forEach((name, i) => {
		const tab = tabs.find(t => t.name === name) || createTab(name);
		const pane = i === 0 ? focusedPane : addPane(panes[panes.length - 1]);
		setPaneTab(pane, tab);
	});
	const focused = panes.find(p => tabById(p.tabId)?.name === focusedName);
	if ( focused ) { focusPane(focused) }
}

function restoreOpenedTabs(){
	if ( !validateUserConsent(false) || isDocWindow ) { return }
	let names = [];
	try {
		names = JSON.parse(notebookStorage.getItem(openedTabsKey)) || [];
	} catch ( err ) {}
	for ( const name of names ) {
		if ( documentExists(name) ) { createTab(name) }
	}
}

function documentExists(name){
	return validateUserConsent(false) && notebookStorage.getItem(docPrefix + name) !== null;
}


// file tree
function isFileTreeVisible(){
	return isLowWidthViewport ? document.body.classList.contains("tree-drawer-open") : !layout.treeHidden;
}

function showFileTree(){
	// the documents, not the table of contents (toc.js) the tree may have shown last
	layout.treeTab = "documents";
	if ( isLowWidthViewport ) {
		document.body.classList.add("tree-drawer-open");
		saveLayout();
	} else {
		layout.treeHidden = false;
		saveLayout();
		fileTreeSearch.focus();
	}
	refreshFileTree(true);
}

function hideFileTree(){
	if ( isLowWidthViewport ) {
		document.body.classList.remove("tree-drawer-open");
	} else {
		layout.treeHidden = true;
		saveLayout();
	}
}

function closeTreeDrawer(){
	// after opening or creating a document; a pinned tree stays open
	if ( !treePinned ) { document.body.classList.remove("tree-drawer-open") }
}

function toggleFileTree(){
	// the tree showing the table of contents (toc.js) switches to the documents
	if ( isFileTreeVisible() && document.body.classList.contains("toc-in-tree") && layout.treeTab === "toc" ) { showFileTree(); return }
	isFileTreeVisible() ? hideFileTree() : showFileTree();
}

function refreshFileTree(force=false){
	const names = validateUserConsent(false) ? getDocumentNamesFromLocalStorage().sort((a, b) => a.localeCompare(b)) : null;
	const filter = fileTreeSearch.value.trim().toLowerCase();
	// autosave calls this on every keystroke, so skip rebuilding an unchanged tree
	const folders = names === null ? null : notebookStorage.getItem(foldersKey);
	const key = JSON.stringify([names, folders, filter, getDocumentName(), layout.collapsedFolders]);
	if ( !force && key === renderedTreeKey ) { return }
	renderedTreeKey = key;
	// deleted documents leave the selection
	if ( names ) { selectedDocuments = new Set([...selectedDocuments].filter(n => names.includes(n))) }

	renderDocumentTree(fileTreeList, names, filter);
	if ( docSearchTray.classList.contains("menu-opened") ) { renderDocSearch() }
}

function renderDocumentTree(list, names, filter){
	// the documents in their folders, or the ones matching the filter; the tree and the search tray (docSearch below)
	list.replaceChildren();
	if ( names === null ) {
		list.append(treeMessage("Agree to storing data to save documents."));
	} else if ( filter ) {
		const matches = names.filter(name => name.toLowerCase().includes(filter));
		matches.forEach(name => list.append(treeMatchItem(name)));
		// a folder opened as the notebook: its other files too (localnotebooks.js)
		const files = (notebookStorage.otherFiles?.() ?? []).filter(f => f.name.toLowerCase().includes(filter));
		files.forEach(f => list.append(treeFileItem(f, 0)));
		if ( !matches.length && !files.length ) { list.append(treeMessage("No matching documents.")) }
	} else if ( !names.length && !readFolders().folders.length && !notebookStorage.otherFiles?.().length ) {
		list.append(treeMessage("You don't have any saved documents yet. Just create one :)"));
	} else {
		renderFolders(list, names);
	}
}

function treeMatchItem(name){
	// a search match is shown without its folders: it has their color, as it has in the tree
	const li = treeDocumentItem(name, name, 0);
	const owner = folderColorOwner(folderOfDocument(name));
	if ( owner ) {
		li.classList.add("tree-match");
		applyFolderTint(li, owner);
	}
	return li;
}

function renderFolders(list, names){
	// folders first, then the documents that aren't in a folder
	const store = readFolders();
	const byFolder = new Map(store.folders.map(f => [f, []]));
	const loose = [];
	for ( const name of names ) {
		(byFolder.get(store.documents[name]) || loose).push(name);
	}
	renderFolderLevel(list, "", store.folders, byFolder, 0);
	loose.forEach(name => list.append(treeDocumentItem(name, name, 0)));
	folderFiles("").forEach(f => list.append(treeFileItem(f, 0)));
}

function folderFiles(folder){
	// a folder opened as the notebook lists its files that aren't documents too, after the documents (localnotebooks.js)
	return (notebookStorage.otherFiles?.() ?? []).filter(f => f.folder === folder).sort((a, b) => a.name.localeCompare(b.name));
}

function renderFolderLevel(list, parent, folders, byFolder, depth){
	const children = folders.filter(f => parentFolder(f) === parent).sort((a, b) => folderLabel(a).localeCompare(folderLabel(b)));
	for ( const folder of children ) {
		list.append(treeFolderItem(folder, folders, byFolder, depth));
	}
}

function treeFolderItem(folder, folders, byFolder, depth){
	const names = byFolder.get(folder);
	const collapsed = layout.collapsedFolders.includes(folder);
	const li = document.createElement("li");
	li.setAttribute("role", "treeitem");
	li.setAttribute("aria-expanded", String(!collapsed));
	li.dataset.folder = folder;
	// only a folder with a color of its own is tinted, sub-folders without one inherit it
	if ( folderColorValue(readFolders().colors[folder]) ) { applyFolderTint(li, folder) }
	const row = treeRow("tree-folder", folderLabel(folder), depth);
	row.title = `${displayFolder(folder)} (${names.length} document${names.length === 1 ? "" : "s"})`;
	row.draggable = true;
	row.addEventListener("dragstart", (e) => {
		e.stopPropagation();
		draggedFolder = folder;
		e.dataTransfer.effectAllowed = "move";
		e.dataTransfer.setData(folderDragType, folder);
		e.dataTransfer.setData("text/plain", folder);
	});
	row.addEventListener("dragend", () => {
		draggedFolder = null;
		clearDocumentDropTargets();
	});
	row.addEventListener("click", () => toggleFolder(folder));
	row.addEventListener("contextmenu", (e) => openContextMenu(e, [
		{ label: "New document in folder", action: () => createNewDocumentInFolder(folder) },
		{ label: "New sub-folder", action: () => createFolder(folder), disabled: folderDepth(folder) >= maxFolderDepth },
		{ label: "Rename folder", action: () => renameFolder(folder) },
		{ swatches: folderColorSwatches(folder) },
		{ label: "Move to top level", action: () => moveFolder(folder, ""), disabled: !parentFolder(folder) },
		{ label: "Delete folder", danger: true, action: () => deleteFolder(folder) },
		null,
		...treePanelMenuItems(),
	]));
	li.append(row);
	if ( !collapsed ) {
		const group = document.createElement("ul");
		group.setAttribute("role", "group");
		renderFolderLevel(group, folder, folders, byFolder, depth + 1);
		names.forEach(name => group.append(treeDocumentItem(name, name, depth + 1)));
		folderFiles(folder).forEach(f => group.append(treeFileItem(f, depth + 1)));
		if ( !group.children.length ) { group.append(treeMessage("Empty folder", depth + 1)) }
		li.append(group);
	}
	return li;
}

function treeDocumentItem(name, label, depth){
	const li = document.createElement("li");
	li.setAttribute("role", "treeitem");
	const row = treeRow("tree-document", label, depth);
	row.dataset.name = name;
	if ( notebookStorage.fileOf ) { addFileIcon(row, name) } // localnotebooks.js
	const folder = folderOfDocument(name);
	row.title = folder ? `${displayFolder(folder)} / ${name}` : name;
	row.draggable = true;
	row.addEventListener("dragstart", (e) => {
		// dragging a selected document takes the whole selection along
		draggedDocuments = selectedDocuments.has(name) ? [...selectedDocuments] : [name];
		e.dataTransfer.effectAllowed = "move";
		e.dataTransfer.setData(documentDragType, draggedDocuments.join("\n"));
		e.dataTransfer.setData("text/plain", draggedDocuments.join("\n"));
	});
	row.addEventListener("dragend", () => {
		draggedDocuments = null;
		clearDocumentDropTargets();
	});
	if ( name === getDocumentName() ) { row.classList.add("active") }
	li.setAttribute("aria-selected", String(selectedDocuments.has(name)));
	row.classList.toggle("selected", selectedDocuments.has(name));
	row.addEventListener("click", (e) => clickDocumentInTree(e, name));
	row.addEventListener("contextmenu", (e) => {
		// a selected document's menu acts on the selection, any other document's on itself
		const names = selectedDocuments.has(name) && selectedDocuments.size > 1 ? [...selectedDocuments] : [name];
		if ( names.length === 1 ) { clearDocumentSelection() }
		const count = names.length > 1 ? ` ${names.length} documents` : "";
		openContextMenu(e, [
			{ label: "Open" + count, action: () => names.forEach(openDocumentFromTree) },
			{ label: "Open in new window" + (names.length > 1 ? "s" : ""), action: () => names.forEach(openDocumentWindow) },
			{ label: "Duplicate" + count, action: () => duplicateDocuments(names) },
			{ label: "Get Document Id", action: () => documentIdNotification(name), disabled: names.length > 1 },
			...(notebookStorage.fileOf ? documentFileMenuItems(names) : []), // localnotebooks.js
			{ label: "Delete" + count, danger: true, action: () => names.length > 1 ? deleteDocuments(names) : deleteDocumentInLocalStorage(name) },
			...(names.length > 1 ? [{ label: "Clear selection", action: clearDocumentSelection }] : []),
			null,
			...checklistFoldMenuItems((change) => names.reduce((n, doc) => n + changeDocument(doc, change), 0)),
			titleMenuItem(storedDocumentMeta(names[0]).showTitle, (change) => names.forEach(doc => changeDocument(doc, change))),
			scriptsMenuItem(storedDocumentMeta(names[0]).scripts, (change) => names.forEach(doc => changeDocument(doc, change))), // scripting.js
			null,
			...moveToFolderMenuItems(names),
			null,
			...treePanelMenuItems(),
		]);
	});
	li.append(row);
	return li;
}

function clickDocumentInTree(e, name){
	// Ctrl/Cmd+click adds or removes one document, Shift+click selects a range, a plain click opens
	if ( e.shiftKey ) {
		const rows = [...fileTreeList.querySelectorAll(".tree-document")].map(r => r.dataset.name);
		const anchor = rows.includes(selectionAnchor) ? selectionAnchor : rows.includes(getDocumentName()) ? getDocumentName() : name;
		const [from, to] = [rows.indexOf(anchor), rows.indexOf(name)].sort((a, b) => a - b);
		if ( !(e.ctrlKey || e.metaKey) ) { selectedDocuments.clear() }
		rows.slice(from, to + 1).forEach(n => selectedDocuments.add(n));
		selectionAnchor = anchor;
	} else if ( e.ctrlKey || e.metaKey ) {
		if ( !selectedDocuments.size && name !== getDocumentName() && documentExists(getDocumentName()) ) {
			// the opened document is the start of the selection, like in a file explorer
			selectedDocuments.add(getDocumentName());
		}
		selectedDocuments.has(name) ? selectedDocuments.delete(name) : selectedDocuments.add(name);
		selectionAnchor = name;
	} else {
		selectedDocuments.clear();
		selectionAnchor = name;
		showDocumentSelection();
		openDocumentFromTree(name);
		return;
	}
	showDocumentSelection();
}

function showDocumentSelection(){
	// marks the selected rows without rebuilding the tree
	for ( const row of fileTreeList.querySelectorAll(".tree-document") ) {
		const selected = selectedDocuments.has(row.dataset.name);
		row.classList.toggle("selected", selected);
		row.parentElement.setAttribute("aria-selected", String(selected));
	}
}

function clearDocumentSelection(){
	selectedDocuments.clear();
	showDocumentSelection();
}

function treeRow(className, label, depth){
	const row = document.createElement("button");
	row.className = `tree-row ${className}`;
	row.style.setProperty("--depth", depth);
	const name = document.createElement("span");
	name.className = "tree-label";
	name.textContent = label;
	row.append(name);
	return row;
}

function setupNameTooltip(){
	// the full name of a tab, a document in the tree or an editor shown on hover, sooner than the
	// browser's own title tooltip; the element's title is held back while the tooltip is shown
	if ( !matchMedia("(hover: hover)").matches ) { return }
	const tooltip = document.createElement("div");
	tooltip.className = "name-tooltip";
	tooltip.setAttribute("role", "tooltip");
	document.body.append(tooltip);
	let target = null;
	let timer = null;

	const hide = () => {
		clearTimeout(timer);
		tooltip.classList.remove("visible");
		if ( target && target.dataset.tooltip !== undefined ) {
			if ( !target.hasAttribute("title") ) { target.title = target.dataset.tooltip }
			delete target.dataset.tooltip;
		}
		target = null;
	};
	const show = () => {
		if ( !target?.isConnected ) { return }
		tooltip.textContent = target.dataset.tooltip;
		if ( target.dataset.path ) {
			const path = document.createElement("span");
			path.className = "name-tooltip-path";
			path.textContent = target.dataset.path;
			tooltip.prepend(path);
		}
		tooltip.classList.add("visible");
		const rect = target.getBoundingClientRect();
		const width = tooltip.offsetWidth;
		const height = tooltip.offsetHeight;
		const left = Math.max(4, Math.min(rect.left, innerWidth - width - 4));
		const top = rect.bottom + 4 + height <= innerHeight ? rect.bottom + 4 : rect.top - height - 4;
		tooltip.style.left = `${left}px`;
		tooltip.style.top = `${top}px`;
	};

	document.addEventListener("mouseover", (e) => {
		const el = e.target.closest?.(".tab, .tree-row, .pane-name");
		if ( el === target ) { return }
		hide();
		if ( !el?.title ) { return }
		target = el;
		target.dataset.tooltip = target.title;
		target.removeAttribute("title");
		timer = setTimeout(show, 300);
	});
	document.addEventListener("mouseout", (e) => { if ( !e.relatedTarget ) { hide() } });   // the pointer left the page
	document.addEventListener("mousedown", hide, true);
	document.addEventListener("dragstart", hide, true);
	document.addEventListener("scroll", hide, true);
	window.addEventListener("blur", hide);
}

function treeMessage(text, depth=0){
	const li = document.createElement("li");
	li.className = "tree-message muted small";
	li.style.setProperty("--depth", depth);
	li.textContent = text;
	return li;
}

function toggleFolder(folder){
	const i = layout.collapsedFolders.indexOf(folder);
	i === -1 ? layout.collapsedFolders.push(folder) : layout.collapsedFolders.splice(i, 1);
	saveLayout();
	refreshFileTree(true);
}

function expandFolder(folder){
	// opens the folder and the folders it is in
	const shown = [folder, ...folderAncestors(folder)];
	const collapsed = layout.collapsedFolders.filter(f => !shown.includes(f));
	if ( collapsed.length !== layout.collapsedFolders.length ) {
		layout.collapsedFolders = collapsed;
		saveLayout();
	}
}

function setupDocumentDropping(){
	// a document or a folder dragged onto a folder goes into it, dropped anywhere else in the tree it goes to the top level
	const dragging = () => draggedDocuments !== null || draggedFolder !== null;
	const targetOf = (e) => e.target.closest("[data-folder]") || fileTreeList;
	fileTreeList.addEventListener("dragover", (e) => {
		if ( !dragging() ) { return }
		const target = targetOf(e);
		if ( draggedFolder !== null && !canMoveFolder(draggedFolder, target.dataset.folder || "") ) {
			clearDocumentDropTargets();
			return;
		}
		e.preventDefault();
		e.dataTransfer.dropEffect = "move";
		if ( !target.classList.contains("drop-target") ) {
			clearDocumentDropTargets();
			target.classList.add("drop-target");
		}
	});
	fileTreeList.addEventListener("dragleave", (e) => { if ( !fileTreeList.contains(e.relatedTarget) ) { clearDocumentDropTargets() } });
	fileTreeList.addEventListener("drop", (e) => {
		if ( !dragging() ) { return }
		e.preventDefault();
		const folder = targetOf(e).dataset.folder || "";
		const [names, dragged] = [draggedDocuments, draggedFolder];
		clearDocumentDropTargets();
		names !== null ? moveDocumentsToFolder(names, folder) : moveFolder(dragged, folder, true);
	});
}

function clearDocumentDropTargets(){
	fileTreeList.parentElement.querySelectorAll(".drop-target").forEach(x => x.classList.remove("drop-target"));
}

function revealDocumentInTree(name){
	// a double click on a tab: while the documents are shown, the folders the document is in open and the tree
	// scrolls to it; a filter that hides it is cleared
	const showingToc = document.body.classList.contains("toc-in-tree") && layout.treeTab === "toc";
	if ( !name || !documentExists(name) || !isFileTreeVisible() || showingToc ) { return false }
	if ( fileTreeSearch.value && !name.toLowerCase().includes(fileTreeSearch.value.trim().toLowerCase()) ) { fileTreeSearch.value = "" }
	expandFolder(folderOfDocument(name));
	refreshFileTree(true);
	const row = [...fileTreeList.querySelectorAll(".tree-document")].find(r => r.dataset.name === name);
	if ( !row ) { return false }
	row.scrollIntoView({ block: "nearest" });
	// a short flash, so it is found among the others
	row.classList.remove("revealed");
	void row.offsetWidth;
	row.classList.add("revealed");
	row.addEventListener("animationend", () => row.classList.remove("revealed"), { once: true });
	return true;
}

function openDocumentFromTree(name){
	loadDocumentFromLocalStorage(name);
	closeTreeDrawer();
}


// the document search tray, under the name field in the top bar: the tree's rows (and their menus), filtered by its search
function setupDocSearch(){
	const button = document.getElementById("doc-search-btn");
	button.addEventListener("click", (e) => {
		e.stopPropagation();
		docSearchTray.classList.contains("menu-opened") ? closeDocSearch() : openDocSearch();
	});
	docSearchInput.addEventListener("input", renderDocSearch);
	docSearchInput.addEventListener("keydown", (e) => {
		const rows = () => [...docSearchList.querySelectorAll(".tree-row")];
		if ( e.key === "ArrowDown" ) {
			e.preventDefault();
			rows()[0]?.focus();
		} else if ( e.key === "Enter" ) {
			// the first matching document
			e.preventDefault();
			docSearchList.querySelector(".tree-document")?.click();
		}
	});
	docSearchList.addEventListener("keydown", (e) => {
		const rows = [...docSearchList.querySelectorAll(".tree-row")];
		const i = rows.indexOf(document.activeElement);
		const move = { ArrowDown: 1, ArrowUp: -1 }[e.key];
		if ( !move || i === -1 ) { return }
		e.preventDefault();
		i + move < 0 ? docSearchInput.focus() : rows[Math.min(rows.length - 1, i + move)].focus();
	});
	// a document opened from the tray closes it (the row's own click opens it first); a folder opens or closes
	docSearchList.addEventListener("click", (e) => {
		const row = e.target.closest(".tree-document");
		if ( row && !(e.ctrlKey || e.metaKey || e.shiftKey) ) { closeDocSearch() }
	});
	document.addEventListener("pointerdown", (e) => {
		if ( !e.target.closest("#doc-name-field, #context-menu") ) { closeDocSearch() }
	}, true);
}

function openDocSearch(){
	docSearchTray.classList.add("menu-opened");
	document.getElementById("doc-search-btn").setAttribute("aria-expanded", "true");
	docSearchInput.value = "";
	renderDocSearch();
	docSearchInput.focus();
}

function closeDocSearch(){
	if ( !docSearchTray.classList.contains("menu-opened") ) { return }
	docSearchTray.classList.remove("menu-opened");
	document.getElementById("doc-search-btn").setAttribute("aria-expanded", "false");
}

function renderDocSearch(){
	const names = validateUserConsent(false) ? getDocumentNamesFromLocalStorage().sort((a, b) => a.localeCompare(b)) : null;
	renderDocumentTree(docSearchList, names, docSearchInput.value.trim().toLowerCase());
}


// the document's menu: what is done with one document, on its tab, its editor's head and the name field
function documentMenuItems(tab){
	// acts on the tab's document: it is shown in the focused editor first (the actions work on that one)
	const run = (action) => () => {
		if ( tab && tab.id !== focusedPane?.tabId ) { switchToTab(tab.id) }
		if ( !tab || tab.id === focusedPane?.tabId ) { action() }
	};
	return [
		{ label: "Search in Document", action: run(() => openFind()) }, // search.js
		{ label: "Insert or Append HTML", action: run(createInsertHtmlModal) },
		{ label: "Insert or Append Markdown", action: run(createInsertMarkdownModal) },
		{ label: "Copy as Markdown", action: run(() => { copyMarkdown(); createNotification("Copied as Markdown!", "info", notificationTimeoutShort) }) },
		{ label: "Export", action: run(exportDocument) },
		{ label: "Export as Markdown", action: run(exportMarkdown) },
		{ label: "Export as PDF", action: run(generatePDF), disabled: true },
	];
}


// tabs
function tabById(id){
	return tabs.find(t => t.id === id);
}

function getActiveTab(){
	// the focused editor's tab
	return tabById(focusedPane?.tabId);
}

function paneOfTab(tab){
	return panes.find(p => p.tabId === tab?.id);
}

function createTab(name, html=null, dirty=false){
	// folder: where the document goes when it is first saved (or saved under a new name)
	// savedName: the name the document is stored under, so a save under a new name renames it
	// position: where the document was left (positions below)
	const tab = { id: ++tabSeq, name, html, dirty, folder: name ? folderOfDocument(name) : "", savedName: name && documentExists(name) ? name : "" };
	tab.position = tab.savedName ? readJsonSetting(docPositionsKey)[tab.savedName] || null : null;
	const activeIndex = tabs.indexOf(getActiveTab());
	activeIndex === -1 ? tabs.push(tab) : tabs.splice(activeIndex + 1, 0, tab);
	return tab;
}

function switchToTab(id){
	// a tab already shown in an editor focuses it, any other is shown in the focused editor
	const tab = tabById(id);
	if ( !tab ) { return }
	const pane = paneOfTab(tab);
	if ( !pane && focusEditorsLocked() ) { return }
	pane ? focusPane(pane) : setPaneTab(focusedPane, tab);
}

function openDocumentInTab(name){
	// used by loadDocumentFromLocalStorage: focuses the document's tab, or opens a new one
	if ( !documentExists(name) ) {
		informError(`Document with name "${name}" has not been found!`, '');
		return false;
	}
	let tab = tabs.find(t => t.name === name);
	const pane = paneOfTab(tab);
	if ( pane && pane !== focusedPane ) {
		focusPane(pane);
		return true;
	}
	if ( !pane && focusEditorsLocked() ) { return false }
	const active = getActiveTab();
	if ( !tab && active && !active.name && !active.dirty ) {
		// an untouched untitled tab is replaced, not kept beside the document
		active.name = name;
		active.savedName = name;
		active.folder = folderOfDocument(name);
		tab = active;
	}
	setPaneTab(focusedPane, tab || createTab(name));
	return true;
}

function openNewTab(name="", html="", dirty=false){
	if ( focusEditorsLocked() ) { return }
	setPaneTab(focusedPane, createTab(name, html, dirty));
}

function closeTab(id){
	const tab = tabById(id);
	// vi's :q in the document window closes the window (docwindow.js)
	if ( tab && isDocWindow ) { closeDocWindow(); return }
	if ( !tab || focusEditorsLocked() ) { return }
	if ( tab.dirty && !showConfirm(`'${tab.name || untitledTabLabel}' has unsaved changes. Close it anyway?`) ) { return }
	const pane = paneOfTab(tab);
	const i = tabs.indexOf(tab);
	tabs.splice(i, 1);
	if ( pane ) {
		// the editor shows the nearest tab that isn't shown elsewhere, or closes
		pane.tabId = null;
		const hidden = (t) => !paneOfTab(t);
		const next = tabs.slice(i).find(hidden) || tabs.slice(0, i).reverse().find(hidden);
		if ( next ) {
			setPaneTab(pane, next);
		} else if ( panes.length > 1 ) {
			closePane(pane);
		} else {
			setPaneTab(pane, createTab(""));
		}
	}
	renderTabs();
	saveOpenedTabs();
}

function closeOtherTabs(id){
	switchToTab(id);
	tabs.filter(t => t.id !== id).forEach(t => closeTab(t.id));
}

function unsavedDocumentHtml(name){
	// the edits of a document that aren't saved to localStorage yet, or null
	const tab = tabs.find(t => t.name === name && t.dirty);
	if ( !tab ) { return null }
	const pane = paneOfTab(tab);
	return pane ? pane.editor.innerHTML : tab.html;
}

function reloadDocumentTabs(name, discardUnsaved=false){
	// the document changed in localStorage (pulled from the cloud): its tabs show the new content,
	// tabs with unsaved edits only when they are discarded
	const reloaded = tabs.filter(t => t.name === name && (discardUnsaved || !t.dirty));
	for ( const tab of reloaded ) {
		tab.dirty = false;
		tab.html = null;
		const pane = paneOfTab(tab);
		// the new content opens where the old one was left
		if ( pane ) { rememberPanePosition(pane); loadPane(pane) }
	}
	if ( reloaded.length ) { renderTabs() }
}

function renameDocumentTabs(oldName, newName){
	// the document was renamed on another device (cloudsync.js): its tabs follow
	const renamed = tabs.filter(t => t.savedName === oldName);
	for ( const tab of renamed ) {
		tab.savedName = newName;
		// a name typed here and not saved yet stays
		if ( tab.name !== oldName ) { continue }
		tab.name = newName;
		if ( tab.id === focusedPane?.tabId ) { documentNameObject.value = newName }
	}
	if ( !renamed.length ) { return }
	if ( notebookStorage.getItem(lastOpenedKey) === oldName ) { saveAsLastOpenedDocument(newName) }
	renderTabs();
	saveOpenedTabs();
}

function closeTabsOfDocument(name){
	// the document was deleted: its tabs go without asking
	for ( const tab of tabs.filter(t => t.name === name) ) {
		tab.dirty = false;
		closeTab(tab.id);
	}
}

function moveTab(id, beforeId){
	// reorders the tabs bar; beforeId null moves the tab to the end
	const tab = tabById(id);
	if ( !tab || id === beforeId ) { return }
	tabs.splice(tabs.indexOf(tab), 1);
	const i = tabs.indexOf(tabById(beforeId));
	i === -1 ? tabs.push(tab) : tabs.splice(i, 0, tab);
	renderTabs();
	saveOpenedTabs();
}

function markActiveTabSaved(){
	// called after the focused document is written to localStorage
	const tab = getActiveTab();
	if ( tab ) { markTabSaved(tab, getDocumentName()) }
	renderTabs();
	refreshFileTree();
	saveOpenedTabs();
}

function markTabSaved(tab, name){
	tab.name = name;
	tab.dirty = false;
	// a new or renamed document goes to the tab's folder, a document saved over keeps its own
	if ( tab.folder && !folderOfDocument(tab.name) ) { assignDocumentFolder(tab.name, tab.folder) }
	tab.folder = folderOfDocument(tab.name);
	if ( tab.savedName && tab.savedName !== tab.name ) { removeRenamedDocument(tab.savedName) }
	tab.savedName = tab.name;
}

function saveAllTabs(){
	// vi's :wa: every tab with unsaved changes is written to localStorage, where it is (shown or not);
	// untitled ones can't be, they are only counted
	if ( !validateUserConsent() ) { return }
	const unsaved = tabs.filter(t => t.dirty);
	const untitled = unsaved.filter(t => !tabLabelName(t));
	let saved = 0;
	try {
		for ( const tab of unsaved.filter(t => tabLabelName(t)) ) {
			const name = tabLabelName(tab);
			const pane = paneOfTab(tab);
			notebookStorage.setItem(docPrefix + name, documentHtmlToStore(tab, name, pane ? pane.editor.innerHTML : tab.html));
			markTabSaved(tab, name);
			// a tab that isn't shown reloads its document from localStorage (loadPane)
			if ( !pane ) { tab.html = null }
			saved++;
		}
	} catch ( err ) {
		informError("Could not save documents!", err);
	}
	if ( saved ) {
		const active = getActiveTab();
		if ( active?.name ) { saveAsLastOpenedDocument(active.name) }
		renderTabs();
		refreshFileTree();
		saveOpenedTabs();
	}
	if ( untitled.length ) {
		createNotification(`${saved} document${saved === 1 ? "" : "s"} saved, ${untitled.length} untitled not saved (no name)`, "warning");
	} else {
		createNotification(saved ? `${saved} document${saved === 1 ? "" : "s"} saved!` : "No unsaved documents", "info");
	}
}

function tabLabelName(tab){
	return tab.id === focusedPane?.tabId ? getDocumentName() : tab.name;
}

function removeRenamedDocument(oldName){
	// the document was saved under a new name: the old one goes, unless another tab still holds it
	if ( tabs.some(t => t.name === oldName) ) { return }
	notebookStorage.removeItem(docPrefix + oldName);
	forgetDocumentFolder(oldName);
}

function duplicateName(name){
	// "name (copy)", or "name (copy 2)", "name (copy 3)"... when that one is taken
	let copy = `${name} (copy)`;
	for ( let i = 2; documentExists(copy); i++ ) { copy = `${name} (copy ${i})` }
	return copy;
}

function duplicateDocuments(names){
	// each document is copied, with its unsaved edits, into its own folder under a new name and with its own id
	if ( !validateUserConsent() ) { return }
	const copies = [];
	try {
		for ( const name of names.filter(documentExists) ) {
			const copy = duplicateName(name);
			const stored = splitDocumentId(notebookStorage.getItem(docPrefix + name));
			const html = unsavedDocumentHtml(name) ?? stored.html;
			const meta = tabs.find(t => t.name === name && t.dirty)?.meta ?? stored.meta;
			notebookStorage.setItem(docPrefix + copy, withDocumentId(html, newDocumentId(), meta));
			assignDocumentFolder(copy, folderOfDocument(name));
			copies.push(copy);
		}
	} catch ( err ) {
		informError("Could not duplicate document!", err);
	}
	if ( !copies.length ) { return copies }
	refreshFileTree();
	syncFolders();
	duplicatedNotification(copies);
	return copies;
}

function duplicatedNotification(copies){
	// stays longer than the others, with a link to each copy: a click opens it, a ctrl/middle click opens it in a new browser tab
	const links = copies.map(copy => `'<a href="?${docLinkParam}=${documentIdOf(copy)}" data-copy="${escapeHtmlText(copy)}">${escapeHtmlText(copy)}</a>'`);
	const text = copies.length === 1 ? `Document ${links[0]} created!` : `${copies.length} documents duplicated: ${links.join(", ")}`;
	const notification = createNotification(text, "info", notificationTimeoutLong, true);
	notification?.querySelectorAll("a[data-copy]").forEach(link => link.addEventListener("click", (e) => {
		if ( e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey ) { return }
		e.preventDefault();
		if ( loadDocumentFromLocalStorage(link.dataset.copy) ) { closeNotification(notification) }
	}));
}

function documentIdNotification(name, id=null){
	// stays until closed: the id (doclinks.js) is there to be selected and copied
	ensureDocumentIds();
	id ||= documentIdOf(name);
	if ( !id ) { return null }
	return createNotification(`Document '${escapeHtmlText(name || untitledTabLabel)}' ID: <code class="document-id">${escapeHtmlText(id)}</code>`, "info", 0, true);
}

// changes to a document from its menus: shown in an editor it is changed there like after an edit (unsaved tab,
// autosave), with unsaved edits elsewhere those are changed, else the stored document is
function changeTabDocument(tab, change){
	// change(root, meta): root holds the document's content, meta is its metadata (documentMeta); returns what changed,
	// nothing when nothing did
	tab.meta ??= {};
	const pane = paneOfTab(tab);
	if ( pane ) {
		const changed = change(pane.editor, tab.meta);
		if ( changed && change.folds ) {
			foldsChanged(pane.editor); // folding.js
		} else if ( changed ) {
			pane.editor.dispatchEvent(new Event("input", { bubbles: true }));
			if ( pane === focusedPane ) { performAutoSave() }
		}
		return changed;
	}
	if ( tab.html === null ) { return tab.savedName ? changeStoredDocument(tab.savedName, change) : 0 }
	const root = document.createElement("div");
	root.innerHTML = tab.html;
	const changed = change(root, tab.meta);
	if ( changed ) {
		tab.html = root.innerHTML;
		tab.dirty = true;
		renderTabs();
	}
	return changed;
}

function changeDocument(name, change){
	const tab = tabs.find(t => t.name === name && (paneOfTab(t) || t.html !== null));
	return tab ? changeTabDocument(tab, change) : changeStoredDocument(name, change);
}

function changeStoredDocument(name, change){
	// folds aren't saved with documents (Settings > Save folding state): a document that isn't opened stays as it is
	if ( !documentExists(name) || (change.folds && !documentFoldsSaved()) ) { return 0 }
	const stored = splitDocumentId(notebookStorage.getItem(docPrefix + name));
	const root = document.createElement("div");
	root.innerHTML = stored.html;
	const changed = change(root, stored.meta);
	if ( !changed ) { return changed }
	try {
		notebookStorage.setItem(docPrefix + name, withDocumentId(root.innerHTML, stored.id || documentIdOf(name) || newDocumentId(), stored.meta));
	} catch ( err ) {
		informError("Could not save document!", err);
		return 0;
	}
	if ( typeof handleRemoteAutosave !== "undefined" ) { handleRemoteAutosave() } // the change goes to the cloud (cloudsync.js)
	return changed;
}

function checklistFoldMenuItems(changeEach){
	// changeEach(change): applies the change to the menu's documents, returns how many items it changed
	const run = (fold, done, none) => {
		// a change of the folds only (changeTabDocument)
		const count = changeEach(Object.assign((root) => fold(root), { folds: true }));
		if ( !count && !documentFoldsSaved() ) { none += " in the opened documents (folds aren't saved with documents, see Settings)" }
		createNotification(count ? `${count} checklist item${count === 1 ? "" : "s"} ${done}` : none, "info", count ? notificationTimeoutShort : notificationTimeout);
	};
	return [
		{ label: "Unfold all checkboxes", action: () => run(unfoldChecklists, "unfolded", "No folded checkboxes") },
		{ label: "Fold all completed checkboxes", action: () => run(foldCompletedChecklists, "folded", "No completed checkboxes to fold") },
	];
}

function storedDocumentMeta(name){
	// the metadata of a document as its opened tab has it, else as it is stored
	const tab = tabs.find(t => t.name === name && (paneOfTab(t) || t.html !== null));
	if ( tab ) { return tab.meta ?? {} }
	return documentExists(name) ? splitDocumentId(notebookStorage.getItem(docPrefix + name)).meta : {};
}

function tabDocumentMeta(tab){
	if ( !tab ) { return {} }
	if ( paneOfTab(tab) || tab.html !== null || !tab.savedName ) { return tab.meta ?? {} }
	return storedDocumentMeta(tab.savedName);
}

function titleMenuItem(shown, changeEach){
	// shows or hides the documents' title
	const change = (root, meta) => {
		if ( Boolean(meta.showTitle) === !shown ) { return 0 }
		shown ? delete meta.showTitle : meta.showTitle = true;
		return 1;
	};
	return { label: shown ? "Hide title" : "Show title", action: () => { changeEach(change); renderPanes() } };
}

// the title (line 0)
function setupDocumentTitle(pane){
	const title = pane.title;
	// only text: no formatting, no line breaks (Firefox before 136 doesn't know plaintext-only)
	try { title.contentEditable = "plaintext-only" } catch ( err ) { title.contentEditable = "true" }
	title.addEventListener("input", () => {
		if ( /[\r\n]/.test(title.textContent) ) { setTitleText(title, title.textContent.replace(/\s*[\r\n]+\s*/g, " ")) }
		// renames the document as typing in the name field does
		focusPane(pane);
		documentNameObject.value = title.textContent;
		documentNameObject.dispatchEvent(new Event("input"));
		updateTitle();
	});
	title.addEventListener("keydown", (e) => {
		// Enter, Esc or the arrow down go on to the text
		if ( ["Enter", "Escape", "ArrowDown"].includes(e.key) && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey ) {
			e.preventDefault();
			e.stopPropagation();
			caretToEditorStart(pane.editor);
			return;
		}
		// the editors' keys (autosave on each key, which would rename the document letter by letter; lists, tabs) aren't
		// for the title; shortcuts go on
		if ( !e.ctrlKey && !e.metaKey && !e.altKey ) { e.stopPropagation() }
	});
	title.addEventListener("paste", (e) => {
		e.preventDefault();
		e.stopPropagation();
		const text = e.clipboardData.getData("text/plain").replace(/\s*[\r\n]+\s*/g, " ");
		document.execCommand("insertText", false, text);
	});
	title.addEventListener("drop", (e) => e.preventDefault());
	// from the first line of the text, the arrow up goes to the title
	pane.editor.addEventListener("keydown", (e) => {
		if ( e.key !== "ArrowUp" || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || title.hidden || !caretOnFirstRow(pane.editor) ) { return }
		e.preventDefault();
		title.focus();
		const caret = document.createRange();
		caret.selectNodeContents(title);
		caret.collapse(false);
		const selection = window.getSelection();
		selection.removeAllRanges();
		selection.addRange(caret);
	});
}

function setTitleText(title, text){
	// keeps the caret at the end while it is being typed in
	title.textContent = text;
	if ( document.activeElement !== title ) { return }
	const caret = document.createRange();
	caret.selectNodeContents(title);
	caret.collapse(false);
	window.getSelection().removeAllRanges();
	window.getSelection().addRange(caret);
}

function caretToEditorStart(editor){
	editor.focus({ preventScroll: true });
	const first = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT).nextNode();
	const caret = document.createRange();
	caret.setStart(first || editor, 0);
	caret.collapse(true);
	const selection = window.getSelection();
	selection.removeAllRanges();
	selection.addRange(caret);
}

function caretOnFirstRow(editor){
	const selection = window.getSelection();
	if ( !selection.rangeCount || !selection.isCollapsed || !editor.contains(selection.focusNode) ) { return false }
	const range = selection.getRangeAt(0);
	const rect = range.getClientRects()[0] || elementOf(range.startContainer)?.getBoundingClientRect();
	const first = [...editor.children].find(el => el.getClientRects().length) || editor;
	if ( !rect ) { return false }
	const lineHeight = parseFloat(getComputedStyle(first).lineHeight) || parseFloat(getComputedStyle(first).fontSize) * 1.5;
	return rect.top < first.getBoundingClientRect().top + lineHeight;
}

function renderPaneTitle(pane, tab){
	const shown = Boolean(tab && tabDocumentMeta(tab).showTitle);
	if ( pane.title.hidden === shown ) {
		pane.title.hidden = !shown;
		if ( typeof scheduleLineNumbers !== "undefined" ) { scheduleLineNumbers() } // linenumbers.js loads after this file
	}
	if ( !shown || document.activeElement === pane.title ) { return }
	const name = tabLabelName(tab);
	if ( pane.title.textContent !== name ) { pane.title.textContent = name }
}

function tabLabel(tab){
	const name = tab.id === focusedPane?.tabId ? getDocumentName() : tab.name;
	return name || untitledTabLabel;
}

function renderTabs(){
	tabsContainer.replaceChildren();
	for ( const tab of tabs ) {
		const isActive = tab.id === focusedPane?.tabId;
		const pane = paneOfTab(tab);
		const label = tabLabel(tab);
		const el = document.createElement("div");
		el.className = "tab" + (isActive ? " active" : "") + (pane && !isActive ? " shown" : "") + (tab.dirty ? " dirty" : "");
		el.dataset.tabId = tab.id;
		el.setAttribute("role", "tab");
		el.setAttribute("aria-selected", String(isActive));
		el.tabIndex = isActive ? 0 : -1;
		el.title = label + (tab.dirty ? " (unsaved)" : "") + (pane && panes.length > 1 ? ` - editor ${panes.indexOf(pane) + 1}` : "");
		// the folders the document is in, shown grayed out before the name in the hover tooltip
		if ( tab.name || label !== untitledTabLabel ) { el.dataset.path = folderSeparator + (tab.folder ? tab.folder + folderSeparator : "") }
		const owner = folderColorOwner(tab.folder || "");
		if ( owner ) { applyFolderTint(el, owner, true) }
		el.draggable = true;

		const name = document.createElement("span");
		name.className = "tab-name";
		name.textContent = label;
		if ( pane && panes.length > 1 ) {
			// which editor shows the tab
			const badge = document.createElement("span");
			badge.className = "tab-pane-badge";
			badge.textContent = panes.indexOf(pane) + 1;
			el.append(badge);
		}
		const close = document.createElement("button");
		close.className = "tab-close";
		close.setAttribute("aria-label", `Close ${label}`);
		close.title = "Close";
		close.addEventListener("click", (e) => { e.stopPropagation(); closeTab(tab.id) });

		el.append(name, close);
		el.addEventListener("click", () => switchToTab(tab.id));
		el.addEventListener("keydown", (e) => { if ( e.key === "Enter" || e.key === " " ) { e.preventDefault(); switchToTab(tab.id) } });
		el.addEventListener("auxclick", (e) => { if ( e.button === 1 ) { e.preventDefault(); closeTab(tab.id) } });
		el.addEventListener("contextmenu", (e) => openContextMenu(e, [
			{ label: "Close", action: () => closeTab(tab.id) },
			{ label: "Close others", action: () => closeOtherTabs(tab.id), disabled: tabs.length < 2 },
			{ label: "Open to the side", action: () => splitEditor(tab), disabled: Boolean(pane) || panes.length >= maxEditors },
			{ label: "Open in new window", action: () => openDocumentWindow(tab.name), disabled: !tab.name || !documentExists(tab.name) },
			{ label: "Duplicate", action: () => duplicateDocuments([tab.name]), disabled: !tab.name || !documentExists(tab.name) },
			{ label: "Get Document Id", action: () => documentIdNotification(tab.savedName, tab.docId), disabled: !(tab.docId || (tab.savedName && documentExists(tab.savedName))) },
			null,
			...documentMenuItems(tab),
			null,
			...checklistFoldMenuItems((change) => changeTabDocument(tab, change)),
			titleMenuItem(tabDocumentMeta(tab).showTitle, (change) => changeTabDocument(tab, change)),
			scriptsMenuItem(tabDocumentMeta(tab).scripts, (change) => changeTabDocument(tab, change)), // scripting.js
			null,
			...tabsPanelMenuItems(),
		]));
		setupTabDragging(el, tab);
		tabsContainer.append(el);
	}
	revealActiveTab();
	renderPanes();
}

function revealActiveTab(){
	// scroll only the tab strip: scrollIntoView also scrolls every ancestor, and renderTabs runs
	// on each autosave, so typing (Enter on mobile) jumped the editor and the page around
	const active = tabsContainer.querySelector(".tab.active");
	if ( !active ) { return }
	const strip = tabsContainer.getBoundingClientRect();
	const rect = active.getBoundingClientRect();
	if ( rect.left < strip.left ) {
		tabsContainer.scrollLeft -= strip.left - rect.left;
	} else if ( rect.right > strip.right ) {
		tabsContainer.scrollLeft += Math.min(rect.right - strip.right, rect.left - strip.left);
	}
}

function setupTabDragging(el, tab){
	// drag a tab along the bar to reorder it, or onto an editor to show it there
	el.addEventListener("dragstart", (e) => {
		draggedTabId = tab.id;
		e.dataTransfer.effectAllowed = "move";
		e.dataTransfer.setData(tabDragType, String(tab.id));
		e.dataTransfer.setData("text/plain", tabLabel(tab));
		el.classList.add("dragging");
	});
	el.addEventListener("dragend", () => {
		draggedTabId = null;
		document.querySelectorAll(".drop-before, .drop-after, .drop-target").forEach(x => x.classList.remove("drop-before", "drop-after", "drop-target"));
		el.classList.remove("dragging");
	});
	el.addEventListener("dragover", (e) => {
		if ( draggedTabId === null ) { return }
		e.preventDefault();
		const after = e.clientX > el.getBoundingClientRect().left + el.offsetWidth / 2;
		el.classList.toggle("drop-after", after);
		el.classList.toggle("drop-before", !after);
	});
	el.addEventListener("dragleave", () => el.classList.remove("drop-before", "drop-after"));
	el.addEventListener("drop", (e) => {
		if ( draggedTabId === null ) { return }
		e.preventDefault();
		const after = el.classList.contains("drop-after");
		el.classList.remove("drop-before", "drop-after");
		const i = tabs.indexOf(tab);
		moveTab(draggedTabId, after ? tabs[i + 1]?.id ?? null : tab.id);
	});
}


// editors (split view)
function setupPane(el){
	const pane = { tabId: null, el, editor: el.querySelector(".editor"), title: el.querySelector(".doc-title") };
	el.querySelector(".floating-headings").hidden = true;
	setupDocumentTitle(pane);
	// focus follows the caret or a click anywhere in the pane
	el.addEventListener("focusin", () => focusPane(pane));
	el.addEventListener("mousedown", () => focusPane(pane));
	pane.editor.addEventListener("input", () => {
		const tab = tabById(pane.tabId);
		if ( tab && !tab.dirty ) {
			tab.dirty = true;
			renderTabs();
		}
	});
	el.querySelector(".pane-close").addEventListener("click", (e) => { e.stopPropagation(); closePane(pane) });
	el.querySelector(".pane-head").addEventListener("contextmenu", (e) => openContextMenu(e, [
		{ label: "Close editor", action: () => closePane(pane), disabled: panes.length < 2 },
		{ label: "Split editor", action: () => splitEditor(), disabled: panes.length >= maxEditors },
		{ label: "Open in new window", action: () => openDocumentWindow(tabById(pane.tabId)?.name), disabled: !tabById(pane.tabId)?.name || !documentExists(tabById(pane.tabId).name) },
		null,
		...documentMenuItems(tabById(pane.tabId)),
		null,
		...checklistFoldMenuItems((change) => tabById(pane.tabId) ? changeTabDocument(tabById(pane.tabId), change) : 0),
		titleMenuItem(tabDocumentMeta(tabById(pane.tabId)).showTitle, (change) => tabById(pane.tabId) && changeTabDocument(tabById(pane.tabId), change)),
		scriptsMenuItem(tabDocumentMeta(tabById(pane.tabId)).scripts, (change) => tabById(pane.tabId) && changeTabDocument(tabById(pane.tabId), change)), // scripting.js
	]));
	// drag an editor by its header onto another editor to swap their places
	const head = el.querySelector(".pane-head");
	head.addEventListener("dragstart", (e) => {
		if ( e.target !== head ) { return }
		draggedPane = pane;
		e.dataTransfer.effectAllowed = "move";
		e.dataTransfer.setData("text/plain", head.querySelector(".pane-name").textContent);   // Firefox only starts a drag with data
		el.classList.add("dragging");
	});
	head.addEventListener("dragend", () => {
		draggedPane = null;
		el.classList.remove("dragging");
		panes.forEach(p => p.el.classList.remove("drop-target"));
	});
	// a dragged tab is shown in the editor, a dragged editor swaps places with it
	const acceptsDrop = () => draggedTabId !== null || (draggedPane !== null && draggedPane !== pane);
	el.addEventListener("dragover", (e) => {
		if ( !acceptsDrop() ) { return }
		e.preventDefault();
		el.classList.add("drop-target");
	});
	el.addEventListener("dragleave", (e) => { if ( !el.contains(e.relatedTarget) ) { el.classList.remove("drop-target") } });
	el.addEventListener("drop", (e) => {
		if ( !acceptsDrop() ) { return }
		e.preventDefault();
		el.classList.remove("drop-target");
		if ( draggedPane ) {
			swapPanes(draggedPane, pane);
		} else if ( !focusEditorsLocked() ) {
			setPaneTab(pane, tabById(draggedTabId));
			focusPane(pane);
		}
	});
	return pane;
}

function swapPanes(a, b){
	// swaps the editors' places in the grid; their documents and unsaved edits move with them
	const ia = panes.indexOf(a);
	const ib = panes.indexOf(b);
	panes[ia] = b;
	panes[ib] = a;
	const marker = document.createComment("");
	a.el.replaceWith(marker);
	b.el.replaceWith(a.el);
	marker.replaceWith(b.el);
	// moving the elements drops the caret, so give it back to the dragged editor
	focusPane(a);
	a.editor.focus();
	renderTabs();
	saveOpenedTabs();
}

function addPane(after=focusedPane){
	const el = paneTemplate.cloneNode(true);
	el.classList.remove("focused");
	el.querySelector(".editor").spellcheck = editorObject.spellcheck;
	const pane = setupPane(el);
	panes.splice(panes.indexOf(after) + 1, 0, pane);
	after.el.after(el);
	return pane;
}

function stashPane(pane){
	// keep the editor's content only if it is unsaved; saved documents reload from localStorage
	const tab = tabById(pane.tabId);
	if ( tab ) { tab.html = tab.dirty ? pane.editor.innerHTML : null }
	rememberPanePosition(pane);
}

function loadPane(pane){
	const tab = tabById(pane.tabId);
	let html = tab.html;
	if ( html === null ) {
		// the stored document's id stays on the tab, the editor shows only the content (doclinks.js)
		const stored = splitDocumentId(documentExists(tab.name) ? notebookStorage.getItem(docPrefix + tab.name) : "");
		html = stored.html;
		if ( stored.id ) { tab.docId = stored.id }
		tab.meta = stored.meta;
	}
	tab.html = null;
	pane.editor.innerHTML = html;
	moveListsOutOfItems(pane.editor);
	moveHeadingsOutOfLines(pane.editor);
	moveRulesOutOfLines(pane.editor);
	removeInlineStyles(pane.editor);
	if ( typeof normalizeChecklists !== "undefined" ) { normalizeChecklists(pane.editor) } // checklist.js loads after this file
	if ( typeof applyHeadingFolds !== "undefined" ) { applyHeadingFolds(pane.editor); normalizeListFolds(pane.editor) } // folding.js loads after this file
	restorePanePosition(pane);
}

function setPaneTab(pane, tab){
	// shows the tab in the pane; a tab shown in another pane swaps places with this pane's tab
	const other = panes.find(p => p !== pane && p.tabId === tab.id);
	stashPane(pane);
	if ( other ) {
		stashPane(other);
		other.tabId = pane.tabId;
	}
	pane.tabId = tab.id;
	loadPane(pane);
	if ( other ) {
		other.tabId === null ? closePane(other) : loadPane(other);
	}
	if ( pane === focusedPane || other === focusedPane ) { showFocusedDocument() }
	renderTabs();
	refreshFileTree();
	saveOpenedTabs();
}

function focusPane(pane){
	if ( pane === focusedPane ) { return }
	focusedPane?.editor.removeAttribute("id");
	focusedPane = pane;
	pane.editor.id = "editor";
	editorObject = pane.editor;
	showFocusedDocument();
	renderTabs();
	refreshFileTree();
	saveOpenedTabs();
}

function showFocusedDocument(){
	// the top bar, title, word counter and "last opened" follow the focused editor
	const tab = getActiveTab();
	fillDocName(tab ? tab.name : "");
	if ( validateUserConsent(false) ) { saveAsLastOpenedDocument(tab?.name || null) }
	handleWordCounter();
	updateBlockSelect();
}

function splitEditor(tab=null){
	// opens an editor next to the focused one, with the given tab, the next hidden tab or a new one
	if ( focusEditorsLocked() ) { return }
	if ( panes.length >= maxEditors ) {
		createNotification(`Up to ${maxEditors} editors can be opened side by side.`, "warning");
		return;
	}
	tab = tab || tabs.find(t => !paneOfTab(t)) || createTab("");
	const pane = addPane();
	setPaneTab(pane, tab);
	focusPane(pane);
	pane.editor.focus();
}

function closePane(pane){
	if ( panes.length < 2 || focusEditorsLocked() ) { return }
	stashPane(pane);
	const i = panes.indexOf(pane);
	panes.splice(i, 1);
	pane.el.remove();
	if ( pane === focusedPane ) {
		focusedPane = null;
		focusPane(panes[Math.max(0, i - 1)]);
	} else {
		renderTabs();
		saveOpenedTabs();
	}
}

// focus mode with "Opened editors": every opened tab in its own editor (up to maxEditors), reordered by dragging
// an editor's name onto another; documents are opened and closed after leaving
function focusEditorsLocked(){
	// the document window shows only its document, once it is opened (docwindow.js)
	if ( isDocWindow && docWindowTab ) {
		createNotification("This window shows only this document", "warning");
		return true;
	}
	if ( !focusLayout ) { return false }
	createNotification("Leave focus mode to open or close documents", "warning");
	return true;
}

function showTabsInPanes(shown, focusedTab){
	// the editors show these tabs, in this order; unsaved edits go along (stashPane / loadPane)
	panes.forEach(stashPane);
	while ( panes.length < shown.length ) { addPane(panes[panes.length - 1]) }
	while ( panes.length > shown.length ) { panes.pop().el.remove() }
	shown.forEach((tab, i) => { panes[i].tabId = tab.id; loadPane(panes[i]) });
	focusedPane?.editor.removeAttribute("id");
	focusedPane = null;
	focusPane(paneOfTab(focusedTab) || panes[0]);
}

function enterFocusEditors(){
	if ( focusLayout ) { return true }
	const active = getActiveTab();
	// the focused tab, and the others in their order, as many as fit
	let shown = tabs.slice(0, maxEditors);
	if ( !shown.includes(active) ) { shown = [...tabs.filter(t => t !== active).slice(0, maxEditors - 1), active] }
	shown = tabs.filter(t => shown.includes(t));
	if ( shown.length < 2 ) { return false }
	if ( tabs.length > shown.length ) {
		createNotification(`Focus mode shows ${shown.length} of the ${tabs.length} opened documents: up to ${maxEditors} fit side by side.`, "info");
	}
	// set first: what is saved for the next visit stays the editors from before
	focusLayout = { tabIds: panes.map(p => p.tabId), focused: active?.id };
	showTabsInPanes(shown, active);
	return true;
}

function leaveFocusEditors(){
	if ( !focusLayout ) { return }
	const { tabIds, focused } = focusLayout;
	focusLayout = null;
	// the editors from before; the document focused now stays in front, in the place of the one focused then
	const active = getActiveTab();
	const ids = tabIds.includes(active?.id) ? tabIds : tabIds.map(id => id === focused ? active.id : id);
	showTabsInPanes(ids.map(tabById).filter(Boolean), active);
	focusedPane.editor.focus({ preventScroll: true });
}

function renderPanes(){
	editorGrid.dataset.count = panes.length;
	document.body.dataset.editors = panes.length;
	document.getElementById("split-btn").disabled = panes.length >= maxEditors;
	panes.forEach((pane, i) => {
		const tab = tabById(pane.tabId);
		const isFocused = pane === focusedPane;
		pane.el.classList.toggle("focused", isFocused);
		pane.el.querySelector(".pane-number").textContent = i + 1;
		const paneName = pane.el.querySelector(".pane-name");
		paneName.textContent = (tab ? tabLabel(tab) : untitledTabLabel) + (tab?.dirty ? " ●" : "");
		paneName.title = (tab ? tabLabel(tab) : untitledTabLabel) + (tab?.dirty ? " (unsaved)" : "");
		pane.el.setAttribute("aria-label", `Editor ${i + 1}` + (isFocused ? " (focused)" : ""));
		renderPaneTitle(pane, tab);
	});
	if ( typeof renderScripting !== "undefined" ) { renderScripting() } // scripting.js loads after this file
	if ( typeof scheduleFloatingHeadings !== "undefined" ) { scheduleFloatingHeadings() } // floatingheadings.js loads after this file
}


// positions: where each opened document was left; the caret is kept by its node's path in the editor, the document
// opens as it was saved, so the path leads back to the same place
function nodePath(root, node){
	const path = [];
	for ( ; node !== root; node = node.parentNode ) {
		if ( !node?.parentNode ) { return null }
		path.unshift([...node.parentNode.childNodes].indexOf(node));
	}
	return path;
}

function nodeAtPath(root, path){
	let node = root;
	for ( const i of path || [] ) { node = node?.childNodes[i] }
	return node || null;
}

function paneOfEditor(editor){
	return panes.find(p => p.editor === editor);
}

function rememberPanePosition(pane){
	// the editor's scroll; the caret if it is in the editor, else where it was last seen there (rememberCaret)
	const tab = tabById(pane.tabId);
	if ( !tab ) { return }
	tab.position = { scroll: pane.el.querySelector(".pane-scroll").scrollTop, caret: tab.position?.caret || null };
	rememberCaret(pane);
	schedulePositions();
}

function rememberCaret(pane){
	const tab = tabById(pane.tabId);
	const selection = window.getSelection();
	if ( !tab || !selection.rangeCount || !pane.editor.contains(selection.focusNode) ) { return }
	const path = nodePath(pane.editor, selection.focusNode);
	if ( !path ) { return }
	tab.position = { scroll: tab.position?.scroll ?? 0, caret: { path, offset: selection.focusOffset } };
	schedulePositions();
}

function restorePanePosition(pane){
	// the scroll goes back, and the caret in the focused editor; the focus stays where it is (the tree, a tab)
	const tab = tabById(pane.tabId);
	const position = tab?.position;
	if ( !position ) { return }
	pane.el.querySelector(".pane-scroll").scrollTop = position.scroll || 0;
	const node = pane === focusedPane && position.caret ? nodeAtPath(pane.editor, position.caret.path) : null;
	if ( !node ) { return }
	const range = document.createRange();
	range.setStart(node, Math.min(position.caret.offset, node.nodeType === Node.TEXT_NODE ? node.data.length : node.childNodes.length));
	range.collapse(true);
	lastEditorRange = range.cloneRange();
	const selection = window.getSelection();
	selection.removeAllRanges();
	selection.addRange(range);
}

function schedulePositions(){
	clearTimeout(positionsTimer);
	positionsTimer = setTimeout(savePositions, 500);
}

function savePositions(){
	// the positions of the opened saved documents: a closed one is left out, so it is forgotten. The document window
	// keeps its own only while it is open
	clearTimeout(positionsTimer);
	if ( !validateUserConsent(false) || isDocWindow ) { return }
	tabs.forEach(t => { const pane = paneOfTab(t); if ( pane ) { t.position = { scroll: pane.el.querySelector(".pane-scroll").scrollTop, caret: t.position?.caret || null } } });
	const positions = Object.fromEntries(tabs.filter(t => t.savedName && t.position).map(t => [t.savedName, t.position]));
	notebookStorage.setItem(docPositionsKey, JSON.stringify(positions));
}

document.addEventListener("selectionchange", () => {
	const selection = window.getSelection();
	const pane = selection.rangeCount && paneOfEditor(selection.focusNode?.parentElement?.closest(".editor") || selection.focusNode);
	if ( pane ) { rememberCaret(pane) }
});
document.addEventListener("scroll", (e) => { if ( e.target.classList?.contains("pane-scroll") ) { schedulePositions() } }, true);


// folders
function readFolders(){
	// {folders: [name], documents: {documentName: folderName}, colors: {folderName: colorKey}}
	const store = readJsonSetting(foldersKey);
	return {
		folders: Array.isArray(store.folders) ? normalizeFolders(store.folders.filter(f => typeof f === "string")) : [],
		documents: store.documents && typeof store.documents === "object" ? store.documents : {},
		colors: store.colors && typeof store.colors === "object" ? store.colors : {},
	};
}

function writeFolders(store){
	if ( !validateUserConsent() ) { return }
	notebookStorage.setItem(foldersKey, JSON.stringify(store));
	refreshFileTree();
}

function syncFolders(){
	// folder changes reach the cloud with remote autosave, otherwise with the next push
	if ( typeof handleRemoteAutosave !== "undefined" ) { handleRemoteAutosave() }
}

function folderOfDocument(name){
	if ( !validateUserConsent(false) ) { return "" }
	const store = readFolders();
	const folder = store.documents[name];
	return store.folders.includes(folder) ? folder : "";
}

function assignDocumentFolder(name, folder){
	const store = readFolders();
	if ( folder && store.folders.includes(folder) ) {
		store.documents[name] = folder;
	} else {
		delete store.documents[name];
	}
	writeFolders(store);
}

function forgetDocumentFolder(name){
	// the document was deleted; a new one with its name starts outside of folders
	if ( !validateUserConsent(false) || !(name in readFolders().documents) ) { return }
	assignDocumentFolder(name, "");
}

function folderDepth(folder){
	return folder ? folder.split(folderSeparator).length : 0;
}

function parentFolder(folder){
	const i = folder.lastIndexOf(folderSeparator);
	return i === -1 ? "" : folder.slice(0, i);
}

function folderLabel(folder){
	return folder.slice(folder.lastIndexOf(folderSeparator) + 1);
}

function displayFolder(folder){
	return folder.split(folderSeparator).join(" / ");
}

function folderAncestors(folder){
	const ancestors = [];
	for ( let f = parentFolder(folder); f; f = parentFolder(f) ) { ancestors.push(f) }
	return ancestors;
}

function isInFolder(folder, ancestor){
	// the folder itself or any folder under it
	return folder === ancestor || folder.startsWith(ancestor + folderSeparator);
}

function joinFolder(parent, name){
	return parent ? parent + folderSeparator + name : name;
}

function subtreeHeight(folder, folders){
	// levels the folder takes up, itself included
	return Math.max(...folders.filter(f => isInFolder(f, folder)).map(f => folderDepth(f) - folderDepth(folder) + 1));
}

function validFolderName(name, parent="", current=null){
	name = (name || "").trim();
	if ( !name ) { return null }
	if ( name.includes(folderSeparator) ) {
		createNotification(`Folder name can't contain '${folderSeparator}'!`, "error");
		return null;
	}
	const path = joinFolder(parent, name);
	if ( path !== current && readFolders().folders.includes(path) ) {
		createNotification(`Folder '${displayFolder(path)}' already exists!`, "error");
		return null;
	}
	return name;
}

function createFolder(parent=""){
	if ( !validateUserConsent() ) { return null }
	if ( folderDepth(parent) >= maxFolderDepth ) {
		createNotification(`Folders can be nested up to ${maxFolderDepth} levels.`, "warning");
		return null;
	}
	const name = validFolderName(window.prompt(parent ? `New sub-folder in '${displayFolder(parent)}':` : "New folder name:"), parent);
	if ( !name ) { return null }
	const folder = joinFolder(parent, name);
	const store = readFolders();
	store.folders.push(folder);
	expandFolder(folder);
	writeFolders(store);
	syncFolders();
	return folder;
}

function renameFolder(folder){
	const parent = parentFolder(folder);
	const name = validFolderName(window.prompt("Rename folder:", folderLabel(folder)), parent, folder);
	if ( !name ) { return }
	relocateFolder(folder, joinFolder(parent, name));
}

function canMoveFolder(folder, parent){
	// not into itself, not where it already is, and no deeper than maxFolderDepth
	if ( isInFolder(parent, folder) || parentFolder(folder) === parent ) { return false }
	return folderDepth(parent) + subtreeHeight(folder, readFolders().folders) <= maxFolderDepth;
}

function moveFolder(folder, parent, fromDrop=false){
	if ( !canMoveFolder(folder, parent) ) {
		if ( !fromDrop && parentFolder(folder) !== parent ) {
			createNotification(`Folders can be nested up to ${maxFolderDepth} levels.`, "warning");
		}
		return;
	}
	const path = joinFolder(parent, folderLabel(folder));
	if ( readFolders().folders.includes(path) ) {
		createNotification(`Folder '${displayFolder(path)}' already exists!`, "error");
		return;
	}
	relocateFolder(folder, path);
}

function relocateFolder(folder, path){
	// renames or moves the folder together with its sub-folders and documents
	if ( folder === path ) { return }
	const moved = (f) => isInFolder(f, folder) ? path + f.slice(folder.length) : f;
	const store = readFolders();
	store.folders = store.folders.map(moved);
	for ( const [doc, f] of Object.entries(store.documents) ) { store.documents[doc] = moved(f) }
	store.colors = Object.fromEntries(Object.entries(store.colors).map(([f, c]) => [moved(f), c]));
	tabs.forEach(t => t.folder = moved(t.folder || ""));
	layout.collapsedFolders = layout.collapsedFolders.map(moved);
	expandFolder(parentFolder(path));
	saveLayout();
	// a folder opened as the notebook moves the folder on the disk, with whatever else is in it (localnotebooks.js)
	notebookStorage.relocateFolder?.(folder, path);
	writeFolders(store);
	renderTabs();
	syncFolders();
}

function deleteFolder(folder){
	// a folder with documents or sub-folders goes only after confirmation, together with all of them
	const store = readFolders();
	const subfolders = store.folders.filter(f => f !== folder && isInFolder(f, folder));
	const names = getDocumentNamesFromLocalStorage().filter(name => isInFolder(store.documents[name] || "", folder)).sort((a, b) => a.localeCompare(b));
	// a folder opened as the notebook: the folder's other files go to the trash with it (localnotebooks.js)
	const files = (notebookStorage.otherFiles?.() ?? []).filter(f => isInFolder(f.folder, folder));
	if ( names.length || subfolders.length || files.length ) {
		const counts = [
			names.length ? `${names.length} document${names.length === 1 ? "" : "s"}` : "",
			subfolders.length ? `${subfolders.length} sub-folder${subfolders.length === 1 ? "" : "s"}` : "",
			files.length ? `${files.length} other file${files.length === 1 ? "" : "s"}` : "",
		].filter(Boolean).join(", ").replace(/, ([^,]*)$/, " and $1");
		const shown = names.slice(0, 10).map(name => `- ${name}`).join("\n") + (names.length > 10 ? `\n...and ${names.length - 10} more` : "");
		if ( !showConfirm(`Folder '${displayFolder(folder)}' is not empty. Delete it together with its ${counts}?` + (shown ? `\n\n${shown}` : "")) ) { return }
	}
	for ( const name of names ) {
		notebookStorage.removeItem(docPrefix + name);
		closeTabsOfDocument(name);
	}
	notebookStorage.deleteFolder?.(folder);
	store.folders = store.folders.filter(f => !isInFolder(f, folder));
	for ( const [doc, f] of Object.entries(store.documents) ) {
		if ( isInFolder(f, folder) ) { delete store.documents[doc] }
	}
	for ( const f of Object.keys(store.colors) ) {
		if ( isInFolder(f, folder) ) { delete store.colors[f] }
	}
	tabs.filter(t => isInFolder(t.folder || "", folder)).forEach(t => t.folder = "");
	layout.collapsedFolders = layout.collapsedFolders.filter(f => !isInFolder(f, folder));
	saveLayout();
	writeFolders(store);
	renderTabs();
	syncFolders(); // the deleted documents go to the cloud with the folders
}

function moveDocumentsToFolder(names, folder){
	if ( !validateUserConsent() ) { return }
	names = names.filter(name => folderOfDocument(name) !== folder);
	if ( !names.length ) { return }
	const store = readFolders();
	for ( const name of names ) {
		if ( folder ) {
			store.documents[name] = folder;
		} else {
			delete store.documents[name];
		}
	}
	tabs.filter(t => names.includes(t.name)).forEach(t => t.folder = folder);
	if ( folder ) { expandFolder(folder) }
	writeFolders(store);
	refreshFileTree(true);
	renderTabs();
	syncFolders();
}

function moveToFolderMenuItems(names){
	// existing folders aren't listed, documents are dragged onto those
	const current = new Set(names.map(folderOfDocument));
	const sole = current.size === 1 ? [...current][0] : null;
	return [
		{ label: "Move to new folder...", action: () => { const f = createFolder(); if ( f ) { moveDocumentsToFolder(names, f) } } },
		...(sole !== "" ? [{ label: "Move out of folder", action: () => moveDocumentsToFolder(names, "") }] : []),
	];
}

function folderColorValue(key){
	return folderColors.find(c => c.key === key)?.color || null;
}

function folderColorOwner(folder){
	// the folder itself if it has a color, or the nearest folder above it that has one
	if ( !folder || !validateUserConsent(false) ) { return null }
	const colors = readFolders().colors;
	return [folder, ...folderAncestors(folder)].find(f => folderColorValue(colors[f])) || null;
}

function applyFolderTint(el, folder, tab=false){
	// the folder's color; a folder colored inside colored folders is striped with all of their colors,
	// the outermost first, a color repeated as often as it is set on the way
	const colors = readFolders().colors;
	const chain = [...folderAncestors(folder).reverse(), folder].map(f => folderColorValue(colors[f])).filter(Boolean);
	el.classList.add("colored");
	el.style.setProperty("--folder-color", chain.at(-1));
	if ( chain.length > 1 ) {
		el.classList.add("striped");
		el.style.setProperty("--folder-stripes", folderStripes(chain, tab ? folderTints.tab : folderTints.tree));
		if ( tab ) { el.style.setProperty("--folder-stripes-strong", folderStripes(chain, folderTints.tabStrong)) }
	}
}

function folderStripes(chain, tint){
	// dark themes would make the tints hard to tell apart, so there they get lighter towards the folder's own color
	const width = 10;
	const stops = chain.map((color, i) => {
		const dark = tint.dark[0] + (tint.dark[1] - tint.dark[0]) * i / (chain.length - 1);
		const mix = `light-dark(color-mix(in srgb, ${color} ${tint.light}%, var(--surface)), color-mix(in srgb, ${color} ${dark}%, var(--surface)))`;
		return `${mix} ${i * width}px ${(i + 1) * width}px`;
	});
	return `repeating-linear-gradient(-45deg, ${stops.join(", ")})`;
}

function setFolderColor(folder, key){
	if ( !validateUserConsent() ) { return }
	const store = readFolders();
	if ( (store.colors[folder] || null) === key ) { return }
	if ( key ) {
		store.colors[folder] = key;
	} else {
		delete store.colors[folder];
	}
	writeFolders(store);
	renderTabs();
	syncFolders();
}

function folderColorSwatches(folder){
	// "No color" first; a sub-folder without a color shows the color of the folder it is in
	const current = readFolders().colors[folder] || null;
	return [
		{ key: null, label: "No color", color: null },
		...folderColors,
	].map(c => ({ ...c, selected: c.key === current, action: () => setFolderColor(folder, c.key) }));
}

function deleteDocuments(names){
	// several documents at once, after one confirmation
	if ( !validateUserConsent() || !names.length ) { return }
	if ( names.length === 1 ) { return deleteDocumentInLocalStorage(names[0]) }
	const shown = names.slice(0, 10).map(name => `- ${name}`).join("\n") + (names.length > 10 ? `\n...and ${names.length - 10} more` : "");
	if ( !showConfirm(`Delete ${names.length} documents?\n\n${shown}`) ) { return }
	const store = readFolders();
	for ( const name of names ) {
		notebookStorage.removeItem(docPrefix + name);
		delete store.documents[name];
		closeTabsOfDocument(name);
	}
	clearDocumentSelection();
	writeFolders(store);
	syncFolders(); // the deleted documents go to the cloud with the folders
}

function createNewDocumentInFolder(folder){
	// the folder is applied when the document is first saved
	createNewDocument();
	const tab = getActiveTab();
	if ( tab ) { tab.folder = folder }
	expandFolder(folder);
	closeTreeDrawer();
	documentNameObject.focus();
}

function mergeFolders(json){
	// a pulled notebook or backup: folders from both are kept, the incoming document placement wins
	let incoming;
	try { incoming = JSON.parse(json) } catch ( err ) { return }
	if ( !incoming || typeof incoming !== "object" ) { return }
	const store = readFolders();
	const folders = Array.isArray(incoming.folders) ? incoming.folders.filter(f => typeof f === "string" && f) : [];
	store.folders = normalizeFolders([...store.folders, ...folders]);
	Object.assign(store.documents, incoming.documents && typeof incoming.documents === "object" ? incoming.documents : {});
	Object.assign(store.colors, incoming.colors && typeof incoming.colors === "object" ? incoming.colors : {});
	notebookStorage.setItem(foldersKey, JSON.stringify(store));
	renderTabs();
}

function normalizeFolders(folders){
	// unique paths, no empty names, at most maxFolderDepth deep, and every folder's parents present
	const valid = folders.filter(f => f.split(folderSeparator).every(Boolean) && folderDepth(f) <= maxFolderDepth);
	return [...new Set(valid.flatMap(f => [...folderAncestors(f).reverse(), f]))];
}

function migratePathFolders(){
	// documents named "folder/name" were shown in folders before folders existed; keep them there
	if ( !validateUserConsent(false) || notebookStorage.getItem(foldersKey) !== null ) { return }
	const store = { folders: [], documents: {} };
	for ( const name of getDocumentNamesFromLocalStorage() ) {
		const parts = name.split(folderSeparator);
		parts.pop();
		if ( !parts.length || !name.split(folderSeparator).every(Boolean) ) { continue }
		const folder = parts.slice(0, maxFolderDepth).join(folderSeparator);
		store.folders.push(folder);
		store.documents[name] = folder;
	}
	store.folders = normalizeFolders(store.folders);
	if ( store.folders.length ) { notebookStorage.setItem(foldersKey, JSON.stringify(store)) }
}


// context menu
function treePanelMenuItems(){
	return [
		{ label: "New document", action: createNewDocument },
		{ label: "New folder", action: createFolder },
		{ label: "Move documents to the left", action: () => setTreeSide("left"), disabled: layout.treeSide === "left" },
		{ label: "Move documents to the right", action: () => setTreeSide("right"), disabled: layout.treeSide === "right" },
		{ label: "Move documents to the top", action: () => setTreeSide("top"), disabled: layout.treeSide === "top" },
		{ label: "Move documents to the bottom", action: () => setTreeSide("bottom"), disabled: layout.treeSide === "bottom" },
		{ label: "Hide documents", action: hideFileTree },
	];
}

function tabsPanelMenuItems(){
	return [
		{ label: "Split editor", action: () => splitEditor(), disabled: panes.length >= maxEditors },
		{ label: "Move opened documents to the top", action: () => setTabsSide("top"), disabled: layout.tabsSide === "top" },
		{ label: "Move opened documents to the bottom", action: () => setTabsSide("bottom"), disabled: layout.tabsSide === "bottom" },
	];
}

function openContextMenu(e, items){
	// the innermost element builds the menu; outer panels must not replace it
	if ( e.defaultPrevented ) { return }
	e.preventDefault();
	contextMenu.replaceChildren();
	for ( const item of items ) {
		if ( item === null ) {
			contextMenu.append(document.createElement("hr"));
			continue;
		}
		if ( item.swatches ) {
			contextMenu.append(contextMenuSwatches(item.swatches));
			continue;
		}
		const btn = document.createElement("button");
		btn.setAttribute("role", "menuitem");
		btn.textContent = item.label;
		// an icon before the label (markup of the app's own, like the buttons it stands for)
		if ( item.icon ) {
			const icon = document.createElement("span");
			icon.className = "block-option-icon";
			icon.setAttribute("aria-hidden", "true");
			icon.innerHTML = item.icon;
			btn.prepend(icon);
			btn.classList.add("with-icon");
		}
		btn.disabled = Boolean(item.disabled);
		if ( item.danger ) { btn.classList.add("danger") }
		btn.addEventListener("click", () => { closeContextMenu(); item.action() });
		contextMenu.append(btn);
	}
	contextMenu.classList.add("menu-opened");
	// keep the menu inside the viewport
	const { width, height } = contextMenu.getBoundingClientRect();
	contextMenu.style.left = Math.max(0, Math.min(e.clientX, window.innerWidth - width - 4)) + "px";
	contextMenu.style.top = Math.max(0, Math.min(e.clientY, window.innerHeight - height - 4)) + "px";
	contextMenu.querySelector("button:not([disabled])")?.focus();
}

function contextMenuSwatches(swatches){
	// a row of color buttons; one without a color is the "No color" choice
	const row = document.createElement("div");
	row.className = "menu-swatches";
	row.setAttribute("role", "group");
	row.setAttribute("aria-label", "Folder color");
	for ( const swatch of swatches ) {
		const btn = document.createElement("button");
		btn.className = "menu-swatch" + (swatch.color ? "" : " no-color");
		btn.setAttribute("role", "menuitemradio");
		btn.setAttribute("aria-checked", String(Boolean(swatch.selected)));
		btn.setAttribute("aria-label", swatch.label);
		btn.title = swatch.label;
		if ( swatch.color ) { btn.style.setProperty("--swatch-color", swatch.color) }
		btn.addEventListener("click", () => { closeContextMenu(); swatch.action() });
		row.append(btn);
	}
	return row;
}

function closeContextMenu(){
	contextMenu.classList.remove("menu-opened");
}


function setupLongPressMenus(container){
	// iOS Safari has no contextmenu event for a long press: holding a finger on a row (or a tab) opens its right-click menu.
	// The row can't be dragged by touch meanwhile, the drag would take the press (the menu moves documents too)
	const delay = 500;
	let press = null; // {timer, x, y, row, fired}
	const cancel = () => {
		if ( !press ) { return }
		clearTimeout(press.timer);
		if ( press.draggable ) { press.row.draggable = true }
	};
	container.addEventListener("touchstart", (e) => {
		cancel();
		press = null;
		const row = e.target.closest?.(".tree-row, .tab");
		if ( !row || e.touches.length !== 1 ) { return }
		const { clientX: x, clientY: y } = e.touches[0];
		press = { x, y, row, fired: false, draggable: row.draggable };
		row.draggable = false;
		press.timer = setTimeout(() => {
			press.fired = true;
			if ( press.draggable ) { press.row.draggable = true }
			row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: x, clientY: y }));
		}, delay);
	}, { passive: true });
	container.addEventListener("touchmove", (e) => {
		const touch = e.touches[0];
		if ( press && !press.fired && touch && Math.hypot(touch.clientX - press.x, touch.clientY - press.y) > 10 ) { cancel() }
	}, { passive: true });
	container.addEventListener("touchend", (e) => {
		cancel();
		// the finger lifted off the opened menu's row: not a tap on it
		if ( press?.fired && e.cancelable ) { e.preventDefault() }
	});
	container.addEventListener("touchcancel", cancel);
	// where the browser has a menu event of its own for the press (Android), one menu opens
	container.addEventListener("contextmenu", (e) => {
		if ( !e.isTrusted || !press ) { return }
		if ( press.fired ) { e.preventDefault(); e.stopPropagation(); return }
		cancel();
		press.fired = true;
	}, true);
}

// docking by drag-and-drop, like VS Code: while a panel is dragged by its head, where it would be docked is shown over
// the page (#dock-preview) and follows the pointer: the side of the editors it is nearest to; over the other panel, the
// documents and the contents go together (dockTargetAt). The same for both panels, and for the tabs bar (top or bottom).
// Together (the contents a tab next to the documents, or splitting their place), neither is the master: held between the
// tabs (.side-tabs), both move ("group"); a tab (.side-tab) or a panel's head moves only its panel
let dockDrag = null; // {panel, target: {side, rect, label}}

function setupDocking(handleId, panelOf){
	// panelOf: the panel, or a function telling it when the drag starts
	const handle = document.getElementById(handleId);
	const zones = document.getElementById("dock-zones");
	handle.addEventListener("dragstart", (e) => {
		// the tabs are in the documents' head: the head (or the tabs' strip) doesn't take a tab's drag
		if ( e.target !== handle ) { return }
		const panel = typeof panelOf === "function" ? panelOf() : panelOf;
		e.dataTransfer.effectAllowed = "move";
		e.dataTransfer.setData("text/plain", panel);   // Firefox only starts a drag with data
		dockDrag = { panel, target: null };
		zones.dataset.panel = panel;
		zones.dataset.treeSide = layout.treeSide;
		// the layer goes over the page on the next frame, or the browser cancels the drag that has just started
		requestAnimationFrame(() => { if ( dockDrag ) { zones.classList.add("dragging") } });
	});
	handle.addEventListener("dragend", endDocking);
}

function endDocking(){
	dockDrag = null;
	const zones = document.getElementById("dock-zones");
	zones.classList.remove("dragging");
	delete zones.dataset.target;
	document.getElementById("dock-preview").classList.remove("shown");
}

function visibleRect(id){
	const el = document.getElementById(id);
	const rect = el?.getBoundingClientRect();
	return rect && rect.width && rect.height && el.checkVisibility?.() !== false ? rect : null;
}

function isInside(rect, x, y){
	return rect && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

function dockTargetAt(x, y){
	// {side, rect, label}: the side the panel goes to, the place it takes there, what the preview says
	const panel = dockDrag.panel;
	const outer = panel === "tree" || panel === "group";
	const area = (outer ? document.getElementById("app-body") : document.querySelector(".editor-area")).getBoundingClientRect();
	const name = { tree: "documents", group: "documents and contents", toc: "contents", tabs: "opened documents" }[panel];
	if ( panel === "tabs" ) {
		const side = y < area.top + area.height / 2 ? "top" : "bottom";
		const height = Math.min(area.height / 3, 48);
		return { side, label: `Dock ${name} at the ${side}`, rect: { left: area.left, width: area.width, height, top: side === "top" ? area.top : area.bottom - height } };
	}
	if ( panel === "toc" && !document.body.classList.contains("tree-hidden") ) {
		// over the documents: a tab next to them, or (in their far half) splitting their place
		const tree = visibleRect(document.body.classList.contains("toc-split") ? "side-dock" : "file-tree");
		if ( isInside(tree, x, y) ) {
			const rows = dockedInRows(layout.treeSide);
			const far = rows ? x > tree.left + tree.width / 2 : y > tree.top + tree.height / 2;
			if ( far ) {
				const half = rows ? { left: tree.left + tree.width / 2, top: tree.top, width: tree.width / 2, height: tree.height }
					: { left: tree.left, top: tree.top + tree.height / 2, width: tree.width, height: tree.height / 2 };
				return { side: "split", rect: half, label: "Split the documents' place with contents" };
			}
			return { side: "tree", rect: tree, label: "Show contents as a tab next to the documents" };
		}
	}
	if ( panel === "tree" && tocGroupedWithTree() ) {
		// dropped where they are together, the documents stay with the contents
		const place = visibleRect(document.body.classList.contains("toc-split") ? "side-dock" : "file-tree");
		if ( isInside(place, x, y) ) { return { side: "keep", rect: place, label: "Keep documents with the contents" } }
	}
	if ( panel === "tree" && document.body.classList.contains("toc-separate") && !document.body.classList.contains("toc-split") ) {
		// over the contents: they become a tab next to the documents, where the contents are
		const toc = visibleRect("toc-panel");
		if ( isInside(toc, x, y) ) { return { side: "with-toc", rect: toc, label: "Show documents with the contents" } }
	}
	// the nearest edge, in proportion to the area's size: the area is cut along its diagonals
	const distances = {
		left: (x - area.left) / area.width,
		right: (area.right - x) / area.width,
		top: (y - area.top) / area.height,
		bottom: (area.bottom - y) / area.height,
	};
	const side = Object.keys(distances).reduce((a, b) => distances[b] < distances[a] ? b : a);
	const rows = dockedInRows(side);
	// as big as the panel is now, if it is docked the same way (beside or above / below the editors)
	const current = document.getElementById(panel === "group" && document.body.classList.contains("toc-split") ? "side-dock"
		: outer ? "file-tree" : "toc-panel").getBoundingClientRect();
	const sameWay = dockedInRows(outer ? layout.treeSide : layout.tocSide) === rows;
	const size = Math.min((rows ? area.height : area.width) * .4, (sameWay && (rows ? current.height : current.width)) || (rows ? 192 : 240));
	const rect = rows ? { left: area.left, width: area.width, height: size, top: side === "top" ? area.top : area.bottom - size }
		: { top: area.top, height: area.height, width: size, left: side === "left" ? area.left : area.right - size };
	return { side, rect, label: `Dock ${name} ${rows ? `at the ${side}` : side}` };
}

function showDockTarget(target){
	const preview = document.getElementById("dock-preview");
	const zones = document.getElementById("dock-zones");
	zones.dataset.target = target.side;
	preview.classList.add("shown");
	Object.assign(preview.style, { left: target.rect.left + "px", top: target.rect.top + "px", width: target.rect.width + "px", height: target.rect.height + "px" });
	preview.firstElementChild.textContent = target.label;
}

function tocGroupedWithTree(){
	// the contents are a tab next to the documents, or split their place with them
	return !layout.tocHidden && !document.body.classList.contains("tree-hidden")
		&& (document.body.classList.contains("toc-in-tree") || document.body.classList.contains("toc-split"));
}

function dockPanel(panel, side){
	if ( side === "keep" ) { return }
	if ( panel === "tree" && tocGroupedWithTree() ) {
		// only the documents go: the contents stay where the two were, as a panel of their own
		layout.tocSide = layout.treeSide;
		layout.treeSide = side;
		layout.treeTab = "documents";
		saveLayout();
	} else if ( panel === "group" ) {
		setTreeSide(side);
	} else if ( panel === "tree" && side === "with-toc" ) {
		// the documents take the contents' place, with the contents as their tab
		layout.treeSide = layout.tocSide;
		layout.tocSide = "tree";
		layout.treeTab = "documents";
		layout.treeHidden = false;
		saveLayout();
	} else if ( panel === "tree" ) {
		setTreeSide(side);
	} else if ( panel === "toc" ) {
		setTocSide(side); // toc.js
	} else {
		setTabsSide(side);
	}
}

// in the capture phase, before the editors and the panels: nothing under the dragged panel takes it (an editor would
// insert its name), and the layer over the page makes sure of it once it is there
window.addEventListener("dragover", (e) => {
	if ( !dockDrag ) { return }
	e.preventDefault();
	e.stopPropagation();
	e.dataTransfer.dropEffect = "move";
	dockDrag.target = dockTargetAt(e.clientX, e.clientY);
	showDockTarget(dockDrag.target);
}, true);
window.addEventListener("drop", (e) => {
	if ( !dockDrag ) { return }
	e.preventDefault();
	e.stopPropagation();
	const { panel } = dockDrag;
	const target = dockTargetAt(e.clientX, e.clientY);
	endDocking();
	dockPanel(panel, target.side);
}, true);
