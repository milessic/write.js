/*
 * Workspace: the documents tree (file explorer), the opened documents (tabs) and the editors.
 * The tree and the tabs bar can be docked by drag-and-drop or from their right-click menu;
 * the layout, the opened tabs and the split editors are user preferences kept in localStorage.
 * A "/" in a document name puts it in a folder of the tree, e.g. "notes/todo".
 *
 * Split view: up to 4 editor panes, each showing one opened tab. The focused pane's editor
 * carries id="editor" (and is editorObject), so the rest of the app works on it unchanged;
 * #doc-name shows the focused pane's document.
 */
const layoutKey = "__layout__";
const openedTabsKey = "__openedTabs__";
const openedEditorsKey = "__openedEditors__";
const treeFolderSeparator = "/";
const untitledTabLabel = "Untitled";
const maxEditors = 4;
const tabDragType = "application/x-writejs-tab";

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
document.getElementById("file-tree-hide").addEventListener("click", hideFileTree);
document.getElementById("file-tree-scrim").addEventListener("click", hideFileTree);
fileTreeSearch.addEventListener("input", () => refreshFileTree());
fileTreeSearch.addEventListener("keydown", (e) => {
	if ( e.key === "Escape" ) { fileTreeSearch.value = ""; refreshFileTree() }
});
document.getElementById("file-tree").addEventListener("contextmenu", (e) => openContextMenu(e, treePanelMenuItems()));
document.getElementById("tab-bar").addEventListener("contextmenu", (e) => openContextMenu(e, tabsPanelMenuItems()));
setupDocking("file-tree-head", "tree");
setupDocking("tab-grip", "tabs");

document.addEventListener("click", (e) => { if ( !contextMenu.contains(e.target) ) { closeContextMenu() } });
document.addEventListener("keydown", (e) => { if ( e.key === "Escape" ) { closeContextMenu() } });
window.addEventListener("resize", closeContextMenu);
window.addEventListener("blur", closeContextMenu);


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
	const key = JSON.stringify([names, filter, getDocumentName(), layout.collapsedFolders]);
	if ( !force && key === renderedTreeKey ) { return }
	renderedTreeKey = key;

	fileTreeList.replaceChildren();
	if ( names === null ) {
		fileTreeList.append(treeMessage("Agree to storing data to save documents."));
	} else if ( filter ) {
		const matches = names.filter(name => name.toLowerCase().includes(filter));
		matches.forEach(name => fileTreeList.append(treeDocumentItem(name, name, 0)));
		if ( !matches.length ) { fileTreeList.append(treeMessage("No matching documents.")) }
	} else if ( !names.length ) {
		fileTreeList.append(treeMessage("You don't have any saved documents yet. Just create one :)"));
	} else {
		renderTreeLevel(fileTreeList, buildTree(names), "", 0);
	}
}

function buildTree(names){
	const root = { folders: new Map(), documents: [] };
	for ( const name of names ) {
		const parts = name.split(treeFolderSeparator);
		const label = parts.pop();
		// names like "/x" or "a//b" have empty parts; show them unsplit
		if ( !label || parts.some(p => !p) ) {
			root.documents.push({ label: name, name });
			continue;
		}
		let node = root;
		for ( const part of parts ) {
			if ( !node.folders.has(part) ) { node.folders.set(part, { folders: new Map(), documents: [] }) }
			node = node.folders.get(part);
		}
		node.documents.push({ label, name });
	}
	return root;
}

function renderTreeLevel(list, node, path, depth){
	const folderNames = [...node.folders.keys()].sort((a, b) => a.localeCompare(b));
	for ( const folderName of folderNames ) {
		const folderPath = path + folderName + treeFolderSeparator;
		const collapsed = layout.collapsedFolders.includes(folderPath);
		const li = document.createElement("li");
		li.setAttribute("role", "treeitem");
		li.setAttribute("aria-expanded", String(!collapsed));
		const row = treeRow("tree-folder", folderName, depth);
		row.addEventListener("click", () => toggleFolder(folderPath));
		li.append(row);
		if ( !collapsed ) {
			const group = document.createElement("ul");
			group.setAttribute("role", "group");
			renderTreeLevel(group, node.folders.get(folderName), folderPath, depth + 1);
			li.append(group);
		}
		list.append(li);
	}
	for ( const doc of node.documents ) {
		list.append(treeDocumentItem(doc.name, doc.label, depth));
	}
}

function treeDocumentItem(name, label, depth){
	const li = document.createElement("li");
	li.setAttribute("role", "treeitem");
	const row = treeRow("tree-document", label, depth);
	row.title = name;
	if ( name === getDocumentName() ) {
		row.classList.add("active");
		li.setAttribute("aria-selected", "true");
	}
	row.addEventListener("click", () => openDocumentFromTree(name));
	row.addEventListener("contextmenu", (e) => openContextMenu(e, [
		{ label: "Open", action: () => openDocumentFromTree(name) },
		{ label: "Delete", danger: true, action: () => deleteDocumentInLocalStorage(name) },
		null,
		...treePanelMenuItems(),
	]));
	li.append(row);
	return li;
}

function treeRow(className, label, depth){
	const row = document.createElement("button");
	row.className = `tree-row ${className}`;
	row.style.setProperty("--depth", depth);
	row.textContent = label;
	return row;
}

function treeMessage(text){
	const li = document.createElement("li");
	li.className = "tree-message muted small";
	li.textContent = text;
	return li;
}

function toggleFolder(folderPath){
	const i = layout.collapsedFolders.indexOf(folderPath);
	i === -1 ? layout.collapsedFolders.push(folderPath) : layout.collapsedFolders.splice(i, 1);
	saveLayout();
	refreshFileTree(true);
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
	const tab = { id: ++tabSeq, name, html, dirty };
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
	}
	renderTabs();
	refreshFileTree();
	saveOpenedTabs();
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
		pane.el.querySelector(".pane-name").textContent = (tab ? tabLabel(tab) : untitledTabLabel) + (tab?.dirty ? " ●" : "");
		pane.el.setAttribute("aria-label", `Editor ${i + 1}` + (isFocused ? " (focused)" : ""));
	});
}


// context menu
function treePanelMenuItems(){
	return [
		{ label: "New document", action: createNewDocument },
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
