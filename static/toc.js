/*
 * Table of contents: the headings of the focused document; a click scrolls the document to one and puts the caret on it,
 * and the heading of the part being read is marked as the document scrolls.
 * It is a tab next to the documents in the tree (layout.tocSide "tree"), a panel of its own left, right, above or below
 * the editors ("left" / "right" / "top" / "bottom"), or splits the documents' place with them ("split": under them, or
 * beside them docked above or below; the edge between them is dragged to share the place), moved by dragging its tab or head onto a dock zone, or from its right-click menu. On phones and tablets
 * it is always a tab of the documents drawer. Menu > Table Of Contents and vi's :TableOfContents open it; the panel's x or, as a tab, the tree's
 * little menu (☰, which then also has the tree's buttons) closes it;
 * it is remembered open or closed and where with the layout (workspace.js, this device only).
 * Settings > Table of contents picks the heading levels listed (tocHeadingsKey, script.js), they go with the notebook;
 * it can list the top-level checklist items too, as headings of a level under all the others (tocChecklistLevel, "h10"):
 * each under the heading of its section.
 * The document window (docwindow.js) has a table of contents of its own, over the document (#doc-window-toc).
 * An entry with entries under it has an arrow that collapses or expands them in the list only, independent of the
 * document's heading folding (folding.js); the entries in a section collapsed in the document are grayed out.
 * What is collapsed is kept for each opened document while it is opened and, with Settings > Save folding state > Contents
 * (saveContentsFoldsKey, script.js), across visits on this device (tocFoldsKey, by the document's id); an entry is known by
 * its level and text (and which one of the same it is).
 * Keys in the list: arrows or j / k move, Enter goes to the heading, Esc goes back to the editor, left / right collapse and
 * expand the heading's section.
 */
const tocWidthKey = "__tocWidth__"; // the panel's width, a preference of this device only (isDeviceOnlyKey)
const tocHeightKey = "__tocHeight__"; // and its height above or below the editors
const tocSplitKey = "__tocSplit__"; // splitting the documents' place: the documents' share of it, 0.5 even, this device only (isDeviceOnlyKey)
const minSplitShare = .15;
const tocLevels = [1, 2, 3, 4];
const tocChecklistLevel = 10; // stored with the heading levels when the top-level checklist items are listed
const narrowScreen = matchMedia("(max-width: 999px)");
let tocHeadings = []; // the listed headings of tocEditor, in the rows' order
let tocEditor = null;
let tocSignature = null;
let tocFrame = 0;
let tocScrollFrame = 0;
const tocFoldsKey = "__tocFolds__"; // {documentId: [entry key]}: what is collapsed in the list, a state of this device only (isDeviceOnlyKey)
const tocFolds = new Map(); // tab id -> Set of the entry keys collapsed in the list
let tocKeys = []; // the entry keys of tocHeadings

function tocHeadingLevels(){
	try {
		const levels = JSON.parse(localStorage.getItem(tocHeadingsKey));
		if ( Array.isArray(levels) ) { return tocLevels.filter((level) => levels.includes(level)) }
	} catch ( err ) {}
	return tocLevels;
}

function tocListsChecklist(){
	// off until turned on
	try {
		const levels = JSON.parse(localStorage.getItem(tocHeadingsKey));
		return Array.isArray(levels) && levels.includes(tocChecklistLevel);
	} catch ( err ) {
		return false;
	}
}

function isTopLevelTaskItem(li){
	// a checklist item of a list that isn't nested in another one
	return !li.parentElement.parentElement.closest("ul, ol, li");
}

function tocShown(){
	// the table of contents is open: in the app, or in the document window
	return !layout.tocHidden || document.body.classList.contains("doc-window-toc-open");
}

function tocInTree(){
	// a tab next to the documents: chosen, or on phones and tablets, where the panels are drawers
	return !layout.tocHidden && (layout.tocSide === "tree" || narrowScreen.matches);
}

function tocShownInTree(){
	return tocInTree() && layout.treeTab === "toc" && isFileTreeVisible();
}

