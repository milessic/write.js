/*
 * Line numbers: a faint counter in the margin left of each editor, the caret's line a little brighter.
 * The lines are the ones vi mode counts (textModel, vi.js), so :12 goes to the line numbered 12: every block, list item
 * and line inside them (<br>, line breaks of pasted text) is one, a rule (<hr>) too. A wrapped line keeps one number;
 * the lines of a collapsed section (folding.js) keep theirs, hidden with them.
 * The numbers are drawn in the editor's card, outside the editor, so they are never part of the document.
 * Settings > Editor or vi's :lines turns them on and off (lineNumbersKey, script.js); it goes to the cloud with the notebook.
 * A click on a number selects its line, with its line break, like a click on a line number in VSCode; Shift+click or
 * a drag over the numbers selects the lines in between. In vi mode that is V-LINE (vi.js).
 */
const lineBlockTags = new Set(["ADDRESS", "ARTICLE", "ASIDE", "BLOCKQUOTE", "DD", "DIV", "DL", "DT", "FIGURE", "FOOTER", "FORM", "H1", "H2", "H3", "H4", "H5", "H6", "HEADER", "HR", "LI", "MAIN", "NAV", "OL", "P", "PRE", "SECTION", "TABLE", "TBODY", "TD", "TH", "THEAD", "TR", "UL"]);
const lineNumberViews = new Map(); // editor -> {gutter, lines: [{node, offset, el}]}
let lineNumbersFrame = 0;
let lineSelectAnchor = null; // {editor, index}: the line a Shift+click or a drag over the numbers selects from

function lineNumbersEnabled(){
	// off until turned on
	return validateUserConsent(false) && localStorage.getItem(lineNumbersKey) === "1";
}

function applyLineNumbersSetting(){
	document.body.classList.toggle("show-line-numbers", lineNumbersEnabled());
	if ( !lineNumbersEnabled() ) {
		lineNumberViews.forEach((view) => view.gutter.remove());
		lineNumberViews.clear();
		return
	}
	scheduleLineNumbers();
}

function isLineBlock(node){
	return node?.nodeType === Node.ELEMENT_NODE && lineBlockTags.has(node.nodeName);
}

function isTrailingBreak(node){
	// a <br> at the end of a block only holds an empty line open, it doesn't add one (isTrailing, vi.js)
	let next = node.nextSibling;
	while ( next && next.nodeType === Node.TEXT_NODE && (next.data === "" || isLayoutText(next)) ) { next = next.nextSibling }
	if ( next ) { return isLineBlock(next) }
	const parent = node.parentNode;
	return parent.nodeType !== Node.ELEMENT_NODE || isLineBlock(parent) || parent.classList.contains("editor") || isTrailingBreak(parent);
}

function isLayoutText(node){
	// indentation between blocks in imported HTML isn't text the user sees
	if ( node.data.trim() !== "" || !node.data.includes("\n") ) { return false }
	const isBlock = (n) => !n || isLineBlock(n);
	return isBlock(node.previousSibling) && isBlock(node.nextSibling);
}

function editorLines(editor){
	// where each line starts: {node, offset} of the first thing on it (a text, a <br>, an empty block)
	const lines = [];
	let lineOpen = false;      // the current line has something on it
	let pendingBreak = false;  // a block ended: the next content starts a new line
	let needsStart = true;     // the current line's start isn't known yet
	let emits = 0;
	const emit = (node, offset) => {
		emits++;
		if ( pendingBreak ) {
			pendingBreak = false;
			needsStart = true;
		}
		if ( needsStart ) {
			lines.push({node, offset});
			needsStart = false;
		}
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
				if ( isLayoutText(node) ) { continue }
				emit(node, 0);
				// pasted text keeps its line breaks (white-space: pre-wrap)
				for ( let i = node.data.indexOf("\n"); i !== -1; i = node.data.indexOf("\n", i + 1) ) {
					needsStart = true;
					if ( i + 1 < node.data.length ) { emit(node, i + 1) }
				}
			} else if ( node.nodeType !== Node.ELEMENT_NODE ) {
				continue
			} else if ( node.nodeName === "BR" ) {
				emit(node, 0);
				if ( !isTrailingBreak(node) ) { needsStart = true }
			} else if ( node.nodeName === "HR" ) {
				breakLine();
				emit(node, 0);
				breakLine();
			} else if ( lineBlockTags.has(node.nodeName) ) {
				breakLine();
				const count = emits;
				walk(node);
				if ( emits === count && !["UL", "OL", "DL", "TABLE", "TBODY", "THEAD", "TR"].includes(node.nodeName) ) {
					emit(node, 0);
				}
				breakLine();
			} else {
				walk(node);
			}
		}
	};
	walk(editor);
	if ( !lines.length ) { lines.push({node: editor, offset: 0}) }
	return lines;
}

