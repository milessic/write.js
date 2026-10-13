/*
 * Heading folding: the arrow left of a heading collapses the lines under it, up to the next heading of the same or a higher level.
 * A collapsed heading has data-collapsed="true", so the state is saved with the document. The lines it hides get .fold-hidden,
 * recomputed from the headings whenever the document changes; they are only hidden while body has .heading-folding.
 * Settings > Headings turns it off (headingFoldingKey, script.js) and goes to the cloud with the notebook; turned off,
 * everything shows and the collapsed headings are kept for when it is back on.
 */
const foldableHeadings = "h1, h2, h3, h4";

function headingFoldingEnabled(){
	// on until turned off
	return !validateUserConsent(false) || localStorage.getItem(headingFoldingKey) !== "0";
}

function headingLevel(el){
	return /^H[1-4]$/.test(el?.nodeName) ? Number(el.nodeName[1]) : 0;
}

function isFoldableHeading(el){
	return headingLevel(el) > 0 && el.parentElement?.classList.contains("editor");
}

function applyHeadingFolding(){
	document.body.classList.toggle("heading-folding", headingFoldingEnabled());
	document.querySelectorAll("#editor-grid .editor").forEach(applyHeadingFolds);
}

function applyHeadingFolds(editor){
	// hides each collapsed heading's section; only the editor's own lines are folded
	let foldLevel = 0; // level of the collapsed heading whose section this is, 0 outside of one
	for ( const el of editor.children ) {
		const level = headingLevel(el);
		if ( level && level <= foldLevel ) { foldLevel = 0 }
		if ( el.classList.contains("fold-hidden") !== foldLevel > 0 ) {
			el.classList.toggle("fold-hidden", foldLevel > 0);
			if ( !el.classList.length ) { el.removeAttribute("class") }
		}
		if ( level && !foldLevel && el.dataset.collapsed === "true" ) { foldLevel = level }
	}
}

function wrapLooseLines(heading){
	// text typed straight into the editor (no line <div> around it) can't be hidden: it gets one
	// (whitespace between blocks stays as it is)
	const level = headingLevel(heading);
	let line = null;
	for ( let node = heading.nextSibling; node; ) {
		const next = node.nextSibling;
		const nodeLevel = headingLevel(node);
		if ( nodeLevel && nodeLevel <= level ) { break }
		const inline = node.nodeType === Node.TEXT_NODE || inlineTags.has(node.nodeName) || node.nodeName === "BR";
		if ( !inline ) {
			line = null;
		} else if ( line || node.textContent.trim() !== "" || node.nodeType === Node.ELEMENT_NODE ) {
			if ( !line ) {
				line = document.createElement("div");
				node.before(line);
			}
			line.appendChild(node);
			if ( node.nodeName === "BR" ) { line = null }
		}
		node = next;
	}
}

function toggleHeadingFold(heading){
	const editor = heading.parentElement;
	if ( heading.dataset.collapsed === "true" ) {
		heading.removeAttribute("data-collapsed");
	} else {
		wrapLooseLines(heading);
		heading.dataset.collapsed = "true";
	}
	applyHeadingFolds(editor);
	// the caret doesn't stay in a hidden line, it goes to the end of the heading
	const selection = window.getSelection();
	const anchor = selection.rangeCount ? selection.anchorNode : null;
	const anchorElement = anchor && (anchor.nodeType === Node.ELEMENT_NODE ? anchor : anchor.parentElement);
	if ( anchorElement?.closest(".fold-hidden") && editor.contains(anchorElement) ) {
		const caret = document.createRange();
		caret.selectNodeContents(heading);
		caret.collapse(false);
		selection.removeAllRanges();
		selection.addRange(caret);
	}
	// the folds are part of the document: it changed like after an edit (unsaved tab, autosave)
	editor.dispatchEvent(new Event("input", { bubbles: true }));
	if ( editor.id === "editor" ) { performAutoSave() }
}

function unfoldAround(el){
	// expands the collapsed headings whose sections hold el
	let level = headingLevel(el) || 5;
	let changed = false;
	for ( let prev = el.previousElementSibling; prev && level > 1; prev = prev.previousElementSibling ) {
		const prevLevel = headingLevel(prev);
		if ( !prevLevel || prevLevel >= level ) { continue }
		level = prevLevel;
		if ( prev.dataset.collapsed === "true" ) {
			prev.removeAttribute("data-collapsed");
			changed = true;
		}
	}
	if ( changed ) { applyHeadingFolds(el.parentElement) }
	return changed;
}