function applyTocLayout(){
	const body = document.body;
	const showingToc = tocInTree() && layout.treeTab === "toc";
	body.dataset.tocSide = layout.tocSide;
	document.getElementById("toc-resizer").setAttribute("aria-orientation", dockedInRows(layout.tocSide) ? "horizontal" : "vertical");
	document.getElementById("split-resizer").setAttribute("aria-orientation", dockedInRows(layout.treeSide) ? "vertical" : "horizontal");
	body.dataset.treeTab = showingToc ? "toc" : "documents";
	body.classList.toggle("toc-in-tree", tocInTree());
	body.classList.toggle("toc-separate", !layout.tocHidden && !tocInTree());
	body.classList.toggle("toc-split", !layout.tocHidden && !tocInTree() && layout.tocSide === "split");
	document.getElementById("documents-tab").setAttribute("aria-selected", String(!showingToc));
	document.getElementById("toc-tab").setAttribute("aria-selected", String(showingToc));
	scheduleToc();
}

function openTableOfContents(focus=false){
	if ( isDocWindow ) {
		document.body.classList.add("doc-window-toc-open");
		renderToc();
		if ( focus ) { focusTableOfContents() }
		return
	}
	layout.tocHidden = false;
	if ( tocInTree() ) {
		layout.treeTab = "toc";
		if ( narrowScreen.matches ) { document.body.classList.add("tree-drawer-open") } else { layout.treeHidden = false }
	}
	saveLayout();
	renderToc();
	if ( focus ) { focusTableOfContents() }
}

function closeTableOfContents(){
	if ( isDocWindow ) { document.body.classList.remove("doc-window-toc-open"); return }
	// on phones the drawer showing it closes with it
	if ( narrowScreen.matches && tocShownInTree() ) { closeTreeDrawer() }
	layout.tocHidden = true;
	layout.treeTab = "documents";
	saveLayout();
}

function setTocSide(side){
	// "left" / "right" / "top" / "bottom" on its own, "tree" as a tab next to the documents, "split" sharing their place
	layout.tocSide = side;
	layout.tocHidden = false;
	if ( side === "split" ) { layout.treeHidden = false }
	if ( side === "tree" ) {
		layout.treeTab = "toc";
		layout.treeHidden = false;
	} else if ( !narrowScreen.matches ) {
		layout.treeTab = "documents";
	}
	saveLayout();
}

function showTreeTab(tab){
	layout.treeTab = tab;
	saveLayout();
	if ( tab === "documents" ) { refreshFileTree(true) }
}

function tocPanelMenuItems(){
	const side = layout.tocSide;
	return [
		{ label: "Show contents next to the documents", action: () => setTocSide("tree"), disabled: side === "tree" },
		{ label: "Split the documents' place with contents", action: () => setTocSide("split"), disabled: side === "split" },
		{ label: "Move contents to the left", action: () => setTocSide("left"), disabled: side === "left" },
		{ label: "Move contents to the right", action: () => setTocSide("right"), disabled: side === "right" },
		{ label: "Move contents to the top", action: () => setTocSide("top"), disabled: side === "top" },
		{ label: "Move contents to the bottom", action: () => setTocSide("bottom"), disabled: side === "bottom" },
		{ label: "Close contents", action: closeTableOfContents },
	];
}

function sideMenuItems(){
	// the tree's little menu while the table of contents is a tab in it: its buttons with their icons, and closing the tab shown
	const toc = tocInTree() && layout.treeTab === "toc";
	const icon = (id) => document.getElementById(id).innerHTML;
	return [
		{ label: "New document", icon: icon("file-tree-new"), action: createNewDocument },
		{ label: "New folder", icon: icon("file-tree-new-folder"), action: () => createFolder() },
		// pinning only matters where the tree is a drawer (phones and tablets)
		...(narrowScreen.matches ? [{ label: treePinned ? "Unpin documents" : "Pin documents open", icon: icon("file-tree-pin"), action: toggleTreePinned }] : []),
		null,
		...(toc ? [{ label: "Close Table of Contents", icon: icon("file-tree-hide"), action: closeTableOfContents }] : []),
		...(!toc ? [{ label: "Close File Explorer", icon: icon("file-tree-hide"), action: hideFileTree }] : []),
	];
}

