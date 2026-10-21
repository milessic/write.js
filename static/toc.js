/*
 * Table of contents: the headings of the focused document; a click scrolls the document to one and puts the caret on it,
 * and the heading of the part being read is marked as the document scrolls.
 * It is a tab next to the documents in the tree (layout.tocSide "tree"), a panel of its own left, right, above or below
 * the editors ("left" / "right" / "top" / "bottom"), or splits the documents' place with them ("split": under them, or
 * beside them docked above or below), moved by dragging its tab or head onto a dock zone, or from its right-click menu. On phones and tablets
 * it is always a tab of the documents drawer. Menu > Table Of Contents and vi's :TableOfContents open it; the panel's x or, as a tab, the tree's
 * little menu (☰, which then also has the tree's buttons) closes it;
 * it is remembered open or closed and where with the layout (workspace.js, this device only).
 * Settings > Table of contents picks the heading levels listed (tocHeadingsKey, script.js), they go with the notebook;
 * it can list the top-level checklist items too, as headings of a level under all the others (tocChecklistLevel, "h10"):
 * each under the heading of its section.
 * The document window (docwindow.js) has a table of contents of its own, over the document (#doc-window-toc).
 * Keys in the list: arrows or j / k move, Enter goes to the heading, Esc goes back to the editor.
 */
const tocWidthKey = "__tocWidth__"; // the panel's width, a preference of this device only (isDeviceOnlyKey)
const tocHeightKey = "__tocHeight__"; // and its height above or below the editors
const tocLevels = [1, 2, 3, 4];
const tocChecklistLevel = 10; // stored with the heading levels when the top-level checklist items are listed
const narrowScreen = matchMedia("(max-width: 999px)");
let tocHeadings = []; // the listed headings of tocEditor, in the rows' order
let tocEditor = null;
let tocSignature = null;
let tocFrame = 0;
let tocScrollFrame = 0;

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
	const toc = layout.treeTab === "toc";
	const icon = (id) => document.getElementById(id).innerHTML;
	return [
		{ label: "New document", icon: icon("file-tree-new"), action: createNewDocument },
		{ label: "New folder", icon: icon("file-tree-new-folder"), action: () => createFolder() },
		// pinning only matters where the tree is a drawer (phones and tablets)
		narrowScreen.matches ? { label: treePinned ? "Unpin documents" : "Pin documents open", icon: icon("file-tree-pin"), action: toggleTreePinned } : null,
		null,
		toc ? { label: "Close Table of Contents", icon: icon("file-tree-hide"), action: closeTableOfContents }
			: { label: "Close File Explorer", icon: icon("file-tree-hide"), action: hideFileTree },
	].filter((item, i, items) => item || items[i - 1]);
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

function renderToc(){
	if ( !tocShown() ) { return }
	const editor = document.getElementById("editor");
	const levels = tocHeadingLevels();
	const checklist = tocListsChecklist();
	const selector = [...levels.map((l) => `h${l}`), ...(checklist ? ["li[data-checked]"] : [])].join(", ");
	const headings = editor && selector ? [...editor.querySelectorAll(selector)].filter((el) => el.nodeName !== "LI" || isTopLevelTaskItem(el)) : [];
	// rebuilt only when the headings changed, not on every letter typed elsewhere
	const signature = levels.join() + checklist + "\n" + headings.map((h) => `${h.nodeName}${h.dataset.checked || ""}${isFoldedAway(h) ? "-" : ""} ${tocEntryText(h)}`).join("\n");
	// the rows go by index: the same headings in new elements (the document reloaded) keep them
	tocHeadings = headings;
	if ( editor === tocEditor && signature === tocSignature ) { markCurrentHeading(); return }
	tocEditor = editor;
	tocSignature = signature;
	const top = Math.min(...headings.filter((h) => h.nodeName !== "LI").map((h) => Number(h.nodeName[1])));
	// a checklist item is one level under the heading of its section, at the top without one
	let sectionDepth = -1;
	const depths = headings.map((h) => h.nodeName === "LI" ? sectionDepth + 1 : (sectionDepth = Number(h.nodeName[1]) - top));
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
			row.title = text;
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
		// the row that had the focus keeps it, as far as it is still there
		if ( focusedIndex !== -1 ) { list.querySelectorAll(".toc-row")[Math.min(focusedIndex, headings.length - 1)]?.focus() }
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
	if ( isFoldedAway(heading) && typeof unfoldAround === "function" && unfoldAround(line) ) {
		editor.dispatchEvent(new Event("input", { bubbles: true }));
		if ( editor.id === "editor" ) { performAutoSave() }
	}
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

function handleTocKeydown(e){
	if ( e.ctrlKey || e.metaKey || e.altKey ) { return }
	const rows = [...e.currentTarget.querySelectorAll(".toc-row")];
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
		const heading = row && tocHeadings[row.dataset.index];
		if ( heading?.isConnected ) { goToHeading(heading) }
	});
});
setupDocking("toc-tab", "toc");
setupDocking("toc-head", "toc");
setupTocResizing();
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