function caretLine(editor){
	// the editor's line (its child element) holding the collapsed caret, and whether the caret is at its start or end
	const selection = window.getSelection();
	if ( !selection.rangeCount || !selection.isCollapsed ) { return null }
	const range = selection.getRangeAt(0);
	let line = range.startContainer;
	while ( line && line.parentNode !== editor ) { line = line.parentNode }
	if ( line?.nodeType !== Node.ELEMENT_NODE ) { return null }
	const before = document.createRange();
	before.setStart(line, 0);
	before.setEnd(range.startContainer, range.startOffset);
	const after = document.createRange();
	after.setStart(range.startContainer, range.startOffset);
	after.setEnd(line, line.childNodes.length);
	return { line, atStart: before.toString() === "", atEnd: after.toString() === "" };
}

function handleFoldMouseDown(e){
	// the arrow is the heading's ::before, in the margin left of it
	if ( !document.body.classList.contains("heading-folding") || e.button !== 0 ) { return }
	const heading = e.target.closest?.(foldableHeadings);
	if ( !heading || !isFoldableHeading(heading) || e.clientX >= heading.getBoundingClientRect().left ) { return }
	e.preventDefault();
	toggleHeadingFold(heading);
}

function handleFoldEnter(e){
	// a new line under a collapsed heading would be part of its hidden section: Enter opens it up first
	if ( e.key !== "Enter" || e.shiftKey || e.isComposing || e.defaultPrevented ) { return }
	if ( !document.body.classList.contains("heading-folding") ) { return }
	const editor = e.target.closest?.(".editor");
	const caret = editor && caretLine(editor);
	if ( !caret || !isFoldableHeading(caret.line) || caret.line.dataset.collapsed !== "true" ) { return }
	caret.line.removeAttribute("data-collapsed");
	applyHeadingFolds(editor);
}

function handleFoldDelete(e){
	// deleting into a hidden line would change it unseen: its section opens up first
	if ( e.inputType !== "deleteContentBackward" && e.inputType !== "deleteContentForward" ) { return }
	if ( !document.body.classList.contains("heading-folding") ) { return }
	const editor = e.target.closest?.(".editor");
	const caret = editor && caretLine(editor);
	if ( !caret ) { return }
	const neighbour = e.inputType === "deleteContentBackward"
		? caret.atStart && caret.line.previousElementSibling
		: caret.atEnd && caret.line.nextElementSibling;
	if ( neighbour?.classList.contains("fold-hidden") ) { unfoldAround(neighbour) }
}

function headingFoldingSettingsHtml(){
	// goes in the Headings section of Settings (createSettingsModal, script.js)
	return `
		<label class="check"><input id="setting-heading-folding" type="checkbox"${headingFoldingEnabled() ? " checked" : ""}>Collapse and expand sections by their headings</label>
		<p class="muted small">Click the arrow left of a heading. Collapsed sections are saved with the document; turned off, everything shows.</p>`;
}

function initHeadingFoldingSettings(){
	document.getElementById("setting-heading-folding").addEventListener("change", (e) => {
		if ( !validateUserConsent() ) { e.target.checked = !e.target.checked; return }
		localStorage.setItem(headingFoldingKey, e.target.checked ? "1" : "0");
		applyHeadingFolding();
		if ( typeof handleRemoteAutosave !== "undefined" ) { handleRemoteAutosave() } // the setting goes to the cloud with the notebook
	});
}

// capture: opens the section before script.js handles the Enter (handleHeadingBreakEnter)
document.getElementById("editor-grid").addEventListener("keydown", handleFoldEnter, true);
document.getElementById("editor-grid").addEventListener("mousedown", handleFoldMouseDown);
document.getElementById("editor-grid").addEventListener("beforeinput", handleFoldDelete, true);
document.getElementById("editor-grid").addEventListener("input", (e) => {
	const editor = e.target.closest?.(".editor");
	if ( editor ) { applyHeadingFolds(editor) }
});
applyHeadingFolding();