function openSideMenu(e){
	// the menu opens under the button; the click mustn't reach the document, which closes menus
	e.stopPropagation();
	const rect = e.currentTarget.getBoundingClientRect();
	openContextMenu({ clientX: rect.left, clientY: rect.bottom + 2, defaultPrevented: false, preventDefault(){} }, sideMenuItems());
}


// the list
function scheduleToc(){
	if ( tocFrame || !tocShown() ) { return }
	tocFrame = requestAnimationFrame(() => {
		tocFrame = 0;
		renderToc();
	});
}

function isFoldedAway(heading){
	return document.body.classList.contains("heading-folding") && Boolean(heading.closest(".fold-hidden"));
}

function tocEntryText(el){
	// a heading's text, or a checklist item's without the items nested in it
	const own = el.cloneNode(true);
	own.querySelectorAll("ul, ol").forEach((list) => list.remove());
	return own.textContent.replace(/\s+/g, " ").trim();
}

function contentsFoldsSaved(){
	// on until turned off
	return validateUserConsent(false) && localStorage.getItem(saveContentsFoldsKey) !== "0";
}

function tocEntryKeys(headings){
	// "2:Chapter", the second entry like it "2:Chapter#2": what is collapsed is found again after the document reloads
	const seen = new Map();
	return headings.map((h) => {
		const key = `${h.nodeName === "LI" ? tocChecklistLevel : h.nodeName[1]}:${tocEntryText(h)}`;
		const n = (seen.get(key) || 0) + 1;
		seen.set(key, n);
		return n > 1 ? `${key}#${n}` : key;
	});
}

function tocFoldsOf(tab){
	// the tab's collapsed entries, the remembered ones the first time
	if ( !tab ) { return new Set() }
	if ( !tocFolds.has(tab.id) ) {
		const saved = contentsFoldsSaved() && tab.docId ? readJsonSetting(tocFoldsKey)[tab.docId] : null;
		tocFolds.set(tab.id, new Set(Array.isArray(saved) ? saved : []));
	}
	return tocFolds.get(tab.id);
}

function saveTocFolds(tab, folds){
	if ( !contentsFoldsSaved() || !tab?.docId ) { return }
	const saved = readJsonSetting(tocFoldsKey);
	if ( folds.size ) { saved[tab.docId] = [...folds] } else { delete saved[tab.docId] }
	localStorage.setItem(tocFoldsKey, JSON.stringify(saved));
}

