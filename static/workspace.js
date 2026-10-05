/*
 * Workspace: the documents tree (file explorer), the opened documents (tabs) and the editors.
 * The tree and the tabs bar can be docked by drag-and-drop or from their right-click menu;
 * the layout, the opened tabs and the split editors are user preferences kept in localStorage.
 * Folders are listed on top of the tree and can hold sub-folders, up to maxFolderDepth levels;
 * a folder is known by its path, e.g. "work/projects". A document is in at most one folder.
 * The folders and which document is in which are kept under foldersKey and go to the cloud
 * with the notebook.
 * Documents in the tree can be selected with Ctrl/Cmd+click (one more) and Shift+click (a range);
 * opening, deleting, moving and dragging then act on all the selected documents.
 *
 * Split view: up to 4 editor panes, each showing one opened tab. The focused pane's editor
 * carries id="editor" (and is editorObject), so the rest of the app works on it unchanged;
 * #doc-name shows the focused pane's document.
 */
const layoutKey = "__layout__";
const openedTabsKey = "__openedTabs__";
const openedEditorsKey = "__openedEditors__";
const foldersKey = "__folders__";
// the tree's width is a preference of this device only, it doesn't go to the cloud (isDeviceOnlyKey)
const treeWidthKey = "__treeWidth__";
const minTreeWidth = 160;
const maxTreeWidth = 600;
const folderSeparator = "/";
const maxFolderDepth = 5;
const untitledTabLabel = "Untitled";
const maxEditors = 4;
const tabDragType = "application/x-writejs-tab";
const documentDragType = "application/x-writejs-document";
const folderDragType = "application/x-writejs-folder";

const layout = Object.assign(
	{ treeSide: "left", tabsSide: "top", treeHidden: false, collapsedFolders: [] },
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

const fileTreeList = document.getElementById("file-tree-list");
const fileTreeSearch = document.getElementById("file-tree-search");
const tabsContainer = document.getElementById("tabs");
const contextMenu = document.getElementById("context-menu");

applyLayout();
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
	// the focused document behaves as before; only warn about unsaved edits elsewhere
	if ( tabs.some(t => t.dirty && t.id !== focusedPane.tabId) ) { e.preventDefault() }
});
// documents changed in another browser tab
window.addEventListener("storage", () => refreshFileTree());

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
setupDocking("file-tree-head", "tree");
setupTreeResizing();
setupDocumentDropping();
setupDocking("tab-grip", "tabs");
setupNameTooltip();

document.addEventListener("click", (e) => { if ( !contextMenu.contains(e.target) ) { closeContextMenu() } });
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
		return JSON.parse(localStorage.getItem(key)) || {};
	} catch ( err ) {
		return {};
	}
}

function saveLayout(){
	applyLayout();
	if ( validateUserConsent(false) ) { localStorage.setItem(layoutKey, JSON.stringify(layout)) }
}

function applyLayout(){
	document.body.dataset.treeSide = layout.treeSide;
	document.body.dataset.tabsSide = layout.tabsSide;
	document.body.classList.toggle("tree-hidden", layout.treeHidden);
}

function setupTreeResizing(){
	// the edge of the tree next to the editors is dragged to set its width
	const tree = document.getElementById("file-tree");
	const resizer = document.getElementById("file-tree-resizer");
	applyTreeWidth(Number(localStorage.getItem(treeWidthKey)) || null);

	resizer.addEventListener("pointerdown", (e) => {
		if ( e.button !== 0 ) { return }
		e.preventDefault();
		resizer.setPointerCapture(e.pointerId);
		const startX = e.clientX;
		const startWidth = tree.getBoundingClientRect().width;
		// docked right, the edge is on the tree's left: dragging left makes it wider
		const direction = layout.treeSide === "right" ? -1 : 1;
		document.body.classList.add("tree-resizing");

		const move = (ev) => applyTreeWidth(startWidth + (ev.clientX - startX) * direction);
		const end = () => {
			resizer.removeEventListener("pointermove", move);
			resizer.removeEventListener("pointerup", end);
			resizer.removeEventListener("pointercancel", end);
			document.body.classList.remove("tree-resizing");
			saveTreeWidth(Math.round(tree.getBoundingClientRect().width));
		};
		resizer.addEventListener("pointermove", move);
		resizer.addEventListener("pointerup", end);
		resizer.addEventListener("pointercancel", end);
	});
	resizer.addEventListener("dblclick", () => {
		applyTreeWidth(null);
		saveTreeWidth(null);
	});
}

