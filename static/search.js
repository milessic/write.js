/*
 * Search in the focused document: Menu > Search in Document, or Ctrl+F (Cmd+F on Apple devices) opens a bar over the
 * editor's top right corner. The matches are highlighted as the text is typed (CSS Custom Highlight API, the DOM isn't
 * touched), the current one stronger; Enter / ↓ goes to the next, Shift+Enter / ↑ to the previous, Aa matches the case.
 * Esc or ✕ closes it and puts the caret on the current match (selects it, outside vi mode).
 * A match is within a line: the lines are the blocks and <br>s, like vi's and the line numbers'. A match in a collapsed
 * section or list item opens it up when it is gone to (folding.js).
 */
const findBar = document.getElementById("find-bar");
const findInput = document.getElementById("find-input");
const findCaseButton = document.getElementById("find-case");
const findMaxMatches = 5000;
let findMatches = []; // ranges in findEditor, in the document's order
let findIndex = -1;
let findEditor = null;
let findFrame = 0;

function findOpen(){
	return !findBar.hidden;
}

function openFind(){
	const editor = document.getElementById("editor");
	// a short selection in the document is what's searched for
	const selection = window.getSelection();
	const selected = selection.rangeCount && editor.contains(selection.anchorNode) ? selection.toString() : "";
	if ( selected && !selected.includes("\n") && selected.length <= 200 ) { findInput.value = selected }
	findBar.hidden = false;
	placeFindBar();
	findInput.focus();
	findInput.select();
	updateFind(true);
}

function closeFind(backToEditor=true){
	if ( !findOpen() ) { return }
	const match = findMatches[findIndex];
	findBar.hidden = true;
	clearFindHighlight();
	findMatches = [];
	findIndex = -1;
	if ( !backToEditor || !findEditor?.isConnected ) { return }
	findEditor.focus({preventScroll: true});
	if ( !match ) { return }
	// vi mode: the cursor on the match's start, a selection would start VISUAL
	const range = match.cloneRange();
	if ( document.body.classList.contains("vi-enabled") ) { range.collapse(true) }
	const selection = window.getSelection();
	selection.removeAllRanges();
	selection.addRange(range);
}

function placeFindBar(){
	// over the focused editor's top right corner, clear of its scrollbar
	if ( !findOpen() ) { return }
	const pane = document.getElementById("editor")?.closest(".editor-pane");
	if ( !pane ) { return }
	const rect = pane.getBoundingClientRect();
	// in focus mode, under the x (and the document window's menu)
	findBar.style.top = `${Math.max(rect.top, document.body.classList.contains("focus-mode") ? 40 : 0) + 8}px`;
	findBar.style.right = `${Math.max(0, window.innerWidth - rect.right) + 20}px`;
}

function findTextOf(editor){
	// the editor's text, a "\n" between its lines, and where each text node starts in it
	const segments = [];
	let text = "";
	const newLine = () => { if ( text && !text.endsWith("\n") ) { text += "\n" } };
	const walker = document.createTreeWalker(editor, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
	while ( walker.nextNode() ) {
		const node = walker.currentNode;
		if ( node.nodeType === Node.TEXT_NODE ) {
			segments.push({node, start: text.length});
			text += node.data;
		} else if ( isLineBlock(node) || node.nodeName === "BR" ) { // linenumbers.js
			newLine();
		}
	}
	return {text, segments};
}

function findPoint(segments, index, end){
	// the text node and offset of an index of the text; a match's end is taken from the node it ends in
	let low = 0, high = segments.length - 1;
	while ( low < high ) {
		const mid = Math.ceil((low + high) / 2);
		if ( end ? segments[mid].start < index : segments[mid].start <= index ) { low = mid } else { high = mid - 1 }
	}
	const segment = segments[low];
	return {node: segment.node, offset: Math.min(index - segment.start, segment.node.data.length)};
}

function updateFind(fromCaret=false){
	// the matches of the typed text; the current one stays the one at the same place, or the first after the caret
	if ( !findOpen() ) { return }
	const editor = document.getElementById("editor");
	const query = findInput.value;
	const previous = findMatches[findIndex];
	findEditor = editor;
	findMatches = [];
	if ( query && editor ) {
		const {text, segments} = findTextOf(editor);
		const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), findCaseButton.getAttribute("aria-pressed") === "true" ? "g" : "gi");
		for ( let match; (match = pattern.exec(text)) && findMatches.length < findMaxMatches; ) {
			const start = findPoint(segments, match.index, false);
			const end = findPoint(segments, match.index + match[0].length, true);
			const range = document.createRange();
			range.setStart(start.node, start.offset);
			range.setEnd(end.node, end.offset);
			findMatches.push(range);
		}
	}
	const from = fromCaret ? findCaretRange(editor) : previous;
	findIndex = !findMatches.length ? -1 : from
		? Math.max(0, findMatches.findIndex((range) => range.compareBoundaryPoints(Range.START_TO_START, from) >= 0))
		: 0;
	renderFind();
	if ( fromCaret || !previous ) { revealFindMatch() }
}