function renderToc(){
	if ( !tocShown() ) { return }
	const editor = document.getElementById("editor");
	const levels = tocHeadingLevels();
	const checklist = tocListsChecklist();
	const selector = [...levels.map((l) => `h${l}`), ...(checklist ? ["li[data-checked]"] : [])].join(", ");
	const headings = editor && selector ? [...editor.querySelectorAll(selector)].filter((el) => el.nodeName !== "LI" || isTopLevelTaskItem(el)) : [];
	// rebuilt only when the headings changed, not on every letter typed elsewhere
	const keys = tocEntryKeys(headings);
	const folds = tocFoldsOf(getActiveTab());
	const signature = levels.join() + checklist + "\n" + headings.map((h, i) => `${h.nodeName}${h.dataset.checked || ""}${isFoldedAway(h) ? "-" : ""}${folds.has(keys[i]) ? "+" : ""} ${tocEntryText(h)}`).join("\n");
	tocKeys = keys;
	// the rows go by index: the same headings in new elements (the document reloaded) keep them
	tocHeadings = headings;
	if ( editor === tocEditor && signature === tocSignature ) { markCurrentHeading(); return }
	tocEditor = editor;
	tocSignature = signature;
	const top = Math.min(...headings.filter((h) => h.nodeName !== "LI").map((h) => Number(h.nodeName[1])));
	// a checklist item is one level under the heading of its section, at the top without one
	let sectionDepth = -1;
	const depths = headings.map((h) => h.nodeName === "LI" ? sectionDepth + 1 : (sectionDepth = Number(h.nodeName[1]) - top));
	// an entry with deeper ones right after it can be collapsed; the ones under a collapsed entry are hidden
	const foldable = depths.map((depth, i) => i + 1 < depths.length && depths[i + 1] > depth);
	let hidingDepth = null;
	const hidden = depths.map((depth, i) => {
		if ( hidingDepth !== null && depth > hidingDepth ) { return true }
		hidingDepth = foldable[i] && folds.has(keys[i]) ? depth : null;
		return false;
	});
	for ( const list of document.querySelectorAll(".toc-list") ) {
		const focusedIndex = [...list.children].findIndex((li) => li.contains(document.activeElement));
		list.replaceChildren(...headings.map((heading, i) => {
			const li = document.createElement("li");
			const row = document.createElement("button");
			const label = document.createElement("span");
			const text = tocEntryText(heading);
			const task = heading.nodeName === "LI";
			row.className = "tree-row toc-row";
			row.dataset.index = i;
			row.dataset.level = task ? tocChecklistLevel : heading.nodeName[1];
			row.style.setProperty("--depth", depths[i]);
			row.classList.toggle("folded", isFoldedAway(heading));
			li.hidden = hidden[i];
			row.title = text;
			if ( !task ) {
				const fold = document.createElement("span");
				fold.className = "toc-fold";
				fold.setAttribute("aria-hidden", "true");
				if ( foldable[i] ) {
					const collapsed = folds.has(keys[i]);
					row.setAttribute("aria-expanded", String(!collapsed));
					fold.title = collapsed ? "Expand" : "Collapse";
				}
				row.append(fold);
			}
			if ( task ) {
				row.classList.add("toc-task");
				row.classList.toggle("checked", heading.dataset.checked === "true");
				const box = document.createElement("span");
				box.className = "toc-task-box";
				box.setAttribute("aria-hidden", "true");
				box.textContent = heading.dataset.checked === "true" ? "☑" : "☐";
				row.append(box);
			}
			label.className = "tree-label";
			label.textContent = text || (task ? "Untitled item" : "Untitled heading");
			row.append(label);
			li.append(row);
			return li;
		}));
		if ( !headings.length ) {
			const message = document.createElement("li");
			message.className = "tree-message toc-message";
			message.textContent = levels.length ? "No headings in this document." : checklist ? "No checklist items in this document." : "No heading levels are picked in Settings.";
			list.append(message);
		}
		// the row that had the focus keeps it, as far as it is still there (and shown)
		if ( focusedIndex !== -1 ) {
			const rows = [...list.querySelectorAll(".toc-row")];
			const row = rows[Math.min(focusedIndex, headings.length - 1)];
			(row?.parentElement.hidden ? rows.slice(0, focusedIndex).reverse().find((r) => !r.parentElement.hidden) : row)?.focus();
		}
	}
	markCurrentHeading();
}

function markCurrentHeading(){
	// the last heading at or above the top of the document's view
	const scroller = tocEditor?.closest(".pane-scroll");
	if ( !scroller ) { return }
	const view = scroller.getBoundingClientRect();
	const top = view.top + Math.min(80, view.height / 3);
	let current = -1;
	tocHeadings.forEach((heading, i) => {
		const rect = heading.getBoundingClientRect();
		if ( rect.height && rect.top <= top ) { current = i }
	});
	for ( const list of document.querySelectorAll(".toc-list") ) {
		list.querySelectorAll(".toc-row").forEach((row, i) => {
			const active = i === current;
			if ( row.classList.contains("active") === active ) { return }
			row.classList.toggle("active", active);
			if ( active ) { row.setAttribute("aria-current", "location") } else { row.removeAttribute("aria-current") }
			// the marked heading stays in sight in a long list
			if ( active && list.offsetParent ) { row.scrollIntoView({block: "nearest"}) }
		});
	}
}

function goToHeading(heading){
	const editor = heading.closest(".editor");
	if ( !editor ) { return }
	// a heading in a collapsed section: the section opens up first (folding.js); a checklist item by its list
	let line = heading;
	while ( line.parentElement && line.parentElement !== editor ) { line = line.parentElement }
	if ( isFoldedAway(heading) && typeof unfoldAround === "function" && unfoldAround(line) ) { foldsChanged(editor) }
	const scroller = editor.closest(".pane-scroll");
	const offset = heading.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
	scroller.scrollTo({top: scroller.scrollTop + offset - 12, behavior: "smooth"});
	// the caret goes to the start of the heading: typing and vi's motions go on from there
	const text = document.createTreeWalker(heading, NodeFilter.SHOW_TEXT).nextNode();
	const caret = document.createRange();
	caret.setStart(text || heading, 0);
	caret.collapse(true);
	if ( narrowScreen.matches ) {
		// no keyboard popping up over the heading; the drawer gets out of the way unless pinned, the document window's
		// table of contents closes
		closeTreeDrawer();
		if ( isDocWindow ) { closeTableOfContents() }
	} else {
		editor.focus({preventScroll: true});
	}
	const selection = window.getSelection();
	selection.removeAllRanges();
	selection.addRange(caret);
}