function applyTreeWidth(width){
	const style = document.getElementById("file-tree").style;
	if ( !width ) { style.removeProperty("--tree-width"); return }
	const clamped = Math.min(maxTreeWidth, Math.max(minTreeWidth, width));
	style.setProperty("--tree-width", clamped + "px");
}

function saveTreeWidth(width){
	if ( !validateUserConsent(false) ) { return }
	if ( width ) { localStorage.setItem(treeWidthKey, String(width)) }
	else { localStorage.removeItem(treeWidthKey) }
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
	if ( !validateUserConsent(false) ) { return }
	saveOpenedEditors();
	const names = tabs.map(t => t.name).filter(name => name && documentExists(name));
	localStorage.setItem(openedTabsKey, JSON.stringify([...new Set(names)]));
}

function saveOpenedEditors(){
	if ( !validateUserConsent(false) ) { return }
	const names = panes.map(p => tabById(p.tabId)?.name || "");
	localStorage.setItem(openedEditorsKey, JSON.stringify({ names, focused: panes.indexOf(focusedPane) }));
}

function restoreEditors(){
	// split editors of the last visit; untitled and deleted documents are left out
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
	if ( !validateUserConsent(false) ) { return }
	let names = [];
	try {
		names = JSON.parse(localStorage.getItem(openedTabsKey)) || [];
	} catch ( err ) {}
	for ( const name of names ) {
		if ( documentExists(name) ) { createTab(name) }
	}
}

function documentExists(name){
	return validateUserConsent(false) && localStorage.getItem(docPrefix + name) !== null;
}


// file tree
function isFileTreeVisible(){
	return isLowWidthViewport ? document.body.classList.contains("tree-drawer-open") : !layout.treeHidden;
}

function showFileTree(){
	if ( isLowWidthViewport ) {
		document.body.classList.add("tree-drawer-open");
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

function toggleFileTree(){
	isFileTreeVisible() ? hideFileTree() : showFileTree();
}

function refreshFileTree(force=false){
	const names = validateUserConsent(false) ? getDocumentNamesFromLocalStorage().sort((a, b) => a.localeCompare(b)) : null;
	const filter = fileTreeSearch.value.trim().toLowerCase();
	// autosave calls this on every keystroke, so skip rebuilding an unchanged tree
	const folders = names === null ? null : localStorage.getItem(foldersKey);
	const key = JSON.stringify([names, folders, filter, getDocumentName(), layout.collapsedFolders]);
	if ( !force && key === renderedTreeKey ) { return }
	renderedTreeKey = key;
	// deleted documents leave the selection
	if ( names ) { selectedDocuments = new Set([...selectedDocuments].filter(n => names.includes(n))) }

	fileTreeList.replaceChildren();
	if ( names === null ) {
		fileTreeList.append(treeMessage("Agree to storing data to save documents."));
	} else if ( filter ) {
		const matches = names.filter(name => name.toLowerCase().includes(filter));
		matches.forEach(name => fileTreeList.append(treeDocumentItem(name, name, 0)));
		if ( !matches.length ) { fileTreeList.append(treeMessage("No matching documents.")) }
	} else if ( !names.length && !readFolders().folders.length ) {
		fileTreeList.append(treeMessage("You don't have any saved documents yet. Just create one :)"));
	} else {
		renderFolders(fileTreeList, names);
	}
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
			{ label: "Delete" + count, danger: true, action: () => names.length > 1 ? deleteDocuments(names) : deleteDocumentInLocalStorage(name) },
			...(names.length > 1 ? [{ label: "Clear selection", action: clearDocumentSelection }] : []),
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

function openDocumentFromTree(name){
	loadDocumentFromLocalStorage(name);
	document.body.classList.remove("tree-drawer-open");
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
	const tab = { id: ++tabSeq, name, html, dirty, folder: name ? folderOfDocument(name) : "", savedName: name && documentExists(name) ? name : "" };
	const activeIndex = tabs.indexOf(getActiveTab());
	activeIndex === -1 ? tabs.push(tab) : tabs.splice(activeIndex + 1, 0, tab);
	return tab;
}

function switchToTab(id){
	// a tab already shown in an editor focuses it, any other is shown in the focused editor
	const tab = tabById(id);
	if ( !tab ) { return }
	const pane = paneOfTab(tab);
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
	setPaneTab(focusedPane, createTab(name, html, dirty));
}

function closeTab(id){
	const tab = tabById(id);
	if ( !tab ) { return }
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
	if ( tab ) {
		tab.name = getDocumentName();
		tab.dirty = false;
		// a new or renamed document goes to the tab's folder, a document saved over keeps its own
		if ( tab.folder && !folderOfDocument(tab.name) ) { assignDocumentFolder(tab.name, tab.folder) }
		tab.folder = folderOfDocument(tab.name);
		if ( tab.savedName && tab.savedName !== tab.name ) { removeRenamedDocument(tab.savedName) }
		tab.savedName = tab.name;
	}
	renderTabs();
	refreshFileTree();
	saveOpenedTabs();
}

function removeRenamedDocument(oldName){
	// the document was saved under a new name: the old one goes, unless another tab still holds it
	if ( tabs.some(t => t.name === oldName) ) { return }
	localStorage.removeItem(docPrefix + oldName);
	forgetDocumentFolder(oldName);
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
		el.setAttribute("role", "tab");
		el.setAttribute("aria-selected", String(isActive));
		el.tabIndex = isActive ? 0 : -1;
		el.title = label + (tab.dirty ? " (unsaved)" : "") + (pane && panes.length > 1 ? ` - editor ${panes.indexOf(pane) + 1}` : "");
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
			null,
			...tabsPanelMenuItems(),
		]));
		setupTabDragging(el, tab);
		tabsContainer.append(el);
	}
	tabsContainer.querySelector(".tab.active")?.scrollIntoView({ block: "nearest", inline: "nearest" });
	renderPanes();
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
	const pane = { tabId: null, el, editor: el.querySelector(".editor") };
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
		} else {
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
}