function lineRect(line){
	// the box of the line's first character, or of the empty line; null when the line is hidden
	const {node, offset} = line;
	let rect;
	if ( node.nodeType === Node.TEXT_NODE ) {
		const range = document.createRange();
		const end = offset < node.data.length && node.data[offset] !== "\n" ? offset + 1 : offset;
		range.setStart(node, offset);
		range.setEnd(node, end);
		rect = range.getClientRects()[0] || range.getBoundingClientRect();
	} else {
		rect = node.getBoundingClientRect();
		if ( node.nodeName !== "BR" && rect.height ) {
			// an empty block: its first line
			const style = getComputedStyle(node);
			const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.5;
			const top = rect.top + (parseFloat(style.paddingTop) || 0) + (parseFloat(style.borderTopWidth) || 0);
			return {top, height: Math.min(lineHeight, rect.height)};
		}
	}
	return rect && rect.height ? rect : null;
}

function lineNumbersView(editor){
	let view = lineNumberViews.get(editor);
	const card = editor.closest(".editor-card");
	if ( view && view.gutter.parentElement === card ) { return view }
	const gutter = document.createElement("div");
	gutter.className = "line-numbers";
	gutter.setAttribute("aria-hidden", "true");
	card.prepend(gutter);
	view = {gutter, lines: []};
	lineNumberViews.set(editor, view);
	return view;
}

function renderLineNumbers(editor){
	const view = lineNumbersView(editor);
	const lines = editorLines(editor);
	const origin = view.gutter.getBoundingClientRect().top;
	// the card makes room for the numbers (styles.css)
	view.gutter.parentElement.style.setProperty("--line-number-digits", Math.max(2, String(lines.length).length));
	const numbers = [...view.gutter.children];
	lines.forEach((line, i) => {
		const el = numbers[i] || view.gutter.appendChild(document.createElement("span"));
		const rect = lineRect(line);
		el.hidden = !rect;
		if ( rect ) {
			el.style.top = `${rect.top - origin}px`;
			el.style.height = el.style.lineHeight = `${rect.height}px`;
		}
		if ( el.textContent !== String(i + 1) ) { el.textContent = i + 1 }
		line.el = el;
	});
	numbers.slice(lines.length).forEach((el) => el.remove());
	view.lines = lines;
	markCaretLine(editor);
}

function markCaretLine(editor){
	// the caret's line number stands out a little
	const view = lineNumberViews.get(editor);
	if ( !view ) { return }
	const selection = window.getSelection();
	const focus = selection.rangeCount && editor.contains(selection.focusNode) ? selection : null;
	let current = null;
	if ( focus ) {
		const caret = document.createRange();
		caret.setStart(focus.focusNode, focus.focusOffset);
		for ( const line of view.lines ) {
			// the lines are from the last drawing: an edit may have taken some away, they are drawn again soon
			if ( !editor.contains(line.node) ) { continue }
			if ( line.node === editor || caret.comparePoint(line.node, line.offset) <= 0 ) { current = line } else { break }
		}
	}
	view.lines.forEach((line) => line.el.classList.toggle("current", line === current));
}

function scheduleLineNumbers(){
	if ( lineNumbersFrame || !lineNumbersEnabled() ) { return }
	lineNumbersFrame = requestAnimationFrame(() => {
		lineNumbersFrame = 0;
		for ( const editor of lineNumberViews.keys() ) {
			if ( !editor.isConnected ) {
				lineNumberViews.get(editor).gutter.remove();
				lineNumberViews.delete(editor);
			}
		}
		document.querySelectorAll("#editor-grid .editor").forEach((editor) => {
			if ( !lineNumberViews.has(editor) ) { lineResizeObserver.observe(editor) }
			renderLineNumbers(editor);
		});
	});
}

// selecting lines from the numbers
function linePoint(line){
	// where the line starts, as a point a range can start at (a <br> or a rule is a node of its own, not a container)
	const {node, offset} = line;
	if ( node.nodeName === "BR" || node.nodeName === "HR" ) { return {node: node.parentNode, offset: [...node.parentNode.childNodes].indexOf(node)} }
	return {node, offset};
}

