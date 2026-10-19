/*
 * Table of contents: the headings of the focused document; a click scrolls the document to one and puts the caret on it,
 * and the heading of the part being read is marked as the document scrolls.
 * It is a tab next to the documents in the tree (layout.tocSide "tree") or a panel of its own left or right of the editors
 * ("left" / "right"), moved by dragging its tab or head onto a dock zone, or from its right-click menu. On phones and tablets
 * it is always a tab of the documents drawer. Menu > Table Of Contents and vi's :TableOfContents open it; the panel's x or, as a tab, the tree's
 * little menu (☰, which then also has the tree's buttons) closes it;
 * it is remembered open or closed and where with the layout (workspace.js, this device only).
 * Settings > Table of contents picks the heading levels listed (tocHeadingsKey, script.js), they go with the notebook.
 * Keys in the list: arrows or j / k move, Enter goes to the heading, Esc goes back to the editor.
 */
const tocWidthKey = "__tocWidth__"; // the panel's width, a preference of this device only (isDeviceOnlyKey)
const tocLevels = [1, 2, 3, 4];
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
	body.dataset.treeTab = showingToc ? "toc" : "documents";
	body.classList.toggle("toc-in-tree", tocInTree());
	body.classList.toggle("toc-separate", !layout.tocHidden && !tocInTree());
	document.getElementById("documents-tab").setAttribute("aria-selected", String(!showingToc));
	document.getElementById("toc-tab").setAttribute("aria-selected", String(showingToc));
	scheduleToc();
}

function openTableOfContents(focus=false){
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
	// on phones the drawer showing it closes with it
	if ( narrowScreen.matches && tocShownInTree() ) { closeTreeDrawer() }
	layout.tocHidden = true;
	layout.treeTab = "documents";
	saveLayout();
}

function setTocSide(side){
	// "left" / "right" on its own, "tree" as a tab next to the documents
	layout.tocSide = side;
	layout.tocHidden = false;
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
		{ label: "Move contents to the left", action: () => setTocSide("left"), disabled: side === "left" },
		{ label: "Move contents to the right", action: () => setTocSide("right"), disabled: side === "right" },
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
	if ( tocFrame || layout.tocHidden ) { return }
	tocFrame = requestAnimationFrame(() => {
		tocFrame = 0;
		renderToc();
	});
}

function isFoldedAway(heading){
	return document.body.classList.contains("heading-folding") && Boolean(heading.closest(".fold-hidden"));
}