function loadPane(pane){
	const tab = tabById(pane.tabId);
	let html = tab.html;
	if ( html === null ) {
		html = documentExists(tab.name) ? localStorage.getItem(docPrefix + tab.name) : "";
	}
	tab.html = null;
	pane.editor.innerHTML = html;
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
}

function splitEditor(tab=null){
	// opens an editor next to the focused one, with the given tab, the next hidden tab or a new one
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
	if ( panes.length < 2 ) { return }
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
	});
}


// folders
function readFolders(){
	// {folders: [name], documents: {documentName: folderName}}
	const store = readJsonSetting(foldersKey);
	return {
		folders: Array.isArray(store.folders) ? normalizeFolders(store.folders.filter(f => typeof f === "string")) : [],
		documents: store.documents && typeof store.documents === "object" ? store.documents : {},
	};
}

function writeFolders(store){
	if ( !validateUserConsent() ) { return }
	localStorage.setItem(foldersKey, JSON.stringify(store));
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
	tabs.forEach(t => t.folder = moved(t.folder || ""));
	layout.collapsedFolders = layout.collapsedFolders.map(moved);
	expandFolder(parentFolder(path));
	saveLayout();
	writeFolders(store);
	syncFolders();
}

function deleteFolder(folder){
	// a folder with documents or sub-folders goes only after confirmation, together with all of them
	const store = readFolders();
	const subfolders = store.folders.filter(f => f !== folder && isInFolder(f, folder));
	const names = getDocumentNamesFromLocalStorage().filter(name => isInFolder(store.documents[name] || "", folder)).sort((a, b) => a.localeCompare(b));
	if ( names.length || subfolders.length ) {
		const counts = [
			names.length ? `${names.length} document${names.length === 1 ? "" : "s"}` : "",
			subfolders.length ? `${subfolders.length} sub-folder${subfolders.length === 1 ? "" : "s"}` : "",
		].filter(Boolean).join(" and ");
		const shown = names.slice(0, 10).map(name => `- ${name}`).join("\n") + (names.length > 10 ? `\n...and ${names.length - 10} more` : "");
		if ( !showConfirm(`Folder '${displayFolder(folder)}' is not empty. Delete it together with its ${counts}?` + (shown ? `\n\n${shown}` : "")) ) { return }
	}
	for ( const name of names ) {
		localStorage.removeItem(docPrefix + name);
		closeTabsOfDocument(name);
	}
	store.folders = store.folders.filter(f => !isInFolder(f, folder));
	for ( const [doc, f] of Object.entries(store.documents) ) {
		if ( isInFolder(f, folder) ) { delete store.documents[doc] }
	}
	tabs.filter(t => isInFolder(t.folder || "", folder)).forEach(t => t.folder = "");
	layout.collapsedFolders = layout.collapsedFolders.filter(f => !isInFolder(f, folder));
	saveLayout();
	writeFolders(store);
	if ( names.length && typeof sendNotebook !== "undefined" ) {
		if ( remoteAutoSaveEnabled || showConfirm("Do you want to send updated Notebook to the cloud?") ) { sendNotebookForce() }
	} else {
		syncFolders();
	}
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

function deleteDocuments(names){
	// several documents at once, after one confirmation
	if ( !validateUserConsent() || !names.length ) { return }
	if ( names.length === 1 ) { return deleteDocumentInLocalStorage(names[0]) }
	const shown = names.slice(0, 10).map(name => `- ${name}`).join("\n") + (names.length > 10 ? `\n...and ${names.length - 10} more` : "");
	if ( !showConfirm(`Delete ${names.length} documents?\n\n${shown}`) ) { return }
	const store = readFolders();
	for ( const name of names ) {
		localStorage.removeItem(docPrefix + name);
		delete store.documents[name];
		closeTabsOfDocument(name);
	}
	clearDocumentSelection();
	writeFolders(store);
	if ( typeof sendNotebook !== "undefined" ) {
		if ( remoteAutoSaveEnabled || showConfirm("Do you want to send updated Notebook to the cloud?") ) { sendNotebookForce() }
	}
}

function createNewDocumentInFolder(folder){
	// the folder is applied when the document is first saved
	createNewDocument();
	const tab = getActiveTab();
	if ( tab ) { tab.folder = folder }
	expandFolder(folder);
	document.body.classList.remove("tree-drawer-open");
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
	localStorage.setItem(foldersKey, JSON.stringify(store));
}

function normalizeFolders(folders){
	// unique paths, no empty names, at most maxFolderDepth deep, and every folder's parents present
	const valid = folders.filter(f => f.split(folderSeparator).every(Boolean) && folderDepth(f) <= maxFolderDepth);
	return [...new Set(valid.flatMap(f => [...folderAncestors(f).reverse(), f]))];
}

function migratePathFolders(){
	// documents named "folder/name" were shown in folders before folders existed; keep them there
	if ( !validateUserConsent(false) || localStorage.getItem(foldersKey) !== null ) { return }
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
	if ( store.folders.length ) { localStorage.setItem(foldersKey, JSON.stringify(store)) }
}


// context menu
function treePanelMenuItems(){
	return [
		{ label: "New document", action: createNewDocument },
		{ label: "New folder", action: createFolder },
		{ label: "Move documents to the left", action: () => setTreeSide("left"), disabled: layout.treeSide === "left" },
		{ label: "Move documents to the right", action: () => setTreeSide("right"), disabled: layout.treeSide === "right" },
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
		const btn = document.createElement("button");
		btn.setAttribute("role", "menuitem");
		btn.textContent = item.label;
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

function closeContextMenu(){
	contextMenu.classList.remove("menu-opened");
}


// docking by drag-and-drop: dragging a panel's handle shows drop zones for its possible sides
function setupDocking(handleId, panel){
	const handle = document.getElementById(handleId);
	const zones = document.getElementById("dock-zones");
	handle.addEventListener("dragstart", (e) => {
		if ( e.target !== handle ) { return }
		e.dataTransfer.effectAllowed = "move";
		e.dataTransfer.setData("text/plain", panel);   // Firefox only starts a drag with data
		zones.dataset.panel = panel;
		// shown on the next frame, or the browser cancels the drag that has just started
		requestAnimationFrame(() => zones.classList.add("dragging"));
	});
	handle.addEventListener("dragend", () => {
		zones.classList.remove("dragging");
		zones.querySelectorAll(".dock-zone").forEach(z => z.classList.remove("over"));
	});
}

document.querySelectorAll("#dock-zones .dock-zone").forEach((zone) => {
	const zones = document.getElementById("dock-zones");
	zone.addEventListener("dragover", (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move" });
	zone.addEventListener("dragenter", () => zone.classList.add("over"));
	zone.addEventListener("dragleave", () => zone.classList.remove("over"));
	zone.addEventListener("drop", (e) => {
		e.preventDefault();
		const side = zone.dataset.side;
		if ( zones.dataset.panel === "tree" ) { setTreeSide(side) } else { setTabsSide(side) }
	});
});