function lineAtNumber(view, y){
	// the line whose number is at y, or the nearest one above
	let index = 0;
	view.lines.forEach((line, i) => { if ( !line.el.hidden && line.el.getBoundingClientRect().top <= y ) { index = i } });
	return index;
}

function selectLines(editor, from, to){
	// from the start of the first line to the start of the one after the last (the editor's end after the last line)
	const view = lineNumberViews.get(editor);
	const lines = view.lines;
	const start = (i) => linePoint(lines[i]);
	const after = (i) => i + 1 < lines.length ? start(i + 1) : {node: editor, offset: editor.childNodes.length};
	editor.focus({preventScroll: true});
	if ( window.WriteVi?.selectLines(editor, start(from), start(to)) ) { return }
	const [anchor, head] = to >= from ? [start(from), after(to)] : [after(from), start(to)];
	window.getSelection().setBaseAndExtent(anchor.node, anchor.offset, head.node, head.offset);
}

function handleLineNumberDown(e){
	const number = e.target.closest?.(".line-numbers > span");
	if ( !number || e.button !== 0 ) { return }
	const editor = [...lineNumberViews.keys()].find((ed) => lineNumberViews.get(ed).gutter === number.parentElement);
	const view = editor && lineNumberViews.get(editor);
	const index = view?.lines.findIndex((line) => line.el === number);
	if ( index === undefined || index === -1 ) { return }
	// no text selection by the browser, and the focus goes to the editor
	e.preventDefault();
	if ( !e.shiftKey || lineSelectAnchor?.editor !== editor ) {
		// Shift+click without a line clicked before: from the caret's line
		const current = view.lines.findIndex((line) => line.el.classList.contains("current"));
		lineSelectAnchor = {editor, index: e.shiftKey && current !== -1 ? current : index};
	}
	const anchor = lineSelectAnchor.index;
	selectLines(editor, anchor, index);
	let last = index;
	const move = (ev) => {
		const i = lineAtNumber(view, ev.clientY);
		if ( i !== last ) { selectLines(editor, anchor, last = i) }
	};
	const end = () => {
		document.removeEventListener("pointermove", move);
		document.removeEventListener("pointerup", end);
		document.removeEventListener("pointercancel", end);
	};
	document.addEventListener("pointermove", move);
	document.addEventListener("pointerup", end);
	document.addEventListener("pointercancel", end);
}

function lineNumbersSettingsHtml(){
	// goes in the Editor section of Settings (createSettingsModal, script.js)
	return `
		<label class="check"><input id="setting-line-numbers" type="checkbox"${lineNumbersEnabled() ? " checked" : ""}>Show line numbers</label>
		<p class="muted small">A line counter in the margin left of the text. The lines are the ones vi mode counts, so <kbd>:12</kbd> goes to line 12. A click on a number selects its line, Shift+click or a drag the lines in between.</p>`;
}

function setLineNumbers(show){
	// false without the consent to store the setting
	if ( !validateUserConsent() ) { return false }
	localStorage.setItem(lineNumbersKey, show ? "1" : "0");
	applyLineNumbersSetting();
	if ( typeof handleRemoteAutosave !== "undefined" ) { handleRemoteAutosave() } // the setting goes to the cloud with the notebook
	return true;
}

function toggleLineNumbers(){
	// vi's :lines
	return setLineNumbers(!lineNumbersEnabled());
}

function initLineNumbersSettings(){
	document.getElementById("setting-line-numbers").addEventListener("change", (e) => {
		if ( !setLineNumbers(e.target.checked) ) { e.target.checked = !e.target.checked }
	});
}

// the numbers follow the text: edits, documents opened, folds, split editors, wrapping when the width changes
const lineResizeObserver = new ResizeObserver(scheduleLineNumbers);
new MutationObserver((records) => {
	if ( records.some((r) => !r.target.closest?.(".line-numbers") && !r.target.parentElement?.closest(".line-numbers")) ) { scheduleLineNumbers() }
}).observe(document.getElementById("editor-grid"), {childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["class", "data-collapsed"]});
document.addEventListener("selectionchange", () => {
	lineNumberViews.forEach((view, editor) => markCaretLine(editor));
});
document.getElementById("editor-grid").addEventListener("pointerdown", handleLineNumberDown);
window.addEventListener("resize", scheduleLineNumbers);
document.fonts?.ready.then(scheduleLineNumbers);
applyLineNumbersSetting();