function focusTableOfContents(){
	const list = [...document.querySelectorAll(".toc-list")].find((l) => l.offsetParent);
	const rows = list ? [...list.querySelectorAll(".toc-row")] : [];
	const row = rows.find((r) => r.classList.contains("active")) || rows[0];
	if ( row ) { row.focus() } else { list?.closest(".toc-body")?.focus() }
}

function backToEditor(){
	const editor = document.getElementById("editor");
	editor.focus({preventScroll: true});
	if ( lastEditorRange && editor.contains(lastEditorRange.startContainer) ) {
		const selection = window.getSelection();
		selection.removeAllRanges();
		selection.addRange(lastEditorRange);
	}
}

function toggleTocFold(row, collapse=null){
	// collapses or expands the entries under the row, in the list only; collapse null toggles it
	const heading = tocHeadings[row.dataset.index];
	if ( !heading?.isConnected || !row.hasAttribute("aria-expanded") ) { return false }
	const tab = getActiveTab();
	const folds = tocFoldsOf(tab);
	const key = tocKeys[row.dataset.index];
	if ( collapse !== null && collapse === folds.has(key) ) { return false }
	folds.has(key) ? folds.delete(key) : folds.add(key);
	// the entries no longer there are forgotten
	[...folds].filter((k) => !tocKeys.includes(k)).forEach((k) => folds.delete(k));
	saveTocFolds(tab, folds);
	renderToc();
	return true;
}

function handleTocKeydown(e){
	if ( e.ctrlKey || e.metaKey || e.altKey ) { return }
	const rows = [...e.currentTarget.querySelectorAll(".toc-row")].filter((row) => !row.parentElement.hidden);
	const i = rows.indexOf(document.activeElement);
	const move = { ArrowDown: 1, j: 1, ArrowUp: -1, k: -1 }[e.key];
	if ( move ) {
		rows[i === -1 ? 0 : Math.max(0, Math.min(rows.length - 1, i + move))]?.focus();
	} else if ( e.key === "Home" || e.key === "g" ) {
		rows[0]?.focus();
	} else if ( e.key === "End" || e.key === "G" ) {
		rows.at(-1)?.focus();
	} else if ( e.key === "l" && i !== -1 ) {
		rows[i].click();
	} else if ( (e.key === "ArrowLeft" || e.key === "ArrowRight") && i !== -1 ) {
		const index = rows[i].dataset.index;
		toggleTocFold(rows[i], e.key === "ArrowLeft");
		e.currentTarget.querySelector(`.toc-row[data-index="${index}"]`)?.focus();
	} else if ( e.key === "Escape" ) {
		if ( narrowScreen.matches ) { closeTreeDrawer() }
		if ( narrowScreen.matches && isDocWindow ) { closeTableOfContents() }
		backToEditor();
	} else {
		return
	}
	e.preventDefault();
	e.stopPropagation();
}


// panel width, or height above or below the editors: the inner edge is dragged, like the documents tree's (workspace.js)
function applyTocWidth(width){
	const style = document.getElementById("toc-panel").style;
	if ( !width ) { style.removeProperty("--toc-width"); return }
	style.setProperty("--toc-width", Math.min(maxTreeWidth, Math.max(minTreeWidth, width)) + "px");
}

function applyTocHeight(height){
	const style = document.getElementById("toc-panel").style;
	if ( !height ) { style.removeProperty("--toc-height"); return }
	style.setProperty("--toc-height", Math.min(maxTreeHeight, Math.max(minTreeHeight, height)) + "px");
}

