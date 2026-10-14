/*
 * Heading folding: the arrow left of a heading collapses the lines under it, up to the next heading of the same or a higher level.
 * A collapsed heading has data-collapsed="true", so the state is saved with the document. The lines it hides get .fold-hidden,
 * recomputed from the headings whenever the document changes; they are only hidden while body has .heading-folding.
 * Settings > Headings turns it off (headingFoldingKey, script.js) and goes to the cloud with the notebook; turned off,
 * everything shows and the collapsed headings are kept for when it is back on.
 *
 * List folding: an item of any list (bulleted, numbered, checklist) with a list nested in it gets an arrow left of its
 * bullet or checkbox, which collapses the nested items. A collapsed item has data-collapsed="true" too; its nested items
 * are hidden by styles.css while body has .list-folding. Settings > Lists turns it off (listFoldingKey, script.js).
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

function listFoldingEnabled(){
	// on until turned off
	return !validateUserConsent(false) || localStorage.getItem(listFoldingKey) !== "0";
}

function applyFoldingSettings(){
	document.body.classList.toggle("heading-folding", headingFoldingEnabled());
	document.body.classList.toggle("list-folding", listFoldingEnabled());
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
	if ( neighbour?.classList?.contains("fold-hidden") ) { unfoldAround(neighbour) }
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
		applyFoldingSettings();
		if ( typeof handleRemoteAutosave !== "undefined" ) { handleRemoteAutosave() } // the setting goes to the cloud with the notebook
	});
}

function initListFoldingSettings(){
	document.getElementById("setting-list-folding").addEventListener("change", (e) => {
		if ( !validateUserConsent() ) { e.target.checked = !e.target.checked; return }
		localStorage.setItem(listFoldingKey, e.target.checked ? "1" : "0");
		applyFoldingSettings();
		if ( typeof handleRemoteAutosave !== "undefined" ) { handleRemoteAutosave() } // the setting goes to the cloud with the notebook
	});
}


// list folding
function elementOf(node){
	return node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
}

function nestedLists(li){
	return [...li.children].filter((el) => (el.nodeName === "UL" || el.nodeName === "OL") && el.querySelector(":scope > li"));
}

function isFoldableItem(el){
	return el?.nodeName === "LI" && Boolean(el.closest(".editor")) && nestedLists(el).length > 0;
}

function isCollapsedItem(el){
	return el?.nodeName === "LI" && el.dataset.collapsed === "true";
}

function onFoldArrow(li, e){
	// the arrow is left of the item's bullet or checkbox (styles.css), on its first line; the checkbox's gutter
	// (checklist.js) starts at 1.9em left of the item, the arrow's ends there
	const rect = li.getBoundingClientRect();
	const style = getComputedStyle(li);
	const fontSize = parseFloat(style.fontSize) || 16;
	const lineHeight = parseFloat(style.lineHeight) || fontSize * 1.5;
	const inGutter = e.clientX < rect.left - fontSize * 1.9 && e.clientX >= rect.left - fontSize * 3;
	const onFirstLine = e.clientY >= rect.top && e.clientY <= rect.top + lineHeight;
	return inGutter && onFirstLine;
}

function listItemAtFoldArrow(e){
	// the arrow is the nested list's ::before, so a click lands on that list, the item, or (next to it) its own list
	const target = elementOf(e.target);
	if ( !target?.closest(".editor") ) { return null }
	const candidates = new Set();
	for ( let el = target; el && !el.classList.contains("editor"); el = el.parentElement ) {
		if ( el.nodeName === "LI" ) { candidates.add(el) }
		if ( el.nodeName === "UL" || el.nodeName === "OL" ) { [...el.children].forEach((li) => candidates.add(li)) }
	}
	return [...candidates].find((li) => isFoldableItem(li) && onFoldArrow(li, e)) || null;
}

function toggleListFold(li){
	const editor = li.closest(".editor");
	if ( isCollapsedItem(li) ) {
		li.removeAttribute("data-collapsed");
	} else {
		li.dataset.collapsed = "true";
	}
	// the caret doesn't stay in a hidden item, it goes to the end of the item's own text
	const selection = window.getSelection();
	const anchor = selection.rangeCount ? elementOf(selection.anchorNode) : null;
	if ( isCollapsedItem(li) && anchor && anchor !== li && li.contains(anchor) && anchor.closest("li") !== li ) {
		const caret = document.createRange();
		caret.setStartBefore(nestedLists(li)[0]);
		caret.collapse(true);
		selection.removeAllRanges();
		selection.addRange(caret);
	}
	// the folds are part of the document: it changed like after an edit (unsaved tab, autosave)
	editor.dispatchEvent(new Event("input", { bubbles: true }));
	if ( editor.id === "editor" ) { performAutoSave() }
}

function unfoldListsAround(node){
	// expands the collapsed items that hide node
	const own = elementOf(node)?.closest("li");
	let changed = false;
	for ( let li = own?.parentElement?.closest("li"); li && li.closest(".editor"); li = li.parentElement?.closest("li") ) {
		if ( isCollapsedItem(li) ) {
			li.removeAttribute("data-collapsed");
			changed = true;
		}
	}
	return changed;
}

function unfoldLastItems(li){
	// expands the collapsed items down to the last line shown under li, which is hidden when li is collapsed
	for ( ; li?.nodeName === "LI"; li = nestedLists(li).at(-1)?.lastElementChild ) {
		if ( isCollapsedItem(li) ) { li.removeAttribute("data-collapsed") }
	}
}

function keepingSelection(fn){
	// moving nodes takes a selection inside them out to where they were: it is put back
	const selection = window.getSelection();
	const range = selection.rangeCount ? selection.getRangeAt(0) : null;
	const ends = range && [range.startContainer, range.startOffset, range.endContainer, range.endOffset];
	if ( !fn() || !ends ) { return }
	const restored = document.createRange();
	restored.setStart(ends[0], ends[1]);
	restored.setEnd(ends[2], ends[3]);
	selection.removeAllRanges();
	selection.addRange(restored);
}

function nestListsInItems(editor){
	// Tab (execCommand("indent")) nests an item in a list right after the item above, not in it: the list goes into
	// that item (into its own nested list when it has one), so it is the item's to fold; a collapsed one opens up,
	// the nested item is where the caret is
	keepingSelection(() => {
		const lists = [...editor.querySelectorAll("li + ul, li + ol")];
		for ( const list of lists ) {
			const li = list.previousElementSibling;
			li.removeAttribute("data-collapsed");
			const last = li.lastElementChild;
			if ( last?.nodeName === list.nodeName ) {
				last.append(...list.childNodes);
				list.remove();
			} else {
				li.appendChild(list);
			}
		}
		return lists.length > 0;
	});
}

function unnestCaretList(editor){
	// Shift+Tab (execCommand("outdent")) breaks an item nested in a list inside the item above (Chrome puts it as an
	// <li> in that <li>): before it, the list goes right after the item above, as Tab makes it; nestListsInItems
	// takes what is left of it back in after the edit
	const selection = window.getSelection();
	if ( !selection.rangeCount ) { return }
	const li = elementOf(selection.getRangeAt(0).startContainer)?.closest("li");
	const list = li?.parentElement;
	const parent = list?.parentElement;
	if ( parent?.nodeName !== "LI" || !editor.contains(parent) ) { return }
	keepingSelection(() => {
		const after = [];
		for ( let node = list; node; node = node.nextSibling ) { after.push(node) }
		parent.after(...after);
		return true;
	});
}

function normalizeListFolds(editor){
	nestListsInItems(editor);
	// an item whose nested list is gone isn't collapsed
	for ( const li of editor.querySelectorAll("li[data-collapsed]") ) {
		if ( !isFoldableItem(li) ) { li.removeAttribute("data-collapsed") }
	}
}

function caretItem(editor){
	// the item holding the collapsed caret in its own text (not in a nested list), and whether the caret is at
	// the start or the end of that text
	const selection = window.getSelection();
	if ( !selection.rangeCount || !selection.isCollapsed ) { return null }
	const range = selection.getRangeAt(0);
	const li = elementOf(range.startContainer)?.closest("li");
	if ( !li || !editor.contains(li) ) { return null }
	const before = document.createRange();
	before.setStart(li, 0);
	before.setEnd(range.startContainer, range.startOffset);
	const after = document.createRange();
	after.setStart(range.startContainer, range.startOffset);
	const nested = nestedLists(li)[0];
	nested ? after.setEndBefore(nested) : after.setEnd(li, li.childNodes.length);
	return { li, atStart: before.toString() === "", atEnd: after.toString() === "" };
}

function handleListFoldMouseDown(e){
	if ( !document.body.classList.contains("list-folding") || e.button !== 0 ) { return }
	const li = listItemAtFoldArrow(e);
	if ( !li ) { return }
	e.preventDefault();
	toggleListFold(li);
}

function handleListFoldEnter(e){
	// a new item made in a collapsed one would land among its hidden items: Enter opens it up first
	if ( e.key !== "Enter" || e.shiftKey || e.isComposing || e.defaultPrevented ) { return }
	if ( !document.body.classList.contains("list-folding") ) { return }
	const editor = e.target.closest?.(".editor");
	const caret = editor && caretItem(editor);
	if ( caret && isCollapsedItem(caret.li) ) { caret.li.removeAttribute("data-collapsed") }
}

function handleListFoldDelete(e){
	// deleting into a hidden item would change it unseen: it shows up first
	if ( e.inputType !== "deleteContentBackward" && e.inputType !== "deleteContentForward" ) { return }
	if ( !document.body.classList.contains("list-folding") ) { return }
	const editor = e.target.closest?.(".editor");
	if ( !editor ) { return }
	const item = caretItem(editor);
	if ( e.inputType === "deleteContentForward" ) {
		if ( item?.atEnd && isCollapsedItem(item.li) ) { item.li.removeAttribute("data-collapsed") }
		return
	}
	// Backspace at the start of a line goes into the last line shown above it
	if ( item ) {
		if ( item.atStart && item.li.previousElementSibling?.nodeName === "LI" ) { unfoldLastItems(item.li.previousElementSibling) }
		return
	}
	const line = caretLine(editor);
	const above = line?.atStart && line.line.previousElementSibling;
	if ( above?.nodeName === "UL" || above?.nodeName === "OL" ) { unfoldLastItems(above.lastElementChild) }
}

function handleListFoldSelectionChange(){
	// the caret moved into a hidden item (vi, or an edit like Tab nesting an item into a collapsed one): it shows up
	if ( !document.body.classList.contains("list-folding") ) { return }
	const selection = window.getSelection();
	if ( !selection.rangeCount || !selection.isCollapsed ) { return }
	const node = selection.anchorNode;
	if ( elementOf(node)?.closest("#editor-grid .editor") ) { unfoldListsAround(node) }
}

function listFoldingSettingsHtml(){
	// the Lists section of Settings (createSettingsModal, script.js)
	return `
	<h3>Lists</h3>
	<div class="stack">
		<label class="check"><input id="setting-list-folding" type="checkbox"${listFoldingEnabled() ? " checked" : ""}>Collapse and expand list items with nested items</label>
		<p class="muted small">Click the arrow left of an item's bullet or checkbox. Collapsed items are saved with the document; turned off, everything shows.</p>
	</div>`;
}

// capture: opens the section before script.js handles the Enter (handleHeadingBreakEnter)
document.getElementById("editor-grid").addEventListener("keydown", handleFoldEnter, true);
document.getElementById("editor-grid").addEventListener("keydown", handleListFoldEnter, true);
document.getElementById("editor-grid").addEventListener("mousedown", handleFoldMouseDown);
document.getElementById("editor-grid").addEventListener("mousedown", handleListFoldMouseDown);
document.getElementById("editor-grid").addEventListener("beforeinput", handleFoldDelete, true);
document.getElementById("editor-grid").addEventListener("beforeinput", handleListFoldDelete, true);
document.addEventListener("selectionchange", handleListFoldSelectionChange);
document.getElementById("editor-grid").addEventListener("input", (e) => {
	const editor = e.target.closest?.(".editor");
	if ( !editor ) { return }
	applyHeadingFolds(editor);
	normalizeListFolds(editor);
});
applyFoldingSettings();
document.querySelectorAll("#editor-grid .editor").forEach(normalizeListFolds);