function renderToc(){
	if ( layout.tocHidden ) { return }
	const editor = document.getElementById("editor");
	const levels = tocHeadingLevels();
	const headings = editor && levels.length ? [...editor.querySelectorAll(levels.map((l) => `h${l}`).join(", "))] : [];
	// rebuilt only when the headings changed, not on every letter typed elsewhere
	const signature = levels.join() + "\n" + headings.map((h) => `${h.nodeName}${isFoldedAway(h) ? "-" : ""} ${h.textContent}`).join("\n");
	// the rows go by index: the same headings in new elements (the document reloaded) keep them
	tocHeadings = headings;
	if ( editor === tocEditor && signature === tocSignature ) { markCurrentHeading(); return }
	tocEditor = editor;
	tocSignature = signature;
	const top = Math.min(...headings.map((h) => Number(h.nodeName[1])));
	for ( const list of document.querySelectorAll(".toc-list") ) {
		const focusedIndex = [...list.children].findIndex((li) => li.contains(document.activeElement));
		list.replaceChildren(...headings.map((heading, i) => {
			const li = document.createElement("li");
			const row = document.createElement("button");
			const label = document.createElement("span");
			const text = heading.textContent.replace(/\s+/g, " ").trim();
			row.className = "tree-row toc-row";
			row.dataset.index = i;
			row.dataset.level = heading.nodeName[1];
			row.style.setProperty("--depth", Number(heading.nodeName[1]) - top);
			row.classList.toggle("folded", isFoldedAway(heading));
			row.title = text;
			label.className = "tree-label";
			label.textContent = text || "Untitled heading";
			row.append(label);
			li.append(row);
			return li;
		}));
		if ( !headings.length ) {
			const message = document.createElement("li");
			message.className = "tree-message toc-message";
			message.textContent = levels.length ? "No headings in this document." : "No heading levels are picked in Settings.";
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
	// a heading in a collapsed section: the section opens up first (folding.js)
	if ( isFoldedAway(heading) && typeof unfoldAround === "function" && unfoldAround(heading) ) {
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
		// no keyboard popping up over the heading; the drawer gets out of the way unless pinned
		closeTreeDrawer();
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
		backToEditor();
	} else {
		return
	}
	e.preventDefault();
	e.stopPropagation();
}


// panel width: the inner edge is dragged, like the documents tree's (workspace.js)
function applyTocWidth(width){
	const style = document.getElementById("toc-panel").style;
	if ( !width ) { style.removeProperty("--toc-width"); return }
	style.setProperty("--toc-width", Math.min(maxTreeWidth, Math.max(minTreeWidth, width)) + "px");
}

function setupTocResizing(){
	const panel = document.getElementById("toc-panel");
	const resizer = document.getElementById("toc-resizer");
	applyTocWidth(Number(localStorage.getItem(tocWidthKey)) || null);
	resizer.addEventListener("pointerdown", (e) => {
		if ( e.button !== 0 ) { return }
		e.preventDefault();
		resizer.setPointerCapture(e.pointerId);
		const startX = e.clientX;
		const startWidth = panel.getBoundingClientRect().width;
		// docked right, the edge is on the panel's left: dragging left makes it wider
		const direction = layout.tocSide === "right" ? -1 : 1;
		document.body.classList.add("tree-resizing");
		const move = (ev) => applyTocWidth(startWidth + (ev.clientX - startX) * direction);
		const end = () => {
			resizer.removeEventListener("pointermove", move);
			resizer.removeEventListener("pointerup", end);
			resizer.removeEventListener("pointercancel", end);
			document.body.classList.remove("tree-resizing");
			if ( validateUserConsent(false) ) { localStorage.setItem(tocWidthKey, String(Math.round(panel.getBoundingClientRect().width))) }
		};
		resizer.addEventListener("pointermove", move);
		resizer.addEventListener("pointerup", end);
		resizer.addEventListener("pointercancel", end);
	});
	resizer.addEventListener("dblclick", () => {
		applyTocWidth(null);
		localStorage.removeItem(tocWidthKey);
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
		<p class="muted small">The headings listed. Open it from the menu or with <kbd>:TableOfContents</kbd> in vi mode; a click on a heading scrolls the document to it.</p>
		<label class="check"><input type="radio" name="setting-toc-side" value="tree"${layout.tocSide === "tree" ? " checked" : ""}>A tab next to the documents</label>
		<label class="check"><input type="radio" name="setting-toc-side" value="panel"${layout.tocSide !== "tree" ? " checked" : ""}>A panel of its own</label>
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
		const side = e.target.value === "tree" ? "tree" : layout.treeSide === "right" ? "left" : "right";
		layout.tocSide = side;
		if ( side === "tree" && !layout.tocHidden ) { layout.treeTab = "toc" }
		saveLayout();
	}));
}


document.getElementById("documents-tab").addEventListener("click", () => showTreeTab("documents"));
document.getElementById("toc-tab").addEventListener("click", () => showTreeTab("toc"));
document.getElementById("side-menu-btn").addEventListener("click", openSideMenu);
document.getElementById("toc-hide").addEventListener("click", closeTableOfContents);
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
// the list follows the focused document: edits, other documents opened, another editor focused (its id="editor")
new MutationObserver(scheduleToc).observe(document.getElementById("editor-grid"),
	{childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["id", "class", "data-collapsed"]});
document.addEventListener("scroll", (e) => {
	if ( tocScrollFrame || layout.tocHidden || !e.target.classList?.contains("pane-scroll") ) { return }
	tocScrollFrame = requestAnimationFrame(() => {
		tocScrollFrame = 0;
		markCurrentHeading();
	});
}, true);
narrowScreen.addEventListener("change", applyTocLayout);
applyTocLayout();
