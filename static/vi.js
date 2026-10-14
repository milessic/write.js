/*
 * Vi mode for the editors, modeled on Neovim / VSCodeVim.
 * Loaded by script.js (applyViMode) only when "Vi mode" is on in Settings; WriteVi.enable()/disable() toggle it later.
 *
 *  - modes: NORMAL, INSERT, VISUAL, V-LINE, REPLACE, and a command line for : / ?
 *  - h j k l (and the arrows) move like the arrow keys in the browser (Selection.modify), so j/k follow wrapped lines
 *  - everything else works on a plain-text model of the editor (textModel): blocks and <br> are "\n",
 *    and indexes into that text are mapped back to DOM positions
 *  - edits go through document.execCommand, so they stay on the browser's undo stack (u / Ctrl+r)
 *  - one mode for all the split editors; the mode is shown top right, colored by mode
 */
(() => {
if ( window.WriteVi ) { return }

const modeLabels = {normal: "NORMAL", insert: "INSERT", visual: "VISUAL", vline: "V-LINE", replace: "REPLACE", command: "COMMAND", tree: "TREE"};
const blockTags = new Set(["ADDRESS", "ARTICLE", "ASIDE", "BLOCKQUOTE", "DD", "DIV", "DL", "DT", "FIGURE", "FOOTER", "FORM", "H1", "H2", "H3", "H4", "H5", "H6", "HEADER", "HR", "LI", "MAIN", "NAV", "OL", "P", "PRE", "SECTION", "TABLE", "TBODY", "TD", "TH", "THEAD", "TR", "UL"]);
const operators = new Set(["d", "c", "y", ">", "<"]);
const caseOperators = {"g~": "toggle", "gu": "lower", "gU": "upper"};
// commands that change the text, remembered for "."
const changeCommands = new Set(["s", "i", "a", "I", "A", "o", "O", "R"]);
const brackets = {"(": ")", "[": "]", "{": "}", "<": ">"};
const closingBrackets = {")": "(", "]": "[", "}": "{", ">": "<"};
const incomplete = Symbol("incomplete");
const unknown = Symbol("unknown");      // keys that aren't a command: reported in the message line
const textObjectKinds = new Set(["w", "W", "\"", "'", "`", "b", "(", ")", "[", "]", "B", "{", "}", "<", ">", "p"]);

let enabled = false;
let mode = "normal";
let pending = [];                       // keys of the command being typed in NORMAL / VISUAL
let register = {text: "", linewise: false};
let lastFind = null;                    // {key: "f", char} for ; and ,
let lastSearch = null;                  // {pattern, backward}
let searchHighlight = false;            // hlsearch: matches of lastSearch stay highlighted until :noh
let lastChange = null;                  // {count, keys, text, visual} for .
let recording = null;                  // the change being recorded while in INSERT
let replaying = false;
let visualAnchor = 0;                   // VISUAL: text indexes, both ends inclusive
let visualHead = 0;
let expectedSelection = null;           // the selection vi set itself, other changes come from the mouse
let applying = false;                   // an execCommand is running (vi's or the toolbar's), not typing
const nativeExecCommand = document.execCommand;
let composing = null;                   // IME composition started outside INSERT (phone keyboards)
let commandLine = null;                 // {input, editor, index, kind, visual}
let lastEditor = null;                  // the editor the mobile Esc button goes back to
let lastRange = null;                   // and its selection when it lost the focus
let treePending = [];                   // keys of a file tree command being typed (g, Ctrl+W)
const editorRanges = new WeakMap();     // each editor's selection, for going back to it with Ctrl+W h j k l
let escapeAt = -Infinity;               // when vi got an Esc in an editor
let normalEscapeAt = -Infinity;         // the last Esc in NORMAL with nothing pending: Esc Esc leaves focus mode
let pointerAt = -Infinity;              // the last click / tap: a focus change that comes after one is the user's

const ui = {};


// public API (script.js)
window.WriteVi = {
	enable(){
		if ( enabled ) { return }
		enabled = true;
		// Firefox and Safari fire beforeinput for execCommand: edits made by scripts (vi, the toolbar)
		// must not be blocked in NORMAL or read as keys
		document.execCommand = function(...args){
			applying = true;
			try {
				return nativeExecCommand.apply(this, args);
			} finally {
				applying = false;
			}
		};
		buildUi();
		document.addEventListener("keydown", onKeydown, true);
		document.addEventListener("keyup", onKeyup, true);
		document.addEventListener("pointerdown", onPointerDown, true);
		document.addEventListener("click", onTreeClick);
		document.addEventListener("beforeinput", onBeforeInput, true);
		document.addEventListener("compositionstart", onCompositionStart, true);
		document.addEventListener("compositionend", onCompositionEnd, true);
		document.addEventListener("selectionchange", onSelectionChange);
		document.addEventListener("focusin", onFocusIn);
		document.addEventListener("focusout", onFocusOut);
		document.addEventListener("scroll", renderCursor, true);
		document.addEventListener("input", renderSearch, true);
		window.addEventListener("resize", onResize);
		setMode("normal");
		WriteVi.setEscButton(localStorage.getItem(viEscButtonKey) === "1");
	},
	disable(){
		if ( !enabled ) { return }
		closeCommandLine(false);
		document.removeEventListener("keydown", onKeydown, true);
		document.removeEventListener("keyup", onKeyup, true);
		document.removeEventListener("pointerdown", onPointerDown, true);
		document.removeEventListener("click", onTreeClick);
		document.removeEventListener("beforeinput", onBeforeInput, true);
		document.removeEventListener("compositionstart", onCompositionStart, true);
		document.removeEventListener("compositionend", onCompositionEnd, true);
		document.removeEventListener("selectionchange", onSelectionChange);
		document.removeEventListener("focusin", onFocusIn);
		document.removeEventListener("focusout", onFocusOut);
		document.removeEventListener("scroll", renderCursor, true);
		document.removeEventListener("input", renderSearch, true);
		window.removeEventListener("resize", onResize);
		clearSearchHighlight();
		document.execCommand = nativeExecCommand;
		mode = "insert";
		setTypingAttributes(true);
		document.body.classList.remove("vi-enabled", "vi-block-caret", "vi-esc-enabled");
		ui.root?.remove();
		enabled = false;
	},
	setEscButton(show){
		document.body.classList.toggle("vi-esc-enabled", show);
	},
	get mode(){ return mode },
};


// UI: mode indicator, block cursor, Esc button
function buildUi(){
	if ( ui.root ) {
		document.body.appendChild(ui.root);
		document.body.classList.add("vi-enabled");
		placeIndicator();
		return
	}
	const style = document.createElement("style");
	style.textContent = `
		/* fixed colors, like a statusline: theme accents can be the same hue for two modes */
		/* one block: [ Esc | MODE ], the Esc segment only on phones (Settings) */
		/* over the editors, under the rest of the UI (top bar 5, menus 10+, dropdowns and modals 20+) */
		.vi-bar { position: fixed; z-index: 4; display: flex; align-items: center; gap: .4rem; pointer-events: none; }
		.vi-mode { --vi-color: #2f7de1; display: flex; align-items: stretch; overflow: hidden; border-radius: calc(var(--radius, 10px) / 3); background: var(--vi-color); color: #fff; font: 700 .7rem/1.5 var(--font-mono, monospace);
			letter-spacing: .06em; box-shadow: 0 1px 4px rgba(0, 0, 0, .25); pointer-events: none; user-select: none; transition: background-color .12s; }
		.vi-mode[data-mode="insert"] { --vi-color: #1f9d48; }
		.vi-mode[data-mode="visual"] { --vi-color: #9b4fe0; }
		.vi-mode[data-mode="vline"] { --vi-color: #c2410c; }
		.vi-mode[data-mode="replace"] { --vi-color: #d03b3b; }
		.vi-mode[data-mode="command"] { --vi-color: #3a3a3a; pointer-events: auto; }
		.vi-mode[data-mode="tree"] { --vi-color: #0f766e; }
		.vi-mode-body { display: flex; align-items: center; gap: .4rem; padding: .15rem .55rem; }
		.vi-mode-keys:empty, .vi-mode-cmd { display: none; }
		.vi-mode-keys { font-weight: 400; opacity: .85; }
		.vi-mode[data-mode="command"] .vi-mode-cmd { display: flex; align-items: center; }
		.vi-mode-cmd input:focus, .vi-mode-cmd input:focus-visible { outline: none; box-shadow: none; border: 0; }
		.vi-mode-cmd input { all: unset; width: min(16rem, 60vw); padding-left: .15rem; color: inherit; caret-color: currentColor; font: 400 .8rem/1.5 var(--font-mono, monospace); }
		.vi-message { max-width: min(28rem, 55vw); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: .15rem .55rem; border-radius: calc(var(--radius, 10px) / 3);
			background: #3a3a3a; color: #fff; font: 400 .72rem/1.5 var(--font-mono, monospace); box-shadow: 0 1px 4px rgba(0, 0, 0, .25); }
		.vi-message[hidden] { display: none; }
		.vi-complete { position: fixed; z-index: 4; margin: 0; padding: .2rem 0; list-style: none; min-width: 12rem; max-width: min(28rem, 80vw); max-height: 50vh; overflow-y: auto;
			border-radius: calc(var(--radius, 10px) / 3); background: #3a3a3a; color: #fff; font: 400 .78rem/1.5 var(--font-mono, monospace); box-shadow: 0 2px 8px rgba(0, 0, 0, .3); }
		.vi-complete[hidden] { display: none; }
		.vi-complete li { padding: .1rem .6rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; }
		.vi-complete li:hover { background: rgba(255, 255, 255, .1); }
		.vi-complete li[aria-selected="true"] { background: #2f7de1; }
		.vi-complete li.vi-complete-empty { opacity: .65; cursor: default; background: none; }
		.vi-complete mark { background: none; color: inherit; font-weight: 700; text-decoration: underline; }
		.vi-message[data-type="error"] { background: #d03b3b; }
		.vi-message[data-type="warning"] { background: #b45309; }
		::highlight(vi-search) { background-color: rgba(245, 196, 0, .35); }
		::highlight(vi-search-current) { background-color: #f5c400; color: #000; }
		.vi-help { table-layout: fixed; }
		.vi-help td:first-child { width: 40%; }
		.vi-help kbd { white-space: nowrap; }
		.vi-cursor { position: fixed; z-index: 3; pointer-events: none; display: none; border-radius: 1px;
			background: color-mix(in srgb, var(--vi-color, #2f7de1) 55%, transparent); }
		.vi-esc { all: unset; display: none; min-height: 2rem; padding: 0 .6rem 0 .75rem; pointer-events: auto; cursor: pointer;
			border-right: 1px solid rgba(255, 255, 255, .45); color: inherit; font: 700 .75rem/1 var(--font-mono, monospace); letter-spacing: .04em; }
		.vi-esc:active { background: rgba(0, 0, 0, .18); }
		.vi-esc:focus-visible { outline: 2px solid #fff; outline-offset: -3px; }
		@media (pointer: coarse) {
			.vi-esc-enabled .vi-esc { display: flex; align-items: center; }
		}
		.vi-block-caret #editor-grid .editor { caret-color: transparent; }
		/* focus mode: only the command line shows, and the phone Esc in gray */
		.focus-mode .vi-mode:not([data-mode="command"]) { background: none; box-shadow: none; }
		.focus-mode .vi-mode:not([data-mode="command"]) .vi-mode-body { display: none; }
		.focus-mode .vi-mode:not([data-mode="command"]) .vi-esc { border-right: 0; color: var(--muted, #888); opacity: .6; }
	`;
	ui.root = document.createElement("div");
	ui.root.id = "vi-root";
	ui.indicator = document.createElement("div");
	ui.indicator.className = "vi-mode";
	ui.indicator.setAttribute("role", "group");
	ui.indicator.setAttribute("aria-label", "Vi mode");
	ui.indicator.innerHTML = `<span class="vi-mode-body"><span class="vi-mode-name" role="status"></span><span class="vi-mode-keys"></span><span class="vi-mode-cmd"><span class="vi-mode-prefix"></span><input type="text" spellcheck="false" autocomplete="off" autocapitalize="off" aria-label="Vi command"></span></span>`;
	ui.cursor = document.createElement("div");
	ui.cursor.className = "vi-cursor";
	ui.esc = document.createElement("button");
	ui.esc.className = "vi-esc";
	ui.esc.type = "button";
	ui.esc.textContent = "Esc";
	ui.esc.setAttribute("aria-label", "Escape (vi)");
	// keeps the focus (and the phone keyboard) in the editor: Chrome on Android still focuses a tapped
	// button when only pointerdown is cancelled, a cancelled touchstart stops the tap (and its click) entirely
	ui.esc.tabIndex = -1;
	ui.esc.addEventListener("touchstart", (e) => e.preventDefault(), {passive: false});
	ui.esc.addEventListener("touchend", (e) => {
		e.preventDefault();
		const touch = e.changedTouches[0];
		if ( touch && ui.esc.contains(document.elementFromPoint(touch.clientX, touch.clientY)) ) { pressEsc() }
	});
	ui.esc.addEventListener("mousedown", (e) => e.preventDefault());
	ui.esc.addEventListener("click", pressEsc);
	const input = ui.indicator.querySelector("input");
	input.addEventListener("keydown", onCommandLineKeydown);
	input.addEventListener("input", updateCompletions);
	ui.completions = document.createElement("ul");
	ui.completions.className = "vi-complete";
	ui.completions.setAttribute("role", "listbox");
	ui.completions.hidden = true;
	// keeps the focus in the command line, a blur would close it
	ui.completions.addEventListener("mousedown", (e) => e.preventDefault());
	ui.completions.addEventListener("click", onCompletionClick);
	input.addEventListener("blur", () => { if ( commandLine ) { closeCommandLine(false) } });
	ui.bar = document.createElement("div");
	ui.bar.className = "vi-bar";
	ui.message = document.createElement("span");
	ui.message.className = "vi-message";
	ui.message.hidden = true;
	ui.message.setAttribute("role", "status");
	ui.indicator.prepend(ui.esc);
	ui.bar.append(ui.message, ui.indicator);
	ui.root.append(style, ui.bar, ui.completions, ui.cursor);
	document.body.appendChild(ui.root);
	document.body.classList.add("vi-enabled");
	placeIndicator();
}

function placeIndicator(){
	// top right of the editors, under the editor headers of a split view and clear of the scrollbar
	const grid = document.getElementById("editor-grid").getBoundingClientRect();
	const head = document.querySelector("#editor-grid .pane-head");
	const headHeight = head?.offsetHeight ? head.getBoundingClientRect().height : 0;
	ui.bar.style.top = `${Math.round(grid.top + headHeight + 6)}px`;
	ui.bar.style.right = `${Math.round(window.innerWidth - grid.right + 20)}px`;
}

function onResize(){
	placeIndicator();
	renderCursor();
}

function setMode(next){
	const wasInsert = mode === "insert" || mode === "replace";
	mode = next;
	if ( mode !== "command" ) { pending = [] }
	const isInsert = mode === "insert" || mode === "replace";
	if ( isInsert !== wasInsert ) { setTypingAttributes(isInsert) }
	render();
}

function render(){
	if ( !ui.root ) { return }
	placeIndicator();
	const shown = inTree() ? "tree" : mode;
	ui.indicator.dataset.mode = shown;
	ui.indicator.querySelector(".vi-mode-name").textContent = modeLabels[shown];
	ui.indicator.querySelector(".vi-mode-keys").textContent = (inTree() ? treePending : pending).map(displayKey).join("");
	const color = getComputedStyle(ui.indicator).getPropertyValue("--vi-color");
	ui.root.style.setProperty("--vi-color", color);
	document.body.classList.toggle("vi-block-caret", mode !== "insert" && mode !== "replace");
	renderCursor();
	renderSearch();
}

function displayKey(key){
	return key.length === 1 ? key : `<${key.replace(/^<|>$/g, "")}>`;
}

function renderCursor(){
	// a block over the character under the cursor; the native caret is hidden outside INSERT
	if ( !ui.cursor ) { return }
	const editor = focusedEditor();
	if ( !editor || mode === "insert" || mode === "replace" || mode === "command" ) {
		ui.cursor.style.display = "none";
		return
	}
	const model = textModel(editor);
	const index = mode === "normal" ? caretIndex(model) : visualHead;
	if ( index === null ) {
		ui.cursor.style.display = "none";
		return
	}
	const rect = characterRect(model, index);
	// scrolled out of the editor: it would be drawn over the toolbar
	const view = editor.closest(".pane-scroll")?.getBoundingClientRect();
	if ( !rect || (view && (rect.bottom <= view.top || rect.top >= view.bottom)) ) {
		ui.cursor.style.display = "none";
		return
	}
	Object.assign(ui.cursor.style, {
		display: "block",
		left: `${rect.left}px`,
		top: `${rect.top}px`,
		width: `${Math.max(rect.width, 2)}px`,
		height: `${rect.height}px`,
	});
}

function characterRect(model, index){
	const char = model.text[index];
	const start = positionAt(model, index);
	const range = document.createRange();
	range.setStart(start.node, start.offset);
	const fontSize = parseFloat(getComputedStyle(elementOf(start.node)).fontSize) || 16;
	if ( char !== undefined && char !== "\n" ) {
		const end = positionAt(model, index + 1);
		range.setEnd(end.node, end.offset);
		// a range across a line wrap has two rects: the character is in the last one
		const rects = [...range.getClientRects()].filter(r => r.width > 0);
		if ( rects.length ) { return rects[rects.length - 1] }
	}
	range.collapse(true);
	let rect = range.getClientRects()[0] || range.getBoundingClientRect();
	if ( !rect || (!rect.height && !rect.left && !rect.top) ) {
		// an empty line (<div><br></div>): the caret sits at the start of its block
		const block = elementOf(start.node);
		const box = block.getBoundingClientRect();
		const style = getComputedStyle(block);
		const lineHeight = parseFloat(style.lineHeight) || fontSize * 1.4;
		return {left: box.left + parseFloat(style.paddingLeft || 0), top: box.top + parseFloat(style.paddingTop || 0), width: fontSize * .6, height: lineHeight};
	}
	return {left: rect.left, top: rect.top, width: fontSize * .6, height: rect.height};
}

function setTypingAttributes(typing){
	// phone keyboards compose words (and their keys can't be cancelled) unless the corrections are off
	for ( const editor of document.querySelectorAll("#editor-grid .editor") ) {
		if ( typing ) {
			if ( editor.dataset.viSpellcheck !== undefined ) {
				editor.spellcheck = editor.dataset.viSpellcheck === "true";
				delete editor.dataset.viSpellcheck;
			}
			editor.removeAttribute("autocorrect");
			editor.removeAttribute("autocapitalize");
		} else {
			if ( editor.dataset.viSpellcheck === undefined ) { editor.dataset.viSpellcheck = String(editor.spellcheck) }
			editor.spellcheck = false;
			editor.setAttribute("autocorrect", "off");
			editor.setAttribute("autocapitalize", "off");
		}
	}
}


// events
function editorOf(node){
	const el = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
	const editor = el?.closest(".editor");
	return editor && editor.closest("#editor-grid") ? editor : null;
}

function focusedEditor(){
	return editorOf(document.activeElement);
}

function keyName(e){
	if ( ["Shift", "Control", "Alt", "Meta", "CapsLock", "AltGraph", "Dead", "Unidentified", "Process"].includes(e.key) ) { return null }
	if ( e.ctrlKey && !e.altKey ) {
		if ( e.key === "[" ) { return "Escape" }
		return e.key.length === 1 ? `<C-${e.key.toLowerCase()}>` : null;
	}
	return e.key;
}

const ctrlKeys = new Set(["<C-r>", "<C-d>", "<C-u>", "<C-w>"]);
const namedKeys = new Set(["Escape", "Enter", "Backspace", "Delete", "Tab", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"]);

function onKeydown(e){
	if ( closePopupsWithQ(e) ) { return }
	if ( !commandLine && e.target.closest?.("#file-tree") ) { onTreeKeydown(e); return }
	const editor = editorOf(e.target);
	if ( !editor || commandLine ) { return }
	if ( e.isComposing || e.keyCode === 229 ) { return }   // phone keyboard: comes as beforeinput
	const key = keyName(e);
	if ( !key || e.metaKey ) { return }
	if ( key === "Escape" ) { escapeAt = performance.now() }
	if ( mode === "insert" || mode === "replace" ) {
		if ( key === "Escape" ) {
			e.preventDefault();
			e.stopPropagation();
			handleKey("Escape", editor);
		} else if ( mode === "replace" && key.length === 1 && !e.ctrlKey && !e.altKey ) {
			e.preventDefault();
			e.stopPropagation();
			replaceChar(editor, key);
		}
		return
	}
	// NORMAL / VISUAL: browser shortcuts that vi doesn't use pass through (Ctrl+S, Ctrl+\, Alt+...)
	// after Ctrl+W any key is its window command (Ctrl+W Ctrl+V splits)
	if ( e.altKey || (key.startsWith("<C-") && !ctrlKeys.has(key) && pending.at(-1) !== "<C-w>") ) { return }
	if ( key.length > 1 && !key.startsWith("<C-") && !namedKeys.has(key) ) { return }
	e.preventDefault();
	e.stopPropagation();
	handleKey(key, editor);
}

function closePopupsWithQ(e){
	// q closes every open pop-up (script.js), unless it is typed: in INSERT, in a field, after a pending key
	if ( e.key !== "q" || e.ctrlKey || e.metaKey || e.altKey || e.isComposing || commandLine ) { return false }
	if ( typeof openPopups !== "function" || !openPopups().length ) { return false }
	const editor = editorOf(e.target);
	const typing = editor ? mode === "insert" || mode === "replace" || pending.length > 0
		: e.target.closest?.('input:not([type=checkbox], [type=radio], [type=button], [type=submit], [type=reset], [type=range], [type=color], [type=file]), textarea, select, [contenteditable]:not([contenteditable="false"])');
	if ( typing ) { return false }
	e.preventDefault();
	e.stopPropagation();
	closeAllPopups();
	render();
	return true
}

function onKeyup(e){
	if ( e.key === "Escape" && editorOf(e.target) && !commandLine ) {
		e.preventDefault();
		e.stopPropagation();
	}
}

function onPointerDown(e){
	// clicks in the editor don't move the focus away from it
	if ( !editorOf(e.target) ) { pointerAt = performance.now() }
}

function onBeforeInput(e){
	const editor = editorOf(e.target);
	if ( !editor || applying ) { return }
	if ( mode === "insert" || mode === "replace" ) {
		if ( recording && !replaying ) { recordInput(e) }
		return
	}
	// NORMAL / VISUAL: the text only changes through vi; formatting and the browser's undo stay usable
	if ( e.inputType.startsWith("format") || e.inputType.startsWith("history") ) { return }
	if ( e.inputType === "insertCompositionText" ) { return }   // can't be cancelled, see onCompositionEnd
	if ( e.cancelable ) { e.preventDefault() }
	// phone keyboards don't tell the key on keydown, they insert it
	if ( e.inputType === "insertText" && e.data ) {
		for ( const char of e.data ) { handleKey(char, editor) }
	} else if ( e.inputType === "insertParagraph" || e.inputType === "insertLineBreak" ) {
		handleKey("Enter", editor);
	} else if ( e.inputType === "deleteContentBackward" ) {
		handleKey("Backspace", editor);
	}
}

function onCompositionStart(e){
	const editor = editorOf(e.target);
	if ( !editor || mode === "insert" || mode === "replace" ) { return }
	composing = {editor, index: caretIndex(textModel(editor))};
}

function onCompositionEnd(e){
	if ( !composing ) { return }
	const {editor, index} = composing;
	composing = null;
	if ( !e.data || mode === "insert" || mode === "replace" ) { return }
	// a phone keyboard composed the key into the text: take it out again and run it
	const model = textModel(editor);
	const end = caretIndex(model);
	if ( end !== null && end > index ) {
		selectRange(model, index, end);
		exec("delete");
		setCaret(textModel(editor), index);
	}
	for ( const char of e.data.slice(-1) ) { handleKey(char, editor) }
}

function onSelectionChange(){
	const selection = window.getSelection();
	const editor = editorOf(selection.focusNode);
	if ( !editor || mode === "command" ) { renderCursor(); return }
	if ( isExpectedSelection(selection) ) { renderCursor(); return }
	// the mouse (or Ctrl+A) changed the selection
	if ( mode === "normal" && !selection.isCollapsed ) {
		const model = textModel(editor);
		visualAnchor = indexAt(model, selection.anchorNode, selection.anchorOffset);
		const focus = indexAt(model, selection.focusNode, selection.focusOffset);
		visualHead = focus > visualAnchor ? focus - 1 : focus;
		setMode("visual");
		return
	}
	if ( (mode === "visual" || mode === "vline") ) {
		const model = textModel(editor);
		if ( selection.isCollapsed ) {
			setMode("normal");
			return
		}
		visualAnchor = indexAt(model, selection.anchorNode, selection.anchorOffset);
		const focus = indexAt(model, selection.focusNode, selection.focusOffset);
		visualHead = focus > visualAnchor ? focus - 1 : focus;
	}
	renderCursor();
}

function pressEsc(){
	if ( commandLine ) { closeCommandLine(false); return }
	const editor = focusedEditor() || lastEditor || document.getElementById("editor");
	if ( !editor ) { return }
	if ( document.activeElement !== editor ) {
		// the focus got away anyway: back to the editor, with its cursor
		editor.focus({preventScroll: true});
		if ( lastRange && editor.contains(lastRange.startContainer) ) {
			const selection = window.getSelection();
			selection.removeAllRanges();
			selection.addRange(lastRange);
		}
	}
	handleKey("Escape", editor);
}

function onFocusIn(e){
	if ( editorOf(e.target) ) { lastEditor = editorOf(e.target) }
	// editors opened by splitting need the same typing attributes
	setTypingAttributes(mode === "insert" || mode === "replace");
	render();
}

function onFocusOut(e){
	const selection = window.getSelection();
	const editor = editorOf(e.target);
	if ( editor && selection.rangeCount ) {
		lastRange = selection.getRangeAt(0).cloneRange();
		editorRanges.set(editor, lastRange);
	}
	// Esc must only change the mode, but browser extensions (Vimium, Surfingkeys, ...) take the Esc key before
	// the page and blur the editor: the focus going nowhere, without a click, Tab or switching windows, is that Esc
	if ( editor && e.target === editor && !e.relatedTarget && !commandLine && performance.now() - pointerAt > 500 ) {
		const range = lastRange;
		const seenEscape = performance.now() - escapeAt < 1000;
		escapeAt = -Infinity;
		setTimeout(() => {
			if ( !enabled || !editor.isConnected || !document.hasFocus() ) { return }
			if ( document.activeElement && document.activeElement !== document.body ) { return }
			editor.focus({preventScroll: true});
			if ( range && editor.contains(range.startContainer) ) {
				const selection = window.getSelection();
				selection.removeAllRanges();
				selection.addRange(range);
			}
			if ( !seenEscape && (mode === "insert" || mode === "replace") ) { handleKey("Escape", editor) }
			renderCursor();
		});
	}
	// the focus may go to a toolbar button and come back, so only the cursor goes
	requestAnimationFrame(render);
}

function isExpectedSelection(selection){
	const e = expectedSelection;
	return e && selection.anchorNode === e.anchorNode && selection.anchorOffset === e.anchorOffset
		&& selection.focusNode === e.focusNode && selection.focusOffset === e.focusOffset;
}

function rememberSelection(){
	const s = window.getSelection();
	expectedSelection = {anchorNode: s.anchorNode, anchorOffset: s.anchorOffset, focusNode: s.focusNode, focusOffset: s.focusOffset};
}


// text model: the editor as plain text, block boundaries and <br> are "\n"
function textModel(editor){
	let text = "";
	const segments = [];   // {node, start, length, kind: "text" | "br" | "empty"}
	let lineOpen = false;      // the current line has something on it
	let pendingBreak = false;  // a block ended: the next content starts a new line
	const emit = (node, kind, string) => {
		if ( pendingBreak ) {
			text += "\n";
			pendingBreak = false;
		}
		segments.push({node, start: text.length, length: string.length, kind});
		text += string;
		lineOpen = true;
	};
	const breakLine = () => {
		if ( lineOpen ) {
			pendingBreak = true;
			lineOpen = false;
		}
	};
	const walk = (parent) => {
		for ( const node of parent.childNodes ) {
			if ( node.nodeType === Node.TEXT_NODE ) {
				if ( !isLayoutWhitespace(node) ) { emit(node, "text", node.data) }
			} else if ( node.nodeType !== Node.ELEMENT_NODE ) {
				continue
			} else if ( node.tagName === "BR" ) {
				// a <br> at the end of a block only holds an empty line open, it doesn't add one
				emit(node, "br", isTrailing(node) ? "" : "\n");
			} else if ( node.tagName === "HR" ) {
				breakLine();
			} else if ( blockTags.has(node.tagName) ) {
				breakLine();
				const count = segments.length;
				walk(node);
				if ( segments.length === count && !["UL", "OL", "DL", "TABLE", "TBODY", "THEAD", "TR"].includes(node.tagName) ) {
					emit(node, "empty", "");
				}
				breakLine();
			} else {
				walk(node);
			}
		}
	};
	walk(editor);
	return {editor, text, segments};
}

function isTrailing(node){
	let next = node.nextSibling;
	while ( next && next.nodeType === Node.TEXT_NODE && (next.data === "" || isLayoutWhitespace(next)) ) { next = next.nextSibling }
	if ( next ) { return next.nodeType === Node.ELEMENT_NODE && blockTags.has(next.tagName) }
	// the last thing in an inline element (<b>text<br></b>) trails if the element does
	const parent = node.parentNode;
	return parent.nodeType !== Node.ELEMENT_NODE || blockTags.has(parent.tagName) || parent.classList.contains("editor") || isTrailing(parent);
}

function isLayoutWhitespace(node){
	// indentation between blocks in imported HTML isn't text the user sees
	if ( node.data.trim() !== "" || !node.data.includes("\n") ) { return false }
	const isBlock = (n) => !n || (n.nodeType === Node.ELEMENT_NODE && blockTags.has(n.tagName));
	return isBlock(node.previousSibling) && isBlock(node.nextSibling);
}

function elementOf(node){
	return node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
}

function positionAt(model, index){
	// the DOM position before the character at index
	index = Math.max(0, Math.min(index, model.text.length));
	let found = null;
	for ( const segment of model.segments ) {
		if ( segment.start > index ) { break }
		found = segment;
	}
	if ( !found ) { return {node: model.editor, offset: 0} }
	if ( found.kind === "text" ) { return {node: found.node, offset: Math.min(index - found.start, found.length)} }
	if ( found.kind === "br" ) {
		const parent = found.node.parentNode;
		// before the <br> is the end of its line, after it the start of the next one
		return {node: parent, offset: [...parent.childNodes].indexOf(found.node) + (index > found.start ? 1 : 0)};
	}
	return {node: found.node, offset: 0};
}

function indexAt(model, node, offset){
	if ( !node || !model.editor.contains(node) ) { return null }
	if ( node.nodeType === Node.TEXT_NODE ) {
		const segment = model.segments.find(s => s.node === node);
		if ( segment ) { return segment.start + offset }
	}
	const point = document.createRange();
	point.setStart(node, offset);
	let index = 0;
	for ( const segment of model.segments ) {
		const [n, o] = segmentPoint(segment);
		const order = point.comparePoint(n, o);
		if ( order > 0 ) { break }
		if ( order === 0 ) { return segment.start }
		index = segment.start + segment.length;
	}
	return Math.min(index, model.text.length);
}

function segmentPoint(segment){
	if ( segment.kind === "br" ) {
		const parent = segment.node.parentNode;
		return [parent, [...parent.childNodes].indexOf(segment.node)];
	}
	return [segment.node, 0];
}

function caretIndex(model){
	const selection = window.getSelection();
	if ( !selection.rangeCount ) { return null }
	return indexAt(model, selection.focusNode, selection.focusOffset);
}

function setCaret(model, index){
	const p = positionAt(model, index);
	window.getSelection().collapse(p.node, p.offset);
	rememberSelection();
}

function selectRange(model, from, to){
	const a = positionAt(model, from);
	const b = positionAt(model, to);
	window.getSelection().setBaseAndExtent(a.node, a.offset, b.node, b.offset);
	rememberSelection();
}

function lineStart(text, i){ return text.lastIndexOf("\n", i - 1) + 1 }
function lineEnd(text, i){
	const end = text.indexOf("\n", i);
	return end === -1 ? text.length : end;
}
function firstNonBlank(text, i){
	let j = lineStart(text, i);
	const end = lineEnd(text, i);
	while ( j < end && isBlank(text[j]) ) { j++ }
	return j;
}
function lastCharOfLine(text, i){ return Math.max(lineStart(text, i), lineEnd(text, i) - 1) }
function lineNumber(text, i){
	let n = 0;
	for ( let j = 0; j < i; j++ ) { if ( text[j] === "\n" ) { n++ } }
	return n;
}
function lineStartOfNumber(text, n){
	let i = 0;
	for ( let line = 0; line < n; line++ ) {
		const next = text.indexOf("\n", i);
		if ( next === -1 ) { break }
		i = next + 1;
	}
	return i;
}
function lineCount(text){ return text.split("\n").length }

function isBlank(c){ return c === " " || c === "\t" || c === "\u00a0" }
function isSpace(c){ return c === undefined || c === "\n" || isBlank(c) }
function charClass(c, bigWord){
	if ( isSpace(c) ) { return 0 }
	if ( bigWord ) { return 1 }
	return /[\p{L}\p{N}_]/u.test(c) ? 2 : 1;
}
function isEmptyLine(text, i){ return lineStart(text, i) === lineEnd(text, i) }


// edits: execCommand keeps them on the undo stack
function exec(command, value=null){
	// Chrome copies the computed style into merged lines: the hidden caret must not end up in the document
	const hidden = document.body.classList.contains("vi-block-caret");
	document.body.classList.remove("vi-block-caret");
	document.execCommand(command, false, value);
	if ( hidden ) { document.body.classList.add("vi-block-caret") }
}

function insertLines(lines){
	lines.forEach((line, i) => {
		if ( i ) { exec("insertParagraph") }
		if ( line ) { exec("insertText", line) }
	});
}

function deleteRange(model, from, to){
	if ( to <= from ) { return }
	selectRange(model, from, to);
	exec("delete");
}

function changed(){
	if ( typeof performAutoSave === "function" ) { performAutoSave() }
	if ( typeof handleWordCounter === "function" ) { handleWordCounter() }
}


// keys
function handleKey(key, editor){
	hideMessage();
	if ( mode === "insert" || mode === "replace" ) {
		if ( key === "Escape" ) { leaveInsert(editor) }
		return
	}
	if ( key === "Escape" && mode === "normal" && !pending.length && document.body.classList.contains("focus-mode") ) {
		if ( performance.now() - normalEscapeAt < 500 ) {
			normalEscapeAt = -Infinity;
			toggleFocusMode(false);
			render();
			return
		}
		normalEscapeAt = performance.now();
	} else {
		normalEscapeAt = -Infinity;
	}
	pending.push(key);
	let result;
	try {
		result = mode === "normal" ? runNormal(editor, pending) : runVisual(editor, pending);
	} catch ( err ) {
		if ( err !== incomplete ) {
			console.error("vi:", err);
			pending = [];
		}
		render();
		return
	}
	if ( result === unknown ) { showMessage(`Unknown command: ${pending.map(displayKey).join("")} (:help lists the commands)`, "error") }
	pending = [];
	if ( result?.change && !replaying ) {
		lastChange = {count: result.count, keys: result.keys, text: null, visual: result.visual};
		if ( mode === "insert" || mode === "replace" ) { recording = lastChange }
	}
	render();
}

function reader(keys){
	let p = 0;
	const reader = {
		next(){
			if ( p >= keys.length ) { throw incomplete }
			return keys[p++];
		},
		peek(){ return keys[p] },
		count(){
			let digits = "";
			while ( p < keys.length && /^[0-9]$/.test(keys[p]) && !(keys[p] === "0" && !digits) ) { digits += keys[p++] }
			if ( p >= keys.length && digits ) { throw incomplete }
			return digits ? parseInt(digits) : null;
		},
		get rest(){ return keys.slice(p) },
		get position(){ return p },
	};
	return reader;
}

function runNormal(editor, keys){
	const r = reader(keys);
	const count1 = r.count();
	const start = r.position;
	let key = r.next();
	const count = count1 || 1;
	const model = textModel(editor);
	const text = model.text;
	const i = caretIndex(model) ?? 0;
	const keysAfterCount = () => keys.slice(start);

	if ( key === "Escape" ) { return }
	if ( key === "g" ) {
		const second = r.next();
		key = "g" + second;
		if ( caseOperators[key] ) { return runOperator(editor, model, i, key, count1, r, keysAfterCount) }
	}
	if ( operators.has(key) ) { return runOperator(editor, model, i, key, count1, r, keysAfterCount) }

	const motion = parseMotion(key, r);
	if ( motion ) {
		moveCaret(editor, model, i, motion, count1);
		return
	}
	if ( ["f", "F", "t", "T"].includes(key) ) { return }   // f<Esc>

	switch ( key ) {
	// INSERT
	case "i": enterInsert(model, i); break;
	case "a": enterInsert(model, text[i] !== undefined && text[i] !== "\n" ? i + 1 : i); break;
	case "I": enterInsert(model, firstNonBlank(text, i)); break;
	case "A": enterInsert(model, lineEnd(text, i)); break;
	case "o": openLine(editor, model, i, false); break;
	case "O": openLine(editor, model, i, true); break;
	case "R": setMode("replace"); break;
	case "s": {
		const end = Math.min(i + count, lineEnd(text, i));
		yank(text.slice(i, end), false);
		deleteRange(model, i, end);
		enterInsert(textModel(editor), i);
		changed();
		break;
	}
	case "S": return runOperator(editor, model, i, "c", count1, reader(["c"]), () => keysAfterCount(), true);
	case "C": return runOperator(editor, model, i, "c", count1, reader(["$"]), keysAfterCount);
	case "D": return runOperator(editor, model, i, "d", count1, reader(["$"]), keysAfterCount);
	case "Y": return runOperator(editor, model, i, "y", count1, reader(["$"]), keysAfterCount);
	// changes
	case "x":
	case "Delete": {
		const end = Math.min(i + count, lineEnd(text, i));
		if ( end <= i ) { return }
		yank(text.slice(i, end), false);
		deleteRange(model, i, end);
		clampCaret(editor);
		changed();
		return {change: true, count: count1, keys: ["x"]};
	}
	case "X": {
		const from = Math.max(lineStart(text, i), i - count);
		if ( from >= i ) { return }
		yank(text.slice(from, i), false);
		deleteRange(model, from, i);
		changed();
		return {change: true, count: count1, keys: ["X"]};
	}
	case "r": {
		const char = r.next();
		if ( char === "Escape" ) { return }
		const end = i + count;
		if ( end > lineEnd(text, i) ) { return }
		selectRange(model, i, end);
		if ( char === "Enter" ) { exec("insertParagraph") } else if ( char.length === 1 ) { exec("insertText", char.repeat(count)) }
		setCaret(textModel(editor), char === "Enter" ? i + 1 : end - 1);
		changed();
		return {change: true, count: count1, keys: ["r", char]};
	}
	case "~": {
		const end = Math.min(i + count, lineEnd(text, i));
		if ( end <= i ) { return }
		replacePerLine(editor, i, end, toggleCase);
		setCaret(textModel(editor), Math.min(end, lastCharOfLine(textModel(editor).text, i)));
		changed();
		return {change: true, count: count1, keys: ["~"]};
	}
	case "J": joinLines(editor, model, i, Math.max(count, 2)); changed(); return {change: true, count: count1, keys: ["J"]};
	case "p":
	case "P": put(editor, model, i, key === "P", count); changed(); return {change: true, count: count1, keys: [key]};
	case "u": for ( let n = 0; n < count; n++ ) { exec("undo") } clampCaret(editor); changed(); return;
	case "<C-r>": for ( let n = 0; n < count; n++ ) { exec("redo") } changed(); return;
	case ".": repeatLastChange(editor, count1); return;
	case "Tab": {
		// checks / unchecks the checklist item of the cursor's line, like Ctrl+Enter (checklist.js)
		const item = selectedListItems(editor).find(isTaskItem);
		if ( !item ) { return }
		setTaskItemsChecked([item], !isChecked(item));
		return {change: true, count: null, keys: ["Tab"]};
	}
	// VISUAL
	case "v":
	case "V":
		visualAnchor = visualHead = i;
		setMode(key === "v" ? "visual" : "vline");
		renderVisual(editor);
		return;
	// command line, search
	case ":": openCommandLine(editor, ":", count1 ? `.,.+${count1 - 1}` : ""); return;
	case "/":
	case "?": openCommandLine(editor, key); return;
	case "n":
	case "N":
		if ( !lastSearch ) { showMessage("E35: No previous regular expression", "error"); return }
		searchMove(editor, model, i, lastSearch.pattern, lastSearch.backward !== (key === "N"), count);
		return;
	case "*":
	case "#": {
		const [from, to] = wordObject(text, i, false, false);
		const word = text.slice(from, to).trim();
		if ( !word ) { return }
		lastSearch = {pattern: `\\b${escapeRegExp(word)}\\b`, backward: key === "#"};
		searchMove(editor, model, i, lastSearch.pattern, lastSearch.backward, count);
		return;
	}
	// scrolling
	case "<C-d>":
	case "<C-u>": {
		const lines = Math.max(1, Math.floor(editor.closest(".pane-scroll").clientHeight / 2 / lineHeightOf(editor)));
		const selection = window.getSelection();
		for ( let n = 0; n < lines; n++ ) { selection.modify("move", key === "<C-d>" ? "forward" : "backward", "line") }
		rememberSelection();
		scrollCaret(editor, "center");
		return;
	}
	case "z": {
		const where = r.next();
		scrollCaret(editor, {z: "center", t: "start", b: "end", Enter: "start", ".": "center", "-": "end"}[where] || "center");
		return;
	}
	case "gi": enterInsert(model, i); return;
	// windows (editors side by side) and tabs
	case "<C-w>": {
		const command = r.next().replace(/^<C-(.)>$/, "$1");
		const directions = {h: "left", j: "down", k: "up", l: "right", ArrowLeft: "left", ArrowDown: "down", ArrowUp: "up", ArrowRight: "right"};
		if ( command === "Escape" ) { return }
		if ( directions[command] ) { focusEditorTowards(editor, directions[command], count) }
		else if ( command === "w" || command === "W" ) { focusNextEditor(editor, command === "w" ? count : -count) }
		else if ( ["s", "S", "v"].includes(command) ) { splitEditor() }
		else if ( command === "q" || command === "c" ) { closeEditorWindow(editor) }
		else { return unknown }
		return;
	}
	case "gt":
	case "gT": goToTab(key === "gT" ? -count : count1 ? count1 : 1, key === "gt" && count1 > 0); return;
	case "gJ": joinLines(editor, model, i, Math.max(count, 2), false); changed(); return {change: true, count: count1, keys: ["g", "J"]};
	default: return unknown;
	}
	if ( changeCommands.has(key) ) { return {change: true, count: count1, keys: keysAfterCount()} }
}

function runOperator(editor, model, i, op, count1, r, keysAfterCount, wholeLine=false){
	const text = model.text;
	const count2 = r.count();
	const count = (count1 || 1) * (count2 || 1);
	let from, to, linewise = false;
	let key = wholeLine ? op : r.next();
	if ( key === "Escape" ) { return }
	if ( key === "g" && op.startsWith("g") ) {
		key = "g" + r.next();
	}
	if ( key === op || key === op.slice(-1) || (op.startsWith("g") && key === op) ) {
		// dd, cc, yy, >>, <<, g~~, guu, gUU: count lines from here
		from = lineStart(text, i);
		const last = lineStartOfNumber(text, lineNumber(text, i) + count - 1);
		to = lineEnd(text, last);
		linewise = true;
	} else if ( key === "i" || key === "a" ) {
		const kind = r.next();
		if ( kind === "Escape" ) { return }
		if ( !textObjectKinds.has(kind) ) { return unknown }
		const object = textObject(text, i, key === "a", kind);
		if ( !object ) { return }
		[from, to] = object;
	} else {
		const motion = parseMotion(key, r);
		if ( !motion ) { return motion === null && !["f", "F", "t", "T"].includes(key) ? unknown : undefined }
		const target = evalMotion(editor, model, i, motion, count2 || count1 ? count : null, true);
		if ( target === null ) { return }
		linewise = target.linewise;
		if ( linewise ) {
			from = lineStart(text, Math.min(i, target.index));
			to = lineEnd(text, Math.max(i, target.index));
		} else {
			from = Math.min(i, target.index);
			to = Math.max(i, target.index) + (target.inclusive ? 1 : 0);
			to = Math.min(to, text.length);
			// dw on the last word of a line stops at the line end, cw works like ce
			if ( motion.key === "w" || motion.key === "W" ) {
				if ( op === "c" && !isSpace(text[i]) ) {
					const end = evalMotion(editor, model, i, {key: motion.key === "w" ? "e" : "E"}, count, true);
					to = end.index + 1;
				} else if ( to > lineEnd(text, i) && i < lineEnd(text, i) ) {
					to = lineEnd(text, i);
				}
			}
		}
	}
	applyOperator(editor, model, op, from, to, linewise, i);
	const change = op !== "y";
	return change ? {change: true, count: count1, keys: keysAfterCount()} : undefined;
}

function applyOperator(editor, model, op, from, to, linewise, cursor){
	const text = model.text;
	switch ( op ) {
	case "y":
		yank(text.slice(from, to), linewise);
		// the cursor goes to the start of what was yanked, yy and yj leave it where it is
		setCaret(model, linewise && lineStart(text, cursor) === from ? cursor : from);
		flashRange(model, from, to);
		return;
	case "d":
		yank(text.slice(from, to), linewise);
		if ( linewise ) {
			deleteLines(editor, model, from, to);
		} else {
			deleteRange(model, from, to);
			clampCaret(editor);
		}
		changed();
		return;
	case "c":
		yank(text.slice(from, to), linewise);
		if ( linewise ) {
			// keeps the line (and its indent), only its text goes
			const start = firstNonBlank(text, from);
			deleteRange(model, start, to);
			enterInsert(textModel(editor), start);
		} else {
			deleteRange(model, from, to);
			enterInsert(textModel(editor), from);
		}
		changed();
		return;
	case ">":
	case "<":
		indentLines(editor, model, from, to, op === ">");
		changed();
		return;
	default:
		if ( caseOperators[op] ) {
			replacePerLine(editor, from, to, {toggle: toggleCase, lower: (s) => s.toLowerCase(), upper: (s) => s.toUpperCase()}[caseOperators[op]]);
			setCaret(textModel(editor), from);
			changed();
		}
	}
}

function deleteLines(editor, model, from, to){
	const text = model.text;
	if ( from > 0 ) {
		// from the end of the line above, so the line above keeps its block (a heading stays a heading)
		deleteRange(model, from - 1, to);
		const after = textModel(editor);
		setCaret(after, from < after.text.length ? firstNonBlank(after.text, from) : firstNonBlank(after.text, Math.max(0, from - 1)));
	} else if ( to < text.length ) {
		deleteRange(model, from, to + 1);
		setCaret(textModel(editor), firstNonBlank(textModel(editor).text, 0));
	} else {
		deleteRange(model, from, to);
		setCaret(textModel(editor), 0);
	}
}

function indentLines(editor, model, from, to, indent){
	const text = model.text;
	const starts = [];
	for ( let s = lineStart(text, from); s <= to; s = lineEnd(text, s) + 1 ) {
		starts.push(s);
		if ( lineEnd(text, s) >= text.length ) { break }
	}
	const size = typeof indentSize === "number" ? indentSize : 4;
	// from the last line up, so the indexes above stay valid
	for ( const s of starts.reverse() ) {
		const current = textModel(editor);
		const position = positionAt(current, s);
		const li = elementOf(position.node).closest("li");
		if ( li && editor.contains(li) ) {
			setCaret(current, s);
			const move = () => {
				if ( !indent && typeof unnestCaretList === "function" ) { unnestCaretList(editor) } // folding.js
				exec(indent ? "indent" : "outdent");
			};
			typeof keepTaskItemState === "function" ? keepTaskItemState(move) : move(); // checklist.js
			continue
		}
		if ( indent ) {
			if ( isEmptyLine(current.text, s) ) { continue }
			setCaret(current, s);
			exec("insertText", " ".repeat(size));
		} else {
			let end = s;
			while ( end < s + size && isBlank(current.text[end]) ) { end++ }
			deleteRange(current, s, end);
		}
	}
	const after = textModel(editor);
	setCaret(after, firstNonBlank(after.text, Math.min(from, after.text.length)));
}

function joinLines(editor, model, i, count, withSpace=true){
	for ( let n = 1; n < count; n++ ) {
		const current = n === 1 ? model : textModel(editor);
		const text = current.text;
		const end = lineEnd(text, i);
		if ( end >= text.length ) { break }
		let next = end + 1;
		if ( withSpace ) { while ( next < text.length && isBlank(text[next]) ) { next++ } }
		const needsSpace = withSpace && end > lineStart(text, i) && !isBlank(text[end - 1]) && text[next] !== "\n" && next < text.length && text[next] !== ")";
		selectRange(current, end, next);
		if ( needsSpace ) { exec("insertText", " ") } else { exec("delete") }
		setCaret(textModel(editor), end);
	}
}

function openLine(editor, model, i, above){
	const text = model.text;
	// a new line next to a checklist item is an unchecked checklist item (checklist.js)
	const insertParagraph = () => typeof withNewTaskItemsUnchecked === "function"
		? withNewTaskItemsUnchecked(editor, () => exec("insertParagraph"))
		: exec("insertParagraph");
	if ( above && lineStart(text, i) === 0 ) {
		setCaret(model, 0);
		insertParagraph();
		window.getSelection().modify("move", "backward", "character");
		rememberSelection();
	} else {
		setCaret(model, above ? lineStart(text, i) - 1 : lineEnd(text, i));
		insertParagraph();
		rememberSelection();
	}
	setMode("insert");
	changed();
}

function put(editor, model, i, before, count){
	if ( !register.text && !register.linewise ) { return }
	const text = model.text;
	const lines = Array(count).fill(register.text).join(register.linewise ? "\n" : "").split("\n");
	if ( register.linewise ) {
		const start = lineStart(text, i);
		if ( before && start === 0 ) {
			setCaret(model, 0);
			lines.forEach((line) => {
				if ( line ) { exec("insertText", line) }
				exec("insertParagraph");
			});
			const after = textModel(editor);
			setCaret(after, firstNonBlank(after.text, 0));
			return
		}
		const at = before ? start - 1 : lineEnd(text, i);
		setCaret(model, at);
		for ( const line of lines ) {
			exec("insertParagraph");
			if ( line ) { exec("insertText", line) }
		}
		const after = textModel(editor);
		setCaret(after, firstNonBlank(after.text, at + 1));
		return
	}
	const at = before || text[i] === undefined || text[i] === "\n" ? i : i + 1;
	setCaret(model, at);
	insertLines(lines);
	const length = lines.join("\n").length;
	setCaret(textModel(editor), Math.max(at, at + length - 1));
}

function replacePerLine(editor, from, to, transform){
	// line by line from the end, so each block keeps its element
	const text = textModel(editor).text;
	const parts = [];
	for ( let s = from; s < to; ) {
		const end = Math.min(lineEnd(text, s), to);
		if ( end > s ) { parts.push([s, end]) }
		s = end + 1;
	}
	for ( const [s, e] of parts.reverse() ) {
		const model = textModel(editor);
		const original = model.text.slice(s, e);
		const replaced = transform(original);
		if ( replaced === original ) { continue }
		selectRange(model, s, e);
		exec("insertText", replaced);
	}
}

function toggleCase(s){
	return [...s].map(c => c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()).join("");
}

function replaceChar(editor, char){
	// REPLACE: overwrites the character under the caret, appends at the line end
	const model = textModel(editor);
	const i = caretIndex(model);
	if ( i === null ) { return }
	if ( model.text[i] !== undefined && model.text[i] !== "\n" ) { selectRange(model, i, i + 1) }
	exec("insertText", char);
	if ( recording ) { recording.text = (recording.text || "") + char }
	changed();
}

function yank(text, linewise){
	register = {text, linewise};
}

function flashRange(model, from, to){
	// a short highlight of what was yanked, like Neovim's vim.highlight.on_yank
	if ( to <= from ) { return }
	const a = positionAt(model, from);
	const b = positionAt(model, to);
	const range = document.createRange();
	range.setStart(a.node, a.offset);
	range.setEnd(b.node, b.offset);
	const flashes = [...range.getClientRects()].map((rect) => {
		const el = document.createElement("div");
		el.className = "vi-cursor";
		Object.assign(el.style, {display: "block", left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`, transition: "opacity .3s", opacity: ".8"});
		ui.root.appendChild(el);
		return el;
	});
	setTimeout(() => flashes.forEach((el) => { el.style.opacity = "0" }), 150);
	setTimeout(() => flashes.forEach((el) => el.remove()), 500);
}

function enterInsert(model, index){
	setCaret(model, index);
	setMode("insert");
}

function leaveInsert(editor){
	// 3iab<Esc> inserts ab three times
	if ( recording && !replaying && recording.count > 1 && insertRepeats(recording) && recording.text ) {
		insertAgain(editor, recording, recording.count - 1);
		changed();
	}
	// like Vim, the cursor steps back onto the last typed character
	if ( recording ) { recording = null }
	setMode("normal");
	const model = textModel(editor);
	const i = caretIndex(model);
	if ( i !== null && i > lineStart(model.text, i) ) { setCaret(model, i - 1) }
	render();
}

function insertRepeats(change){
	// the commands where a count repeats the inserted text (3ihi, 3ohi), not 3s or 3cw
	return change.keys.length === 1 && ["i", "a", "I", "A", "o", "O"].includes(change.keys[0]);
}

function insertAgain(editor, change, times){
	// after the text inserted once: o / O add it as new lines (checklist items unchecked, checklist.js)
	const newLine = change.keys[0] === "o" || change.keys[0] === "O";
	for ( let n = 0; n < times; n++ ) {
		if ( newLine ) {
			typeof withNewTaskItemsUnchecked === "function" ? withNewTaskItemsUnchecked(editor, () => exec("insertParagraph")) : exec("insertParagraph");
		}
		insertLines(change.text.split("\n"));
	}
}

function clampCaret(editor){
	// NORMAL keeps the cursor on a character, not after the last one
	const model = textModel(editor);
	const i = caretIndex(model);
	if ( i === null ) { return }
	const end = lineEnd(model.text, i);
	if ( i === end && end > lineStart(model.text, i) ) { setCaret(model, end - 1) } else { rememberSelection() }
}

function recordInput(e){
	if ( e.inputType === "insertText" && e.data ) {
		recording.text = (recording.text || "") + e.data;
	} else if ( e.inputType === "insertParagraph" || e.inputType === "insertLineBreak" ) {
		recording.text = (recording.text || "") + "\n";
	} else if ( e.inputType === "deleteContentBackward" ) {
		recording.text = (recording.text || "").slice(0, -1);
	} else if ( e.inputType === "deleteWordBackward" ) {
		recording.text = (recording.text || "").replace(/\S*\s*$/, "");
	} else if ( ["insertFromPaste", "insertFromDrop", "insertReplacementText"].includes(e.inputType) ) {
		// contenteditable has the text in dataTransfer, not in data
		const text = e.data ?? e.dataTransfer?.getData("text/plain") ?? "";
		recording.text = (recording.text || "") + text.replace(/\r\n?/g, "\n");
	} else if ( e.inputType === "insertCompositionText" ) {
		// recorded on compositionend
	}
}
document.addEventListener("compositionend", (e) => {
	if ( enabled && recording && !replaying && (mode === "insert" || mode === "replace") && e.data ) {
		recording.text = (recording.text || "") + e.data;
	}
});

function repeatLastChange(editor, count){
	if ( !lastChange ) { return }
	const change = lastChange;
	const digits = (n) => n ? String(n).split("") : [];
	replaying = true;
	try {
		pending = [];
		if ( change.visual ) {
			// a VISUAL change: as many lines or characters from the cursor, the count stays the change's
			const model = textModel(editor);
			const text = model.text;
			const i = caretIndex(model) ?? 0;
			visualAnchor = i;
			visualHead = change.visual.lines
				? lineStartOfNumber(text, Math.min(lineNumber(text, i) + change.visual.lines - 1, lineCount(text) - 1))
				: Math.min(i + change.visual.chars - 1, Math.max(text.length - 1, 0));
			setMode(change.visual.lines ? "vline" : "visual");
			for ( const key of [...digits(change.count), ...change.keys] ) { handleKey(key, editor) }
		} else {
			for ( const key of [...digits(count || change.count), ...change.keys] ) { handleKey(key, editor) }
		}
		if ( mode === "insert" || mode === "replace" ) {
			if ( change.text ) {
				if ( mode === "replace" ) {
					for ( const char of change.text ) { replaceChar(editor, char) }
				} else {
					insertLines(change.text.split("\n"));
					const times = insertRepeats(change) ? count || change.count || 1 : 1;
					if ( times > 1 ) { insertAgain(editor, change, times - 1) }
				}
			}
			leaveInsert(editor);
		}
	} finally {
		replaying = false;
	}
	changed();
}


// motions
function parseMotion(key, r){
	switch ( key ) {
	case "h": case "j": case "k": case "l": case "w": case "W": case "b": case "B": case "e": case "E":
	case "0": case "^": case "$": case "G": case "{": case "}": case "%": case ";": case ",": case "_":
	case "ArrowLeft": case "ArrowRight": case "ArrowUp": case "ArrowDown": case "Home": case "End":
	case "Backspace": case " ": case "Enter": case "+": case "-": case "|":
	case "gg": case "ge": case "gE": case "gj": case "gk": case "g0": case "g$": case "g_":
		return {key};
	case "f": case "F": case "t": case "T": {
		const char = r.next();
		if ( char === "Escape" || char.length !== 1 ) { return null }
		return {key, char};
	}
	case "g": return parseMotion("g" + r.next(), r);
	default: return null;
	}
}

const browserMotions = {
	h: ["backward", "character"], ArrowLeft: ["backward", "character"], Backspace: ["backward", "character"],
	l: ["forward", "character"], ArrowRight: ["forward", "character"], " ": ["forward", "character"],
	j: ["forward", "line"], ArrowDown: ["forward", "line"], gj: ["forward", "line"],
	k: ["backward", "line"], ArrowUp: ["backward", "line"], gk: ["backward", "line"],
	g0: ["backward", "lineboundary"], Home: ["backward", "lineboundary"],
	"g$": ["forward", "lineboundary"], End: ["forward", "lineboundary"],
};

function moveCaret(editor, model, i, motion, count){
	const browser = browserMotions[motion.key];
	if ( browser ) {
		// exactly like the arrow keys: wrapped lines, the remembered column, crossing to the next line
		const selection = window.getSelection();
		if ( !selection.isCollapsed ) { selection.collapseToEnd() }
		for ( let n = 0; n < (count || 1); n++ ) { selection.modify("move", ...browser) }
		if ( motion.key === "g$" || motion.key === "End" ) { clampCaret(editor) } else { rememberSelection() }
		scrollCaret(editor);
		return
	}
	const target = evalMotion(editor, model, i, motion, count, false);
	if ( target === null ) { return }
	setCaret(model, target.index);
	scrollCaret(editor);
}

function evalMotion(editor, model, i, motion, count, forOperator){
	// {index, linewise, inclusive} of the motion's target in the text, null when it can't move
	const text = model.text;
	const n = count || 1;
	const key = motion.key;
	if ( browserMotions[key] && !forOperator ) {
		const target = browserTarget(model, i, browserMotions[key], n);
		return {index: target};
	}
	switch ( key ) {
	case "h": case "ArrowLeft": case "Backspace":
		return {index: Math.max(lineStart(text, i), i - n)};
	case "l": case "ArrowRight": case " ":
		return {index: Math.min(lineEnd(text, i), i + n)};
	case "j": case "ArrowDown": case "gj": case "+": case "Enter": case "_": {
		const steps = key === "_" ? n - 1 : n;
		const line = Math.min(lineNumber(text, i) + steps, lineCount(text) - 1);
		if ( forOperator && line === lineNumber(text, i) && steps ) { return null }
		return {index: firstNonBlank(text, lineStartOfNumber(text, line)), linewise: true};
	}
	case "k": case "ArrowUp": case "gk": case "-": {
		const line = lineNumber(text, i) - n;
		if ( line < 0 ) { return null }
		return {index: firstNonBlank(text, lineStartOfNumber(text, line)), linewise: true};
	}
	case "0": case "Home": case "g0": return {index: lineStart(text, i)};
	case "^": return {index: firstNonBlank(text, i)};
	case "|": return {index: Math.min(lineStart(text, i) + n - 1, lineEnd(text, i))};
	case "$": case "End": case "g$": {
		const line = lineStartOfNumber(text, lineNumber(text, i) + n - 1);
		return forOperator ? {index: lineEnd(text, line)} : {index: lastCharOfLine(text, line), inclusive: true};
	}
	case "g_": {
		let end = lineEnd(text, lineStartOfNumber(text, lineNumber(text, i) + n - 1)) - 1;
		while ( end > lineStart(text, i) && isBlank(text[end]) ) { end-- }
		return {index: Math.max(end, lineStart(text, i)), inclusive: true};
	}
	case "gg": case "G": {
		const line = count ? Math.min(count, lineCount(text)) - 1 : key === "gg" ? 0 : lineCount(text) - 1;
		return {index: firstNonBlank(text, lineStartOfNumber(text, line)), linewise: true};
	}
	case "w": case "W": {
		let j = i;
		for ( let s = 0; s < n; s++ ) { j = nextWordStart(text, j, key === "W") }
		return {index: j};
	}
	case "e": case "E": {
		let j = i;
		for ( let s = 0; s < n; s++ ) { j = nextWordEnd(text, j, key === "E") }
		return {index: j, inclusive: true};
	}
	case "b": case "B": {
		let j = i;
		for ( let s = 0; s < n; s++ ) { j = prevWordStart(text, j, key === "B") }
		return {index: j};
	}
	case "ge": case "gE": {
		let j = i;
		for ( let s = 0; s < n; s++ ) { j = prevWordEnd(text, j, key === "gE") }
		return {index: j, inclusive: true};
	}
	case "{": case "}": {
		let j = i;
		for ( let s = 0; s < n; s++ ) { j = key === "}" ? nextParagraph(text, j) : prevParagraph(text, j) }
		return {index: j};
	}
	case "%": {
		const match = matchBracket(text, i);
		return match === null ? null : {index: match, inclusive: true};
	}
	case "f": case "F": case "t": case "T":
		lastFind = motion;
		return findInLine(text, i, motion.key, motion.char, n, false);
	case ";": case ",": {
		if ( !lastFind ) { return null }
		const reverse = {f: "F", F: "f", t: "T", T: "t"};
		return findInLine(text, i, key === ";" ? lastFind.key : reverse[lastFind.key], lastFind.char, n, true);
	}
	default: return null;
	}
}

function browserTarget(model, i, [direction, granularity], count){
	// runs a browser motion from index i on a collapsed selection and reads where it lands
	setCaret(model, i);
	const selection = window.getSelection();
	for ( let n = 0; n < count; n++ ) { selection.modify("move", direction, granularity) }
	return indexAt(model, selection.focusNode, selection.focusOffset) ?? i;
}

function findInLine(text, i, key, char, count, repeat){
	const start = lineStart(text, i);
	const end = lineEnd(text, i);
	let j = i;
	for ( let n = 0; n < count; n++ ) {
		if ( key === "f" || key === "t" ) {
			// ; after t starts past the character it stopped before
			let from = j + 1 + (key === "t" && repeat && n === 0 && text[j + 1] === char ? 1 : 0);
			const found = text.indexOf(char, from);
			if ( found === -1 || found >= end ) { return null }
			j = found;
		} else {
			let from = j - 1 - (key === "T" && repeat && n === 0 && text[j - 1] === char ? 1 : 0);
			const found = from < 0 ? -1 : text.lastIndexOf(char, from);
			if ( found < start ) { return null }
			j = found;
		}
	}
	if ( key === "t" ) { return {index: j - 1, inclusive: true} }
	if ( key === "T" ) { return {index: j + 1} }
	return {index: j, inclusive: key === "f"};
}

function nextWordStart(text, i, bigWord){
	const length = text.length;
	if ( i >= length ) { return length }
	const cls = charClass(text[i], bigWord);
	let j = i;
	if ( cls !== 0 ) { while ( j < length && charClass(text[j], bigWord) === cls ) { j++ } }
	// an empty line counts as a word
	while ( j < length && isSpace(text[j]) ) {
		if ( text[j] === "\n" && text[j + 1] === "\n" ) { return j + 1 }
		j++;
	}
	return j;
}

function nextWordEnd(text, i, bigWord){
	const length = text.length;
	let j = i + 1;
	while ( j < length && isSpace(text[j]) ) { j++ }
	if ( j >= length ) { return Math.max(0, length - 1) }
	const cls = charClass(text[j], bigWord);
	while ( j + 1 < length && charClass(text[j + 1], bigWord) === cls ) { j++ }
	return j;
}

function prevWordStart(text, i, bigWord){
	let j = i - 1;
	while ( j > 0 && isSpace(text[j]) ) {
		if ( text[j] === "\n" && text[j - 1] === "\n" ) { return j }
		j--;
	}
	if ( j <= 0 ) { return 0 }
	const cls = charClass(text[j], bigWord);
	while ( j > 0 && charClass(text[j - 1], bigWord) === cls ) { j-- }
	return j;
}

function prevWordEnd(text, i, bigWord){
	const cls = charClass(text[i], bigWord);
	let j = i;
	if ( cls !== 0 ) { while ( j > 0 && charClass(text[j], bigWord) === cls ) { j-- } }
	while ( j > 0 && isSpace(text[j]) ) { j-- }
	return Math.max(0, j);
}

function nextParagraph(text, i){
	let j = lineEnd(text, i);
	while ( j < text.length && isEmptyLine(text, j + 1) ) { j = lineEnd(text, j + 1) }
	while ( j < text.length ) {
		const next = j + 1;
		if ( isEmptyLine(text, next) ) { return next }
		j = lineEnd(text, next);
	}
	return text.length;
}

function prevParagraph(text, i){
	let j = lineStart(text, i);
	while ( j > 0 && isEmptyLine(text, j - 1) ) { j = lineStart(text, j - 1) }
	while ( j > 0 ) {
		const previous = lineStart(text, j - 1);
		if ( isEmptyLine(text, previous) ) { return previous }
		j = previous;
	}
	return 0;
}

function matchBracket(text, i){
	// from the cursor to the first bracket on the line, then to its pair
	let j = i;
	const end = lineEnd(text, i);
	while ( j < end && !brackets[text[j]] && !closingBrackets[text[j]] ) { j++ }
	if ( j >= end ) { return null }
	const char = text[j];
	const forward = !!brackets[char];
	const pair = forward ? brackets[char] : closingBrackets[char];
	let depth = 0;
	for ( let k = j; forward ? k < text.length : k >= 0; k += forward ? 1 : -1 ) {
		if ( text[k] === char ) { depth++ }
		else if ( text[k] === pair && --depth === 0 ) { return k }
	}
	return null;
}


// text objects: iw aw iW aW i" a" i' a' i` a` i( a( ib i[ i{ iB i< ...
function textObject(text, i, around, kind){
	if ( kind === "w" || kind === "W" ) { return wordObject(text, i, around, kind === "W") }
	if ( kind === "\"" || kind === "'" || kind === "`" ) { return quoteObject(text, i, around, kind) }
	const open = {b: "(", "(": "(", ")": "(", "[": "[", "]": "[", B: "{", "{": "{", "}": "{", "<": "<", ">": "<"}[kind];
	if ( open ) { return bracketObject(text, i, around, open) }
	if ( kind === "p" ) { return paragraphObject(text, i, around) }
	return null;
}

function wordObject(text, i, around, bigWord){
	const start = lineStart(text, i);
	const end = lineEnd(text, i);
	if ( i >= end ) { return [i, i] }
	const cls = charClass(text[i], bigWord);
	let from = i;
	let to = i + 1;
	while ( from > start && charClass(text[from - 1], bigWord) === cls ) { from-- }
	while ( to < end && charClass(text[to], bigWord) === cls ) { to++ }
	if ( around ) {
		if ( cls !== 0 && to < end && isBlank(text[to]) ) {
			while ( to < end && isBlank(text[to]) ) { to++ }
		} else if ( cls !== 0 ) {
			while ( from > start && isBlank(text[from - 1]) ) { from-- }
		} else {
			const c = charClass(text[to], bigWord);
			while ( to < end && c !== 0 && charClass(text[to], bigWord) === c ) { to++ }
		}
	}
	return [from, to];
}

function quoteObject(text, i, around, quote){
	const start = lineStart(text, i);
	const end = lineEnd(text, i);
	const quotes = [];
	for ( let j = start; j < end; j++ ) { if ( text[j] === quote && text[j - 1] !== "\\" ) { quotes.push(j) } }
	for ( let q = 0; q + 1 < quotes.length; q += 2 ) {
		const [open, close] = [quotes[q], quotes[q + 1]];
		if ( i <= close ) {
			if ( around ) {
				let to = close + 1;
				while ( to < end && isBlank(text[to]) ) { to++ }
				return [open, to];
			}
			return [open + 1, close];
		}
	}
	return null;
}

function bracketObject(text, i, around, open){
	const close = brackets[open];
	let depth = 0;
	let from = -1;
	for ( let j = text[i] === close ? i - 1 : i; j >= 0; j-- ) {
		if ( text[j] === close ) { depth++ }
		else if ( text[j] === open ) {
			if ( depth === 0 ) { from = j; break }
			depth--;
		}
	}
	if ( from === -1 ) { return null }
	depth = 0;
	for ( let j = from + 1; j < text.length; j++ ) {
		if ( text[j] === open ) { depth++ }
		else if ( text[j] === close ) {
			if ( depth === 0 ) { return around ? [from, j + 1] : [from + 1, j] }
			depth--;
		}
	}
	return null;
}

function paragraphObject(text, i, around){
	const empty = isEmptyLine(text, i);
	let from = lineStart(text, i);
	let to = lineEnd(text, i);
	while ( from > 0 && isEmptyLine(text, from - 1) === empty ) { from = lineStart(text, from - 1) }
	while ( to < text.length && isEmptyLine(text, to + 1) === empty ) { to = lineEnd(text, to + 1) }
	if ( around ) { while ( to < text.length && isEmptyLine(text, to + 1) !== empty ) { to = lineEnd(text, to + 1) } }
	return [from, to];
}


// VISUAL / V-LINE
function visualRange(text){
	const from = Math.min(visualAnchor, visualHead);
	const to = Math.max(visualAnchor, visualHead);
	if ( mode === "vline" ) { return [lineStart(text, from), lineEnd(text, to), true] }
	return [from, Math.min(to + 1, text.length), false];
}

function renderVisual(editor){
	const model = textModel(editor);
	const [from, to] = visualRange(model.text);
	// the selection runs from the anchor to the head, so the browser scrolls to the head
	if ( visualHead >= visualAnchor ) { selectRange(model, from, to) } else { selectRange(model, to, from) }
}

function runVisual(editor, keys){
	const r = reader(keys);
	const count1 = r.count();
	const start = r.position;
	let key = r.next();
	const count = count1 || 1;
	const model = textModel(editor);
	const text = model.text;
	const [from, to, linewise] = visualRange(text);
	// "." repeats it on as much text from its cursor: as many lines, or characters
	const change = () => ({change: true, count: count1, keys: keys.slice(start),
		visual: linewise ? {lines: lineNumber(text, to) - lineNumber(text, from) + 1} : {chars: to - from}});
	const leave = (index) => {
		setMode("normal");
		setCaret(textModel(editor), index);
		clampCaret(editor);
	};

	if ( key === "Escape" || (key === "v" && mode === "visual") || (key === "V" && mode === "vline") ) {
		leave(visualHead);
		return
	}
	if ( key === "v" || key === "V" ) {
		setMode(key === "v" ? "visual" : "vline");
		renderVisual(editor);
		return
	}
	if ( key === "g" ) {
		key = "g" + r.next();
	}
	if ( key === "i" || key === "a" ) {
		const object = textObject(text, visualHead, key === "a", r.next());
		if ( object && object[1] > object[0] ) {
			visualAnchor = Math.min(object[0], visualAnchor);
			visualHead = object[1] - 1;
			renderVisual(editor);
		}
		return
	}
	const motion = parseMotion(key, r);
	if ( !motion && ["f", "F", "t", "T"].includes(key) ) { return }   // f<Esc>
	if ( motion ) {
		const target = evalMotion(editor, model, visualHead, motion, count1, false);
		if ( target ) { visualHead = Math.min(target.index, Math.max(text.length - 1, 0)) }
		renderVisual(editor);
		scrollCaret(editor);
		return
	}
	switch ( key ) {
	case "o":
		[visualAnchor, visualHead] = [visualHead, visualAnchor];
		renderVisual(editor);
		return;
	case "y":
		setMode("normal");
		applyOperator(editor, model, "y", from, to, linewise, from);
		return;
	case "d": case "x": case "Delete":
		setMode("normal");
		applyOperator(editor, model, "d", from, to, linewise, from);
		return change();
	case "D": case "X":
		setMode("normal");
		applyOperator(editor, model, "d", lineStart(text, from), lineEnd(text, to - (linewise ? 0 : 1)), true, from);
		return change();
	case "c": case "s":
		applyOperator(editor, model, "c", from, to, linewise, from);
		return change();
	case "C": case "S": case "R":
		applyOperator(editor, model, "c", lineStart(text, from), lineEnd(text, Math.max(from, to - 1)), true, from);
		return change();
	case ">": case "<":
		setMode("normal");
		for ( let n = 0; n < count; n++ ) { indentLines(editor, textModel(editor), from, to, key === ">") }
		changed();
		return change();
	case "~": case "u": case "U": case "g~": case "gu": case "gU":
		setMode("normal");
		applyOperator(editor, model, {"~": "g~", u: "gu", U: "gU"}[key] || key, from, to, false, from);
		return change();
	case "J": case "gJ":
		setMode("normal");
		joinLines(editor, model, from, Math.max(2, lineNumber(text, to) - lineNumber(text, from) + 1), key === "J");
		changed();
		return change();
	case "r": {
		const char = r.next();
		setMode("normal");
		if ( char.length !== 1 ) { leave(from); return }
		replacePerLine(editor, from, to, (s) => char.repeat([...s].length));
		setCaret(textModel(editor), from);
		changed();
		return change();
	}
	case "p": case "P": {
		const replaced = {text: text.slice(from, to), linewise};
		const pasted = register;
		setMode("normal");
		if ( linewise ) {
			deleteLines(editor, model, from, to);
			const after = textModel(editor);
			const at = Math.min(from, after.text.length);
			register = pasted;
			put(editor, after, at, from < after.text.length || !after.text, count);
		} else {
			deleteRange(model, from, to);
			register = pasted;
			const after = textModel(editor);
			if ( pasted.linewise ) {
				setCaret(after, from);
				exec("insertParagraph");
				insertLines(pasted.text.split("\n"));
			} else {
				setCaret(after, from);
				insertLines(pasted.text.split("\n"));
			}
		}
		if ( key === "p" ) { register = replaced }
		changed();
		return change();
	}
	case "I":
		setMode("normal");
		enterInsert(textModel(editor), linewise ? firstNonBlank(text, from) : from);
		return change();
	case "A":
		setMode("normal");
		enterInsert(textModel(editor), linewise ? lineEnd(text, to) : to);
		return change();
	case ":":
		openCommandLine(editor, ":", "'<,'>", [lineStart(text, from), lineEnd(text, Math.max(from, to - 1))]);
		return;
	case "*": case "#": {
		const word = text.slice(from, to);
		if ( !word.trim() ) { return }
		lastSearch = {pattern: escapeRegExp(word), backward: key === "#"};
		setMode("normal");
		searchMove(editor, textModel(editor), from, lastSearch.pattern, lastSearch.backward, count);
		return;
	}
	default:
		return unknown;
	}
}


// command line ( : / ? )
function openCommandLine(editor, kind, value="", visual=null){
	const model = textModel(editor);
	commandLine = {editor, kind, index: mode === "visual" || mode === "vline" ? Math.min(visualAnchor, visualHead) : caretIndex(model) ?? 0, previousMode: mode, visual};
	setMode("command");
	ui.indicator.querySelector(".vi-mode-prefix").textContent = kind;
	const input = ui.indicator.querySelector("input");
	input.value = value;
	input.focus();
}

function closeCommandLine(restoreCaret=true){
	if ( !commandLine ) { return }
	const {editor, index} = commandLine;
	commandLine = null;
	hideCompletions();
	setMode("normal");
	if ( !enabled ) { return }
	editor.focus({preventScroll: true});
	if ( restoreCaret ) {
		const model = textModel(editor);
		setCaret(model, Math.min(index, model.text.length));
		clampCaret(editor);
	}
	render();
}

function onCommandLineKeydown(e){
	const input = e.target;
	if ( e.key === "Escape" || (e.ctrlKey && e.key === "[") || (e.key === "Backspace" && !input.value) ) {
		e.preventDefault();
		closeCommandLine(true);
		return
	}
	// Tab would move the focus out and close the command line
	if ( e.key === "Tab" || (completions && (e.key === "ArrowDown" || e.key === "ArrowUp")) ) {
		e.preventDefault();
		if ( completions ) { selectCompletion(e.key === "ArrowUp" || (e.key === "Tab" && e.shiftKey) ? -1 : 1) }
		return
	}
	if ( e.key !== "Enter" ) { return }
	e.preventDefault();
	const {editor, kind, visual} = commandLine;
	const value = input.value;
	closeCommandLine(true);
	if ( kind === ":" ) {
		runExCommand(editor, value, visual);
	} else if ( value ) {
		lastSearch = {pattern: value, backward: kind === "?"};
		const model = textModel(editor);
		searchMove(editor, model, caretIndex(model) ?? 0, value, kind === "?", 1);
	} else if ( lastSearch ) {
		lastSearch.backward = kind === "?";
		const model = textModel(editor);
		searchMove(editor, model, caretIndex(model) ?? 0, lastSearch.pattern, lastSearch.backward, 1);
	}
	render();
}

// :e name completion: after the first character of the name, the documents with it in their name
let completions = null;                 // {command, names, selected}

function updateCompletions(){
	const match = commandLine?.kind === ":" && ui.indicator.querySelector("input").value.match(/^\s*(e|edit|tabe|tabedit|tabnew)\s+(.*\S)\s*$/);
	if ( !match ) { hideCompletions(); return }
	const query = match[2].toLowerCase();
	const names = (getDocumentNamesFromLocalStorage() || []).filter(name => name.toLowerCase().includes(query));
	const starts = (name) => name.toLowerCase().startsWith(query);
	names.sort((a, b) => starts(b) - starts(a) || a.localeCompare(b));
	completions = {command: match[1], names, selected: -1};
	renderCompletions(query);
}

function renderCompletions(query){
	const list = ui.completions;
	list.replaceChildren();
	if ( !completions.names.length ) {
		const empty = document.createElement("li");
		empty.className = "vi-complete-empty";
		empty.textContent = "No matching documents";
		list.append(empty);
	}
	for ( const [i, name] of completions.names.entries() ) {
		const item = document.createElement("li");
		item.setAttribute("role", "option");
		item.dataset.index = i;
		item.title = name;
		const at = name.toLowerCase().indexOf(query);
		const mark = document.createElement("mark");
		mark.textContent = name.slice(at, at + query.length);
		item.append(name.slice(0, at), mark, name.slice(at + query.length));
		list.append(item);
	}
	list.hidden = false;
	const bar = ui.bar.getBoundingClientRect();
	list.style.top = `${Math.round(bar.bottom + 4)}px`;
	list.style.right = ui.bar.style.right;
	markSelectedCompletion();
}

function hideCompletions(){
	completions = null;
	if ( ui.completions ) { ui.completions.hidden = true }
}

function selectCompletion(step){
	// like the wildmenu: Tab / Down next, Shift+Tab / Up previous, the name goes into the command line
	const count = completions.names.length;
	if ( !count ) { return }
	completions.selected = completions.selected === -1 && step < 0 ? count - 1 : (completions.selected + step + count) % count;
	ui.indicator.querySelector("input").value = `${completions.command} ${completions.names[completions.selected]}`;
	markSelectedCompletion();
}

function markSelectedCompletion(){
	for ( const item of ui.completions.querySelectorAll("li[role=option]") ) {
		const selected = Number(item.dataset.index) === completions.selected;
		item.setAttribute("aria-selected", selected);
		if ( selected ) { item.scrollIntoView({block: "nearest"}) }
	}
}

function onCompletionClick(e){
	const item = e.target.closest("li[role=option]");
	if ( !item || !commandLine ) { return }
	const {editor, visual} = commandLine;
	const value = `${completions.command} ${completions.names[Number(item.dataset.index)]}`;
	closeCommandLine(true);
	runExCommand(editor, value, visual);
	render();
}

function closeAllTabs(force){
	// :qa closes the tabs without unsaved changes, :qa! all of them
	const kept = tabs.filter(t => t.dirty && !force);
	for ( const tab of tabs.filter(t => !kept.includes(t)) ) {
		tab.dirty = false;
		closeTab(tab.id);
	}
	if ( kept.length ) { showMessage(`${kept.length} tab${kept.length > 1 ? "s" : ""} with unsaved changes kept (:qa! closes them)`, "warning") }
}

function runExCommand(editor, value, visual){
	const model = textModel(editor);
	const text = model.text;
	const i = caretIndex(model) ?? 0;
	let command = value.trim();
	// range: % . $ N 'a,'b (only what the commands below need)
	let range = null;
	const rangeMatch = command.match(/^(%|'<,'>|[.$]|\d+)(?:,([.$]|\.?[+-]\d+|\d+))?/);
	if ( rangeMatch && rangeMatch[0] ) {
		const line = (spec) => {
			if ( spec === "." ) { return lineNumber(text, i) }
			if ( spec === "$" ) { return lineCount(text) - 1 }
			const relative = spec.match(/^\.?([+-]\d+)$/);
			if ( relative ) { return lineNumber(text, i) + parseInt(relative[1]) }
			return Math.max(0, parseInt(spec) - 1);
		};
		if ( rangeMatch[1] === "%" ) {
			range = [0, lineCount(text) - 1];
		} else if ( rangeMatch[1] === "'<,'>" && visual ) {
			range = [lineNumber(text, visual[0]), lineNumber(text, visual[1])];
		} else if ( rangeMatch[1] !== "'<,'>" ) {
			range = [line(rangeMatch[1]), rangeMatch[2] ? line(rangeMatch[2]) : line(rangeMatch[1])];
		}
		command = command.slice(rangeMatch[0].length).trim();
	}
	if ( !command ) {
		// :N goes to line N
		if ( range ) { setCaret(model, firstNonBlank(text, lineStartOfNumber(text, Math.min(range[1], lineCount(text) - 1)))); scrollCaret(editor, "center") }
		return
	}
	const substitute = command.match(/^s(?:ubstitute)?([/#|!])(.*)$/);
	if ( substitute ) {
		substituteLines(editor, model, range || [lineNumber(text, i), lineNumber(text, i)], substitute[1], substitute[2]);
		return
	}
	const heading = command.match(/^h(\d+)$/);
	if ( heading ) {
		setHeading(editor, model, range || [lineNumber(text, i), lineNumber(text, i)], parseInt(heading[1]), i);
		return
	}
	const [name, ...args] = command.split(/\s+/);
	const arg = args.join(" ");
	switch ( name ) {
	case "w": case "write": case "w!":
		saveDocumentToLocalStorage();
		return;
	case "q": case "quit": case "q!": case "quit!": case "close":
		closeActiveTab(name.endsWith("!"));
		return;
	case "qa": case "qall": case "qa!": case "qall!": case "quitall": case "quitall!":
		closeAllTabs(name.endsWith("!"));
		return;
	case "wq": case "x": case "xit": case "exit": case "wq!": case "x!":
		saveDocumentToLocalStorage();
		closeActiveTab(false);
		return;
	case "e": case "edit": case "tabe": case "tabedit": case "tabnew":
		if ( !arg ) { if ( name.startsWith("tab") ) { createNewDocument() } return }
		if ( documentExists(arg) ) { openDocumentFromTree(arg) } else { showMessage(`No document "${arg}"`, "error") }
		return;
	case "sp": case "split": case "vs": case "vsp": case "vsplit": case "new": case "vnew":
		splitEditor();
		return;
	case "tree": case "FileExplorer":
		// shows the file tree and goes to it, like Ctrl+w h
		if ( !isFileTreeVisible() ) { showFileTree() }
		focusTree();
		return;
	case "f": case "focus":
		toggleFocusMode();
		return;
	case "noh": case "nohlsearch":
		searchHighlight = false;
		renderSearch();
		return;
	case "h": case "help":
		showHelp();
		return;
	case "d": case "delete": case "y": case "yank": {
		const [a, b] = range || [lineNumber(text, i), lineNumber(text, i)];
		const from = lineStartOfNumber(text, a);
		const to = lineEnd(text, lineStartOfNumber(text, Math.min(b, lineCount(text) - 1)));
		applyOperator(editor, model, name[0], from, to, true, from);
		return;
	}
	default:
		showMessage(`E492: Not an editor command: ${command}`, "error");
	}
}

function setHeading(editor, model, [first, last], level, cursor){
	// :h0 text, :h1-:h4 headings, like the toolbar's text style (and its break lines under headings)
	if ( level > 4 ) {
		showMessage(`E474: Invalid argument: h${level} (h0 is text, h1 to h4 headings)`, "error");
		return
	}
	// line by line: one formatBlock over several lines makes them a single heading
	for ( let line = Math.max(0, first); line <= Math.min(last, lineCount(model.text) - 1); line++ ) {
		const current = textModel(editor);
		const start = lineStartOfNumber(current.text, line);
		selectRange(current, start, lineEnd(current.text, start));
		formatText(level ? `h${level}` : "div");
	}
	// the text didn't change, so the cursor index is still valid
	setCaret(textModel(editor), cursor);
	clampCaret(editor);
}

function closeActiveTab(force){
	const tab = getActiveTab();
	if ( !tab ) { return }
	// like Vim: :q leaves a tab with unsaved changes open, :q! closes it
	if ( tab.dirty && !force ) { showMessage("E37: No write since last change (add ! to override)", "error"); return }
	tab.dirty = false;
	closeTab(tab.id);
}

function substituteLines(editor, model, [first, last], separator, rest){
	// :s/pattern/replacement/flags with JavaScript regular expressions; & and \1 in the replacement
	const parts = splitUnescaped(rest, separator);
	const pattern = parts[0] || lastSearch?.pattern;
	if ( !pattern ) { showMessage("E35: No previous regular expression", "error"); return }
	const replacement = (parts[1] || "").replace(/\\(\d)/g, "$$$1").replace(/(^|[^\\])&/g, "$1$$&").replace(/\\&/g, "&").replace(/\\n/g, "\n");
	const flags = parts[2] || "";
	const regex = buildRegExp(pattern, flags.includes("g"), flags.includes("i") ? true : flags.includes("I") ? false : null);
	lastSearch = {pattern, backward: false};
	searchHighlight = true;
	const text = model.text;
	let total = 0;
	let lastLine = null;
	const substitutedLines = [];
	for ( let line = Math.min(last, lineCount(text) - 1); line >= first; line-- ) {
		const current = textModel(editor);
		const start = lineStartOfNumber(current.text, line);
		const end = lineEnd(current.text, start);
		const original = current.text.slice(start, end);
		regex.lastIndex = 0;
		let count = 0;
		const replaced = original.replace(regex, (...m) => { count++; return m[0].replace(new RegExp(regex.source, regex.flags.replace("g", "")), replacement) });
		if ( !count ) { continue }
		total += count;
		lastLine = line;
		substitutedLines.push(line);
		if ( replaced.includes("\n") ) {
			selectRange(current, start, end);
			insertLines(replaced.split("\n"));
		} else {
			// only the changed middle, so the formatting around it stays
			let a = 0;
			while ( a < original.length && a < replaced.length && original[a] === replaced[a] ) { a++ }
			let b = 0;
			while ( b < original.length - a && b < replaced.length - a && original[original.length - 1 - b] === replaced[replaced.length - 1 - b] ) { b++ }
			selectRange(current, start + a, end - b);
			const middle = replaced.slice(a, replaced.length - b);
			if ( middle ) { exec("insertText", middle) } else { exec("delete") }
		}
	}
	if ( !total ) { showMessage(`E486: Pattern not found: ${pattern}`, "error"); return }
	const after = textModel(editor);
	setCaret(after, firstNonBlank(after.text, lineStartOfNumber(after.text, lastLine)));
	changed();
	if ( total > 1 ) { showMessage(`${total} substitutions on ${new Set(substitutedLines).size} lines`) }
}

function splitUnescaped(s, separator){
	const parts = [""];
	for ( let j = 0; j < s.length; j++ ) {
		if ( s[j] === "\\" && s[j + 1] === separator ) { parts[parts.length - 1] += separator; j++; continue }
		if ( s[j] === separator ) { parts.push(""); continue }
		parts[parts.length - 1] += s[j];
	}
	return parts;
}


// search
function escapeRegExp(s){ return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") }

function buildRegExp(pattern, global=true, ignoreCase=null){
	// smartcase: case-insensitive unless the pattern has a capital letter
	const insensitive = ignoreCase ?? !/[A-Z]/.test(pattern.replace(/\\./g, ""));
	const flags = (global ? "g" : "") + (insensitive ? "i" : "") + "u";
	try {
		return new RegExp(pattern.replace(/\\</g, "\\b").replace(/\\>/g, "\\b"), flags);
	} catch {
		return new RegExp(escapeRegExp(pattern), flags);
	}
}

function searchMove(editor, model, i, pattern, backward, count){
	const text = model.text;
	const regex = buildRegExp(pattern);
	const matches = [];
	for ( const match of text.matchAll(regex) ) {
		matches.push(match.index);
		if ( !match[0].length ) { regex.lastIndex++ }
	}
	if ( !matches.length ) { showMessage(`E486: Pattern not found: ${pattern}`, "error"); return }
	let j = i;
	let wrapped = false;
	for ( let n = 0; n < count; n++ ) {
		let next = backward ? [...matches].reverse().find(m => m < j) : matches.find(m => m > j);
		if ( next === undefined ) {
			next = backward ? matches[matches.length - 1] : matches[0];
			wrapped = true;
		}
		j = next;
	}
	searchHighlight = true;
	if ( wrapped ) { showMessage(backward ? "search hit TOP, continuing at BOTTOM" : "search hit BOTTOM, continuing at TOP", "warning") }
	setCaret(model, j);
	scrollCaret(editor, "center");
}

function searchMatches(text, pattern, limit=2000){
	const regex = buildRegExp(pattern);
	const matches = [];
	for ( const match of text.matchAll(regex) ) {
		if ( !match[0].length ) { regex.lastIndex++; continue }
		matches.push({start: match.index, end: match.index + match[0].length});
		if ( matches.length >= limit ) { break }
	}
	return matches;
}

function renderSearch(){
	// highlights the whole matches without touching the DOM (CSS Custom Highlight API):
	// while typing / or ? the matches of the typed pattern (incsearch), then those of the last search (hlsearch)
	if ( !window.CSS?.highlights || typeof Highlight !== "function" ) { return }
	const typing = commandLine && commandLine.kind !== ":" ? ui.indicator.querySelector("input").value : "";
	const pattern = typing || (searchHighlight && !commandLine ? lastSearch?.pattern : "");
	const editor = commandLine?.editor ?? focusedEditor();
	if ( !pattern || !editor ) { clearSearchHighlight(); return }
	const model = textModel(editor);
	const matches = searchMatches(model.text, pattern);
	let current = null;
	if ( typing ) {
		// the match the search will jump to
		const from = commandLine.index;
		current = commandLine.kind === "?"
			? [...matches].reverse().find(m => m.start < from) ?? matches[matches.length - 1]
			: matches.find(m => m.start > from) ?? matches[0];
	} else if ( mode === "normal" ) {
		const caret = caretIndex(model);
		current = matches.find(m => m.start === caret);
	}
	const all = new Highlight();
	const active = new Highlight();
	for ( const match of matches ) {
		const start = positionAt(model, match.start);
		const end = positionAt(model, match.end);
		const range = document.createRange();
		try {
			range.setStart(start.node, start.offset);
			range.setEnd(end.node, end.offset);
		} catch { continue }
		(match === current ? active : all).add(range);
	}
	CSS.highlights.set("vi-search", all);
	CSS.highlights.set("vi-search-current", active);
}

function clearSearchHighlight(){
	CSS.highlights?.delete("vi-search");
	CSS.highlights?.delete("vi-search-current");
}


// windows and tabs (workspace.js)
function editorPanes(){
	return [...document.querySelectorAll("#editor-grid .editor-pane")].filter(pane => pane.querySelector(".editor"));
}

function focusEditorTowards(editor, direction, count=1){
	// the nearest editor on that side that is level with this one, like Neovim's Ctrl+W h j k l
	for ( let n = 0; n < count; n++ ) {
		const from = editor.closest(".editor-pane").getBoundingClientRect();
		const horizontal = direction === "left" || direction === "right";
		let best = null;
		for ( const pane of editorPanes() ) {
			const to = pane.getBoundingClientRect();
			const gap = {left: from.left - to.right, right: to.left - from.right, up: from.top - to.bottom, down: to.top - from.bottom}[direction];
			const overlap = horizontal ? Math.min(from.bottom, to.bottom) - Math.max(from.top, to.top) : Math.min(from.right, to.right) - Math.max(from.left, to.left);
			if ( gap < -1 || overlap <= 0 ) { continue }
			if ( !best || gap < best.gap - 1 || (Math.abs(gap - best.gap) <= 1 && overlap > best.overlap) ) { best = {pane, gap, overlap} }
		}
		if ( !best ) {
			if ( horizontal && treeTowards(from, direction) ) { focusTree(); return }
			break
		}
		editor = best.pane.querySelector(".editor");
	}
	enterEditor(editor);
}

function focusNextEditor(editor, step){
	const editors = editorPanes().map(pane => pane.querySelector(".editor"));
	const i = editors.indexOf(editor);
	enterEditor(editors[((i + step) % editors.length + editors.length) % editors.length]);
}

function closeEditorWindow(editor){
	// Ctrl+W q: closes the editor, its document stays open in the tab bar
	const pane = typeof panes !== "undefined" && panes.find(p => p.editor === editor);
	if ( !pane ) { return }
	if ( panes.length < 2 ) { showMessage("E444: Cannot close last window", "error"); return }
	closePane(pane);
	enterEditor(focusedPane?.editor);
}

function enterEditor(editor){
	// focuses an editor with its cursor where it was left
	if ( !editor || editor === document.activeElement ) { return }
	editor.focus({preventScroll: true});
	const range = editorRanges.get(editor);
	if ( range && editor.contains(range.startContainer) ) {
		const selection = window.getSelection();
		selection.removeAllRanges();
		selection.addRange(range);
		rememberSelection();
	} else {
		setCaret(textModel(editor), 0);
	}
	clampCaret(editor);
	render();
}

function goToTab(step, absolute=false){
	// gt gT: the next / previous tab, {count}gt: tab number count, in the order of the tab bar
	if ( typeof tabs === "undefined" || !tabs.length ) { return }
	const i = tabs.indexOf(getActiveTab());
	const target = absolute ? step - 1 : ((i + step) % tabs.length + tabs.length) % tabs.length;
	if ( !tabs[target] ) { return }
	switchToTab(tabs[target].id);
	const editor = focusedPane?.editor;
	if ( !editor ) { return }
	if ( editor !== document.activeElement ) { enterEditor(editor) } else {
		setCaret(textModel(editor), 0);
		clampCaret(editor);
		render();
	}
}


// the file tree, like Neovim's NeoTree: j k to move, l / Enter to open, h to close, / to filter, Ctrl+W to leave
function inTree(){
	return !!document.activeElement?.closest?.("#file-tree");
}

function treeTowards(from, direction){
	// the file tree is on that side of the editor (shown, or hidden on that side)
	const tree = document.getElementById("file-tree");
	if ( !tree ) { return false }
	const side = document.body.dataset.treeSide || "left";
	if ( typeof isFileTreeVisible === "function" && !isFileTreeVisible() ) {
		if ( side !== direction ) { return false }
		showFileTree();
		return true;
	}
	const to = tree.getBoundingClientRect();
	if ( !to.width ) { return false }
	return direction === "left" ? to.right <= from.left + 1 : to.left >= from.right - 1;
}

function treeRows(){
	return [...document.querySelectorAll("#file-tree-list .tree-row")].filter(row => row.offsetParent !== null);
}

function focusTree(row=null){
	const rows = treeRows();
	row = row || rows.find(r => r.classList.contains("active")) || rows[0];
	if ( !row ) { document.getElementById("file-tree-search")?.focus(); return }
	row.focus();
	row.scrollIntoView({block: "nearest"});
	render();
}

function leaveTree(){
	treePending = [];
	if ( typeof closeTreeDrawer === "function" ) { closeTreeDrawer() }
	enterEditor((typeof focusedPane !== "undefined" && focusedPane?.editor) || lastEditor || document.getElementById("editor"));
	render();
}

function refocusTreeRow(selector){
	// opening and closing folders rebuilds the tree
	const row = document.querySelector(`#file-tree-list ${selector}`);
	focusTree(row);
}

function onTreeClick(e){
	// a document opened with a click goes to the editor, like l / Enter: the clicked row is rebuilt and the
	// focus would fall to the page, where vi gets no keys (Ctrl / Shift+click only select)
	// the path still has the row after the click rebuilt the tree
	const row = e.composedPath().find(el => el.classList?.contains("tree-document"));
	if ( e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || !row?.dataset.name ) { return }
	leaveTree();
}

function openTreeRow(row){
	if ( row.classList.contains("tree-folder") ) {
		const folder = row.parentElement.dataset.folder;
		row.click();
		refocusTreeRow(`[data-folder="${CSS.escape(folder)}"] > .tree-row`);
	} else if ( row.dataset.name ) {
		openDocumentFromTree(row.dataset.name);
		leaveTree();
	}
}

function onTreeKeydown(e){
	const search = e.target.id === "file-tree-search";
	const key = keyName(e);
	if ( !key || e.metaKey || e.altKey ) { return }
	const take = () => { e.preventDefault(); e.stopPropagation() };
	if ( treePending[0] === "<C-w>" ) {
		take();
		treePending = [];
		const command = key.replace(/^<C-(.)>$/, "$1");
		if ( ["h", "l", "w", "W", "p", "ArrowLeft", "ArrowRight"].includes(command) ) { leaveTree() } else { render() }
		return
	}
	if ( key === "<C-w>" ) { take(); treePending = ["<C-w>"]; render(); return }
	if ( search ) {
		// the filter: typing filters the tree, Enter opens the first match, Esc / arrows go back to the rows
		if ( key === "Enter" ) {
			take();
			const first = treeRows().find(row => row.dataset.name);
			if ( first ) { openTreeRow(first) }
		} else if ( key === "ArrowDown" || key === "<C-n>" || key === "<C-j>" ) {
			take();
			focusTree(treeRows()[0]);
		} else if ( key === "Escape" ) {
			take();
			focusTree();
		}
		return
	}
	if ( !e.target.classList.contains("tree-row") ) { return }
	const row = e.target;
	const rows = treeRows();
	const i = rows.indexOf(row);
	const pendingG = treePending[0] === "g";
	treePending = [];
	switch ( key ) {
	case "j": case "ArrowDown": take(); focusTree(rows[Math.min(i + 1, rows.length - 1)]); return;
	case "k": case "ArrowUp": take(); focusTree(rows[Math.max(i - 1, 0)]); return;
	case "G": take(); focusTree(rows[rows.length - 1]); return;
	case "g":
		take();
		if ( pendingG ) { focusTree(rows[0]) } else { treePending = ["g"]; render() }
		return;
	case "l": case "o": case "Enter": case "ArrowRight": {
		take();
		const expanded = row.parentElement.getAttribute("aria-expanded") === "true";
		if ( key !== "Enter" && key !== "o" && row.classList.contains("tree-folder") && expanded ) { focusTree(rows[i + 1]); return }
		openTreeRow(row);
		return;
	}
	case "h": case "ArrowLeft": {
		take();
		if ( row.classList.contains("tree-folder") && row.parentElement.getAttribute("aria-expanded") === "true" ) { openTreeRow(row); return }
		const parent = row.parentElement.parentElement.closest("[data-folder]");
		if ( parent ) { focusTree(parent.querySelector(":scope > .tree-row")) }
		return;
	}
	case "/": take(); document.getElementById("file-tree-search").focus(); return;
	case "Escape": render(); return;   // workspace.js clears the selection
	}
}


// scrolling
function lineHeightOf(editor){
	const style = getComputedStyle(editor);
	return parseFloat(style.lineHeight) || (parseFloat(style.fontSize) || 16) * 1.4;
}

function scrollCaret(editor, block="nearest"){
	const scroller = editor.closest(".pane-scroll");
	const selection = window.getSelection();
	if ( !scroller || !selection.rangeCount ) { return }
	const range = selection.getRangeAt(0).cloneRange();
	range.collapse(selection.focusNode === range.startContainer && selection.focusOffset === range.startOffset);
	let rect = range.getClientRects()[0] || elementOf(selection.focusNode).getBoundingClientRect();
	const box = scroller.getBoundingClientRect();
	const margin = lineHeightOf(editor) * 2;
	let delta = 0;
	if ( block === "center" ) { delta = rect.top - (box.top + box.height / 2) }
	else if ( block === "start" ) { delta = rect.top - box.top - margin }
	else if ( block === "end" ) { delta = rect.bottom - box.bottom + margin }
	else if ( rect.top < box.top + margin ) { delta = rect.top - box.top - margin }
	else if ( rect.bottom > box.bottom - margin ) { delta = rect.bottom - box.bottom + margin }
	if ( delta ) { scroller.scrollTop += delta }
}

function showMessage(text, type="info"){
	// Vim's message line: next to the mode, gone after a moment or with the next key
	ui.message.textContent = text;
	ui.message.title = text;
	ui.message.dataset.type = type;
	ui.message.hidden = false;
	clearTimeout(ui.messageTimer);
	ui.messageTimer = setTimeout(hideMessage, type === "error" ? 4000 : 2500);
}

function hideMessage(){
	if ( ui.message ) { ui.message.hidden = true }
}


// :help
const helpSections = [
	["Modes", [
		["i a I A o O", "INSERT before / after the cursor, at the line start / end, on a new line below / above"],
		["Esc, Ctrl+[", "back to NORMAL (the Esc button on phones, see Settings)"],
		["v V", "VISUAL, V-LINE"],
		["R", "REPLACE: typing overwrites"],
		[": / ?", "command line, search forward / backward"],
	]],
	["Moving (with a count: 3j, 2w)", [
		["h j k l, arrows", "like the arrow keys: j / k follow wrapped lines"],
		["w b e ge, W B E gE", "words, WORDS (separated by spaces only)"],
		["0 ^ $ g_", "line start, first character, line end, last character"],
		["gg G, 5G, :5", "first / last line, line 5"],
		["{ }", "previous / next empty line"],
		["f F t T + char, ; ,", "to / before a character on the line, repeat, repeat backward"],
		["%", "matching bracket"],
		["Ctrl+d Ctrl+u, zz zt zb", "half a page down / up, scroll the cursor to the middle / top / bottom"],
	]],
	["Editing", [
		["x X, s S", "delete a character after / before, change a character / the line"],
		["r + char, ~", "replace a character, toggle its case"],
		["dd cc yy >> <<", "delete, change, yank (copy), indent, outdent lines"],
		["D C Y", "delete, change, yank to the line end"],
		["p P", "paste after / before"],
		["J gJ", "join with the next line, without the space"],
		["u Ctrl+r", "undo, redo"],
		[".", "repeat the last change"],
		["Tab", "check / uncheck the checklist item"],
	]],
	["Operators", [
		["d c y > < g~ gu gU", "delete, change, yank, indent, outdent, toggle case, lower case, upper case"],
		["+ a motion", "dw, c$, y2j, gUiw ..."],
		["+ a text object", "iw aw (word), i\" a\" i' a' (quotes), i( a( i[ i{ i< (brackets), ip ap (paragraph)"],
	]],
	["VISUAL", [
		["motions, iw ap ...", "grow the selection"],
		["o", "go to the other end"],
		["d y c > < ~ u U J r p", "act on the selection"],
		[":", "command on the selected lines ( :'<,'>s/a/b/ )"],
	]],
	["Search", [
		["/text ?text", "search forward / backward: regular expressions, case-insensitive unless there's a capital letter"],
		["n N", "next / previous match"],
		["* #", "the word under the cursor, forward / backward"],
	]],
	["Editors and tabs", [
		["Ctrl+w h j k l", "go to the editor on the left / below / above / on the right"],
		["Ctrl+w w W", "next / previous editor"],
		["Ctrl+w s v", "split the editor"],
		["Ctrl+w q c", "close the editor, its document stays in the tab bar"],
		["gt gT, 3gt", "next / previous tab, tab 3"],
	]],
	["Documents (TREE, like NeoTree)", [
		["Ctrl+w h, Ctrl+w l", "from the editor next to it: go to the documents, opened if hidden"],
		["j k, gg G", "next / previous row, first / last row"],
		["l Enter o, h", "open the document or folder, close the folder / go to its folder"],
		["/", "filter the documents: Enter opens the first one, Esc goes back to the rows"],
		["Ctrl+w h l w", "back to the editor"],
	]],
	["Commands", [
		[":w", "save"],
		[":q :q!", "close the tab (not with unsaved changes), close it anyway"],
		[":qa :qa!", "close all tabs but the unsaved ones, close all tabs"],
		[":wq :x", "save and close the tab"],
		[":e name", "open a document: the matching documents are listed, Tab / Shift+Tab or arrows pick one"],
		[":vs :sp", "split the editor"],
		[":s/a/b/g :%s/a/b/gi", "replace on the line / everywhere (g: all on a line, i: ignore case)"],
		[":d :y, :2,5d", "delete, yank lines"],
		[":5", "go to line 5"],
		[":h0 :h1 :h2 :h3 :h4", "text, heading 1 to 4 (on the selected lines from VISUAL)"],
		[":tree :FileExplorer", "show the documents and go to them (TREE)"],
		[":f :focus", "focus mode on / off: only the text; Esc Esc in NORMAL or the faint x leaves it"],
		[":h :help", "this help"],
		["q, Esc", "close pop-ups (this help, Settings, menus); Esc in any mode"],
	]],
];

function showHelp(){
	const escape = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
	const keys = (s) => s.split(/(, | )/).map(part => /^(, | )$/.test(part) || part === "+" || /^[a-z]+$/.test(part) && part.length > 2 ? escape(part) : `<kbd>${escape(part)}</kbd>`).join("");
	const html = helpSections.map(([title, rows]) => `
		<h3>${escape(title)}</h3>
		<table class="data vi-help"><tbody>
			${rows.map(([k, description]) => `<tr><td>${keys(k)}</td><td>${escape(description)}</td></tr>`).join("")}
		</tbody></table>`).join("");
	closeAllModals();
	createModal("Vi help", `<p class="muted small">Vi mode works like Neovim. Turn it off in Settings.</p>${html}`);
}

if ( typeof viModeEnabled !== "function" || viModeEnabled() ) { WriteVi.enable() }
})();