function findCaretRange(editor){
	const selection = window.getSelection();
	if ( selection.rangeCount && editor?.contains(selection.anchorNode) ) { return selection.getRangeAt(0) }
	return lastEditorRange && editor?.contains(lastEditorRange.startContainer) ? lastEditorRange : null;
}

function renderFind(){
	const count = document.getElementById("find-count");
	count.textContent = !findInput.value ? "" : findMatches.length
		? `${findIndex + 1}/${findMatches.length}${findMatches.length === findMaxMatches ? "+" : ""}` : "No results";
	findBar.classList.toggle("no-results", Boolean(findInput.value) && !findMatches.length);
	if ( !window.CSS?.highlights || typeof Highlight !== "function" ) { return }
	CSS.highlights.set("find-match", new Highlight(...findMatches.filter((r, i) => i !== findIndex)));
	CSS.highlights.set("find-current", new Highlight(...(findMatches[findIndex] ? [findMatches[findIndex]] : [])));
}

function clearFindHighlight(){
	CSS.highlights?.delete("find-match");
	CSS.highlights?.delete("find-current");
}

function goToFindMatch(step){
	if ( !findMatches.length ) { return }
	findIndex = (findIndex + step + findMatches.length) % findMatches.length;
	renderFind();
	revealFindMatch();
}

function revealFindMatch(){
	// a match in a collapsed section or item opens it up, then it is scrolled into the middle of the view
	const match = findMatches[findIndex];
	if ( !match || !findEditor ) { return }
	const node = match.startContainer;
	const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
	let unfolded = false;
	if ( element.closest(".fold-hidden") && typeof unfoldAround === "function" ) {
		let line = element;
		while ( line.parentElement && line.parentElement !== findEditor ) { line = line.parentElement }
		unfolded = unfoldAround(line);
	}
	if ( typeof unfoldListsAround === "function" ) { unfolded = unfoldListsAround(node) || unfolded }
	if ( unfolded ) {
		findEditor.dispatchEvent(new Event("input", { bubbles: true }));
		if ( findEditor.id === "editor" ) { performAutoSave() }
	}
	const scroller = findEditor.closest(".pane-scroll");
	const rect = match.getBoundingClientRect();
	const view = scroller.getBoundingClientRect();
	if ( rect.height && (rect.top < view.top + 40 || rect.bottom > view.bottom - 20) ) {
		scroller.scrollTop += rect.top - view.top - view.height / 3;
	}
	// without the highlights, the match is shown as the selection
	if ( !window.CSS?.highlights ) {
		const selection = window.getSelection();
		selection.removeAllRanges();
		selection.addRange(match);
	}
}

function scheduleFind(){
	if ( findFrame || !findOpen() ) { return }
	findFrame = requestAnimationFrame(() => {
		findFrame = 0;
		updateFind();
		placeFindBar();
	});
}

function handleFindShortcut(e){
	// Ctrl+F, Cmd+F on Apple devices; with the bar open Ctrl/Cmd+G and Shift go through the matches
	const mod = document.body.classList.contains("apple-platform") ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
	if ( !mod || e.altKey || e.isComposing ) { return }
	const key = e.key.toLowerCase();
	if ( key === "f" && !e.shiftKey ) {
		// a modal's text is left to the browser's own search
		if ( document.querySelector(".modal-container") ) { return }
		e.preventDefault();
		e.stopPropagation();
		openFind();
	} else if ( key === "g" && findOpen() ) {
		e.preventDefault();
		e.stopPropagation();
		goToFindMatch(e.shiftKey ? -1 : 1);
	}
}

// capture: before vi and the editors read it
document.addEventListener("keydown", handleFindShortcut, true);
findInput.addEventListener("input", () => updateFind(true));
findInput.addEventListener("keydown", (e) => {
	if ( e.key === "Enter" ) {
		e.preventDefault();
		goToFindMatch(e.shiftKey ? -1 : 1);
	} else if ( e.key === "Escape" ) {
		// not focus mode's Esc, nor the pop-ups'
		e.preventDefault();
		e.stopPropagation();
		closeFind();
	}
});
// the buttons keep the focus in the field
findBar.addEventListener("mousedown", (e) => { if ( e.target.closest("button") ) { e.preventDefault() } });
document.getElementById("find-next").addEventListener("click", () => goToFindMatch(1));
document.getElementById("find-prev").addEventListener("click", () => goToFindMatch(-1));
document.getElementById("find-close").addEventListener("click", () => closeFind());
findCaseButton.addEventListener("click", () => {
	findCaseButton.setAttribute("aria-pressed", String(findCaseButton.getAttribute("aria-pressed") !== "true"));
	updateFind();
});
// the matches follow the text and the focused editor (its id="editor"), the bar the editor
new MutationObserver(scheduleFind).observe(document.getElementById("editor-grid"),
	{childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["id"]});
new ResizeObserver(scheduleFind).observe(document.getElementById("editor-grid"));
window.addEventListener("resize", scheduleFind);