function setupTocResizing(){
	const panel = document.getElementById("toc-panel");
	const resizer = document.getElementById("toc-resizer");
	applyTocWidth(Number(localStorage.getItem(tocWidthKey)) || null);
	applyTocHeight(Number(localStorage.getItem(tocHeightKey)) || null);
	resizer.addEventListener("pointerdown", (e) => {
		if ( e.button !== 0 ) { return }
		e.preventDefault();
		resizer.setPointerCapture(e.pointerId);
		const rows = dockedInRows(layout.tocSide);
		const start = rows ? e.clientY : e.clientX;
		const rect = panel.getBoundingClientRect();
		const startSize = rows ? rect.height : rect.width;
		// docked right or bottom, the edge is on the panel's left or top: dragging left or up makes it bigger
		const direction = layout.tocSide === "right" || layout.tocSide === "bottom" ? -1 : 1;
		const apply = rows ? applyTocHeight : applyTocWidth;
		document.body.classList.add("tree-resizing");
		document.body.classList.toggle("resizing-rows", rows);
		const move = (ev) => apply(startSize + ((rows ? ev.clientY : ev.clientX) - start) * direction);
		const end = () => {
			resizer.removeEventListener("pointermove", move);
			resizer.removeEventListener("pointerup", end);
			resizer.removeEventListener("pointercancel", end);
			document.body.classList.remove("tree-resizing", "resizing-rows");
			const rect = panel.getBoundingClientRect();
			if ( validateUserConsent(false) ) { localStorage.setItem(rows ? tocHeightKey : tocWidthKey, String(Math.round(rows ? rect.height : rect.width))) }
		};
		resizer.addEventListener("pointermove", move);
		resizer.addEventListener("pointerup", end);
		resizer.addEventListener("pointercancel", end);
	});
	resizer.addEventListener("dblclick", () => {
		const rows = dockedInRows(layout.tocSide);
		rows ? applyTocHeight(null) : applyTocWidth(null);
		localStorage.removeItem(rows ? tocHeightKey : tocWidthKey);
	});
}

// splitting the documents' place: the edge between the two panels (#split-resizer) shares it
function applySplitShare(share){
	const style = document.getElementById("side-dock").style;
	if ( !share ) { style.removeProperty("--split-share"); return }
	style.setProperty("--split-share", Math.min(1 - minSplitShare, Math.max(minSplitShare, share)));
}

function setupSplitResizing(){
	const dock = document.getElementById("side-dock");
	const resizer = document.getElementById("split-resizer");
	applySplitShare(Number(localStorage.getItem(tocSplitKey)) || null);
	resizer.addEventListener("pointerdown", (e) => {
		if ( e.button !== 0 ) { return }
		e.preventDefault();
		resizer.setPointerCapture(e.pointerId);
		// the documents above the contents, or beside them when the place is above or below the editors
		const rows = !dockedInRows(layout.treeSide);
		document.body.classList.add("tree-resizing");
		document.body.classList.toggle("resizing-rows", rows);
		const move = (ev) => {
			const rect = dock.getBoundingClientRect();
			applySplitShare(rows ? (ev.clientY - rect.top) / rect.height : (ev.clientX - rect.left) / rect.width);
		};
		const end = () => {
			resizer.removeEventListener("pointermove", move);
			resizer.removeEventListener("pointerup", end);
			resizer.removeEventListener("pointercancel", end);
			document.body.classList.remove("tree-resizing", "resizing-rows");
			const share = dock.style.getPropertyValue("--split-share");
			if ( share && validateUserConsent(false) ) { localStorage.setItem(tocSplitKey, String(Number(share).toFixed(3))) }
		};
		resizer.addEventListener("pointermove", move);
		resizer.addEventListener("pointerup", end);
		resizer.addEventListener("pointercancel", end);
	});
	resizer.addEventListener("dblclick", () => {
		applySplitShare(null);
		localStorage.removeItem(tocSplitKey);
	});
}


// Settings
function tocSettingsHtml(){
	// goes in the Table of contents section of Settings (createSettingsModal, script.js)
	const levels = tocHeadingLevels();
	return `
		<div class="row toc-levels">${tocLevels.map((level) => `
			<label class="check"><input type="checkbox" name="setting-toc-level" value="${level}"${levels.includes(level) ? " checked" : ""}>Heading ${level}</label>`).join("")}
		</div>
		<label class="check"><input type="checkbox" name="setting-toc-level" value="${tocChecklistLevel}"${tocListsChecklist() ? " checked" : ""}>Top-level checklist items</label>
		<p class="muted small">The headings listed; the checklist items that aren't nested in other items are listed under the heading of their section, below every heading level. Open it from the menu or with <kbd>:TableOfContents</kbd> in vi mode; a click on a heading scrolls the document to it.</p>
		<label class="check"><input type="radio" name="setting-toc-side" value="tree"${layout.tocSide === "tree" ? " checked" : ""}>A tab next to the documents</label>
		<label class="check"><input type="radio" name="setting-toc-side" value="split"${layout.tocSide === "split" ? " checked" : ""}>Splitting the documents' place</label>
		<label class="check"><input type="radio" name="setting-toc-side" value="panel"${!["tree", "split"].includes(layout.tocSide) ? " checked" : ""}>A panel of its own</label>
		<p class="muted small">Drag its tab or its title onto a side to move it, or right-click it. On phones it is a tab next to the documents.</p>`;
}

function initTocSettings(){
	document.querySelectorAll('input[name="setting-toc-level"]').forEach((input) => input.addEventListener("change", (e) => {
		if ( !validateUserConsent() ) { e.target.checked = !e.target.checked; return }
		const levels = [...document.querySelectorAll('input[name="setting-toc-level"]:checked')].map((el) => Number(el.value));
		localStorage.setItem(tocHeadingsKey, JSON.stringify(levels));
		scheduleToc();
		if ( typeof handleRemoteAutosave !== "undefined" ) { handleRemoteAutosave() } // the setting goes to the cloud with the notebook
	}));
	document.querySelectorAll('input[name="setting-toc-side"]').forEach((input) => input.addEventListener("change", (e) => {
		// on its own it goes opposite the documents
		const side = e.target.value !== "panel" ? e.target.value : layout.treeSide === "right" ? "left" : "right";
		layout.tocSide = side;
		if ( side === "tree" && !layout.tocHidden ) { layout.treeTab = "toc" }
		saveLayout();
	}));
}


document.getElementById("documents-tab").addEventListener("click", () => showTreeTab("documents"));
document.getElementById("toc-tab").addEventListener("click", () => showTreeTab("toc"));
document.getElementById("side-menu-btn").addEventListener("click", openSideMenu);
document.getElementById("toc-hide").addEventListener("click", closeTableOfContents);
document.getElementById("doc-window-toc-hide").addEventListener("click", closeTableOfContents);
for ( const id of ["toc-tab", "toc-panel"] ) {
	document.getElementById(id).addEventListener("contextmenu", (e) => openContextMenu(e, tocPanelMenuItems()));
}
document.querySelectorAll(".toc-body").forEach((body) => {
	body.tabIndex = -1;
	body.addEventListener("keydown", handleTocKeydown);
	body.addEventListener("click", (e) => {
		const row = e.target.closest(".toc-row");
		if ( row && e.target.closest(".toc-fold") && toggleTocFold(row) ) {
			// the arrow folds without leaving the list
			body.querySelector(`.toc-row[data-index="${row.dataset.index}"]`)?.focus();
			return;
		}
		const heading = row && tocHeadings[row.dataset.index];
		if ( heading?.isConnected ) { goToHeading(heading) }
	});
});
setupDocking("toc-tab", "toc");
setupDocking("toc-head", "toc");
setupTocResizing();
setupSplitResizing();
// the list follows the focused document: edits, other documents opened, another editor focused (its id="editor"),
// checklist items checked
new MutationObserver(scheduleToc).observe(document.getElementById("editor-grid"),
	{childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["id", "class", "data-collapsed", "data-checked"]});
document.addEventListener("scroll", (e) => {
	if ( tocScrollFrame || !tocShown() || !e.target.classList?.contains("pane-scroll") ) { return }
	tocScrollFrame = requestAnimationFrame(() => {
		tocScrollFrame = 0;
		markCurrentHeading();
	});
}, true);
narrowScreen.addEventListener("change", applyTocLayout);
applyTocLayout();
