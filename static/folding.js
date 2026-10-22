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
 *
 * Settings > Save folding state > Document (saveDocumentFoldsKey, script.js): turned off, collapsing and expanding doesn't
 * change the document (no unsaved changes, no autosave) and the document is saved without its folds; folds it was saved
 * with before still show when it opens. The Contents setting there is the table of contents' (toc.js).
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

function documentFoldsSaved(){
	// on until turned off
	return !validateUserConsent(false) || localStorage.getItem(saveDocumentFoldsKey) !== "0";
}

function foldsChanged(editor){
	// the folds are part of the document when they are saved with it: it changed like after an edit (unsaved tab, autosave)
	if ( !documentFoldsSaved() ) { return }
	editor.dispatchEvent(new Event("input", { bubbles: true }));
	if ( editor.id === "editor" ) { performAutoSave() }
}

function withoutFolds(html){
	// a document as it is saved when its folds aren't
	const template = document.createElement("template");
	template.innerHTML = html;
	template.content.querySelectorAll("[data-collapsed]").forEach((el) => el.removeAttribute("data-collapsed"));
	template.content.querySelectorAll(".fold-hidden").forEach((el) => {
		el.classList.remove("fold-hidden");
		if ( !el.classList.length ) { el.removeAttribute("class") }
	});
	return template.innerHTML;
}

function foldStateSettingsHtml(){
	// the Save folding state section of Settings (createSettingsModal, script.js)
	return `
		<label class="check"><input id="setting-save-contents-folds" type="checkbox"${contentsFoldsSaved() ? " checked" : ""}>Contents</label>
		<p class="muted small">What is collapsed in the table of contents is remembered for each document, on this device.</p>
		<label class="check"><input id="setting-save-document-folds" type="checkbox"${documentFoldsSaved() ? " checked" : ""}>Document</label>
		<p class="muted small">Collapsed headings and list items are saved with the document; turned off, collapsing doesn't change the document and it is saved with everything expanded.</p>`;
}

function initFoldStateSettings(){
	document.getElementById("setting-save-contents-folds").addEventListener("change", (e) => {
		if ( !validateUserConsent() ) { e.target.checked = !e.target.checked; return }
		localStorage.setItem(saveContentsFoldsKey, e.target.checked ? "1" : "0");
		// turned off, what was remembered is forgotten (toc.js); this visit's folds stay
		if ( !e.target.checked ) { localStorage.removeItem(tocFoldsKey) }
		if ( typeof handleRemoteAutosave !== "undefined" ) { handleRemoteAutosave() } // the setting goes to the cloud with the notebook
	});
	document.getElementById("setting-save-document-folds").addEventListener("change", (e) => {
		if ( !validateUserConsent() ) { e.target.checked = !e.target.checked; return }
		localStorage.setItem(saveDocumentFoldsKey, e.target.checked ? "1" : "0");
		if ( typeof handleRemoteAutosave !== "undefined" ) { handleRemoteAutosave() } // the setting goes to the cloud with the notebook
	});
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
	foldsChanged(editor);
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


// list folding: an item's nested lists are inside it, or right after it as Tab (execCommand("indent")) makes them
// (nestedListsOf, listOwner in script.js); nothing is moved while editing, the browser's undo goes on working
function elementOf(node){
	return node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
}

function foldedLists(li){
	return nestedListsOf(li).filter((list) => list.querySelector(":scope > li"));
}

function isFoldableItem(el){
	return el?.nodeName === "LI" && Boolean(el.closest(".editor")) && foldedLists(el).length > 0;
}

function isCollapsedItem(el){
	return el?.nodeName === "LI" && el.dataset.collapsed === "true";
}

function hasListInside(li){
	return [...li.children].some((el) => isListElement(el) && el.querySelector(":scope > li"));
}

function onFoldArrow(li, e){
	// the arrow is left of the item's bullet or checkbox (styles.css): on its first line when the list is in the item,
	// on its last one (right above the list) when the list comes after it; the checkbox's gutter (checklist.js)
	// starts at 1.9em left of the item, the arrow's ends there
	const rect = li.getBoundingClientRect();
	const style = getComputedStyle(li);
	const fontSize = parseFloat(style.fontSize) || 16;
	const lineHeight = parseFloat(style.lineHeight) || fontSize * 1.5;
	const inGutter = e.clientX < rect.left - fontSize * 1.9 && e.clientX >= rect.left - fontSize * 3;
	const top = hasListInside(li) ? rect.top : rect.bottom - lineHeight;
	return inGutter && e.clientY >= top && e.clientY <= top + lineHeight;
}

function listItemAtFoldArrow(e){
	// the arrow is the nested list's ::before, so a click lands on that list, the item, or (next to it) its own list
	const target = elementOf(e.target);
	if ( !target?.closest(".editor") ) { return null }
	const candidates = new Set();
	for ( let el = target; el && !el.classList.contains("editor"); el = el.parentElement ) {
		if ( el.nodeName === "LI" ) { candidates.add(el) }
		if ( isListElement(el) ) {
			[...el.children].forEach((li) => candidates.add(li));
			if ( listOwner(el) ) { candidates.add(listOwner(el)) }
		}
	}
	return [...candidates].find((li) => isFoldableItem(li) && onFoldArrow(li, e)) || null;
}

function hidingItems(node){
	// the items whose nested lists node is in, nearest first
	const items = [];
	for ( let el = elementOf(node); el && !el.classList.contains("editor"); el = el.parentElement ) {
		const owner = isListElement(el) && listOwner(el);
		if ( owner ) { items.push(owner) }
	}
	return items;
}

function unfoldListsAround(node){
	// expands the collapsed items that hide node
	let changed = false;
	for ( const li of hidingItems(node) ) {
		if ( isCollapsedItem(li) ) {
			li.removeAttribute("data-collapsed");
			changed = true;
		}
	}
	return changed;
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
	if ( isCollapsedItem(li) && selection.rangeCount && hidingItems(selection.anchorNode).includes(li) ) {
		const caret = document.createRange();
		const inside = [...li.children].find(isListElement);
		inside ? caret.setStartBefore(inside) : caret.setStart(li, li.childNodes.length);
		caret.collapse(true);
		selection.removeAllRanges();
		selection.addRange(caret);
	}
	foldsChanged(editor);
}

function unfoldChecklists(root){
	// every checklist item of the document (an editor, or a stored one being changed) expanded; the number changed
	const items = [...root.querySelectorAll(`${taskItemSelector}[data-collapsed]`)];
	items.forEach((li) => li.removeAttribute("data-collapsed"));
	return items.length;
}

function foldCompletedChecklists(root){
	// every checked item with nested items collapsed; the number changed
	const items = [...root.querySelectorAll('li[data-checked="true"]')].filter((li) => !isCollapsedItem(li) && foldedLists(li).length);
	items.forEach((li) => { li.dataset.collapsed = "true" });
	if ( root.classList?.contains("editor") ) { caretOutOfFolds(root) }
	return items.length;
}

function caretOutOfFolds(editor){
	// a caret left in an item that got collapsed goes to the end of the outermost such item's own text
	const selection = window.getSelection();
	if ( !selection.rangeCount || !editor.contains(selection.anchorNode) ) { return }
	const li = hidingItems(selection.anchorNode).filter(isCollapsedItem).at(-1);
	if ( !li ) { return }
	const caret = document.createRange();
	const inside = [...li.children].find(isListElement);
	inside ? caret.setStartBefore(inside) : caret.setStart(li, li.childNodes.length);
	caret.collapse(true);
	selection.removeAllRanges();
	selection.addRange(caret);
}

function normalizeListFolds(editor){
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
	const inside = [...li.children].find(isListElement);
	inside ? after.setEndBefore(inside) : after.setEnd(li, li.childNodes.length);
	return { li, atStart: before.toString() === "", atEnd: after.toString() === "" };
}

function lineAbove(editor){
	// the element of the line Backspace at the start of the caret's line goes into: an item, or a block of the editor
	const item = caretItem(editor);
	if ( item ) { return item.atStart ? item.li.previousElementSibling : null }
	const line = caretLine(editor);
	return line?.atStart ? line.line.previousElementSibling : null;
}

function unfoldBeforeIndent(editor){
	// Tab (or vi's >>) nests the caret's item under the item above: when that one is collapsed, the item would go
	// into its hidden items and the browser would take the caret away, so it opens up first
	const li = elementOf(window.getSelection().anchorNode)?.closest("li");
	if ( !li || !editor.contains(li) ) { return }
	const above = li.previousElementSibling;
	const owner = isListElement(above) ? listOwner(above) : above;
	if ( isCollapsedItem(owner) ) { owner.removeAttribute("data-collapsed") }
}

function handleListFoldTab(e){
	if ( e.key !== "Tab" || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey || e.defaultPrevented ) { return }
	if ( document.body.classList.contains("vi-block-caret") ) { return } // vi's NORMAL: Tab checks the item, >> nests it
	const editor = e.target.closest?.(".editor");
	if ( editor && window.getSelection().rangeCount ) { unfoldBeforeIndent(editor) }
}

function handleListFoldMouseDown(e){
	if ( !document.body.classList.contains("list-folding") || e.button !== 0 ) { return }
	const li = listItemAtFoldArrow(e);
	if ( !li ) { return }
	e.preventDefault();
	toggleListFold(li);
}

function openItemAfterFold(editor, li){
	// a new item after a collapsed one and all its hidden items, at its level, the caret in it; it stays collapsed.
	// Made with execCommand where the browser puts it there, so undo takes it back
	const unit = listItemUnit(li); // script.js
	const list = li.parentElement;
	if ( !isFoldableItem(li) || !isListElement(list) ) { return false }
	// the browser doesn't edit hidden items as shown ones: it is open while the item is made
	li.removeAttribute("data-collapsed");
	const selection = window.getSelection();
	const state = li.hasAttribute("data-checked") ? ' data-checked="false"' : "";
	const items = new Set(editor.querySelectorAll("li"));
	selection.collapse(list, [...list.childNodes].indexOf(unit.at(-1)) + 1);
	document.execCommand("insertHTML", false, `<li${state}><br></li>`);
	const made = [...editor.querySelectorAll("li")].filter((el) => !items.has(el));
	let item = made.length === 1 && made[0].parentElement === list ? made[0] : null;
	if ( !item ) {
		// at the end of its list the browser puts it into the last nested list: by hand (as openLineByTable, vi.js)
		if ( made.length ) { document.execCommand("undo") }
		item = document.createElement("li");
		item.appendChild(document.createElement("br"));
		unit.at(-1).after(item);
	}
	// Safari leaves the caret in the item after it
	selection.collapse(item, 0);
	item.removeAttribute("data-collapsed");
	// a new item of a checklist is an unchecked one (checklist.js)
	state ? item.dataset.checked = "false" : item.removeAttribute("data-checked");
	li.dataset.collapsed = "true";
	editor.dispatchEvent(new Event("input", { bubbles: true }));
	return true;
}

function handleListFoldEnter(e){
	// Enter at the end of a collapsed item makes the next item after its hidden ones; elsewhere in it, a new item
	// would land among its hidden items: it opens up first
	if ( e.key !== "Enter" || e.shiftKey || e.isComposing || e.defaultPrevented ) { return }
	if ( !document.body.classList.contains("list-folding") ) { return }
	const editor = e.target.closest?.(".editor");
	const caret = editor && caretItem(editor);
	if ( !caret || !isCollapsedItem(caret.li) ) { return }
	if ( caret.atEnd && !caret.atStart ) {
		e.preventDefault();
		e.stopImmediatePropagation();
		openItemAfterFold(editor, caret.li);
		return
	}
	caret.li.removeAttribute("data-collapsed");
}

function handleListFoldDelete(e){
	// deleting into a hidden item would change it unseen: it shows up first
	if ( e.inputType !== "deleteContentBackward" && e.inputType !== "deleteContentForward" ) { return }
	if ( !document.body.classList.contains("list-folding") ) { return }
	const editor = e.target.closest?.(".editor");
	if ( !editor ) { return }
	if ( e.inputType === "deleteContentForward" ) {
		const item = caretItem(editor);
		if ( item?.atEnd && isCollapsedItem(item.li) ) { item.li.removeAttribute("data-collapsed") }
		return
	}
	// Backspace at the start of a line goes into the last line above it, maybe a hidden one
	const above = lineAbove(editor);
	if ( !above ) { return }
	const last = [...above.querySelectorAll("li")].at(-1) || above;
	unfoldListsAround(last);
	if ( isCollapsedItem(above) ) { above.removeAttribute("data-collapsed") }
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
	// goes in the Lists section of Settings (createSettingsModal, script.js)
	return `
		<label class="check"><input id="setting-list-folding" type="checkbox"${listFoldingEnabled() ? " checked" : ""}>Collapse and expand list items with nested items</label>
		<p class="muted small">Click the arrow left of an item's bullet or checkbox. Collapsed items are saved with the document; turned off, everything shows.</p>`;
}

// capture: opens the section before script.js handles the Enter (handleHeadingBreakEnter)
document.getElementById("editor-grid").addEventListener("keydown", handleFoldEnter, true);
document.getElementById("editor-grid").addEventListener("keydown", handleListFoldEnter, true);
document.getElementById("editor-grid").addEventListener("keydown", handleListFoldTab, true);
document.getElementById("editor-grid").addEventListener("mousedown", handleFoldMouseDown);
document.getElementById("editor-grid").addEventListener("mousedown", handleListFoldMouseDown);
document.getElementById("editor-grid").addEventListener("beforeinput", handleFoldDelete, true);
document.getElementById("editor-grid").addEventListener("beforeinput", handleListFoldDelete, true);
document.addEventListener("selectionchange", handleListFoldSelectionChange);
document.getElementById("editor-grid").addEventListener("input", (e) => {
	const editor = e.target.closest?.(".editor");
	if ( !editor ) { return }
	moveRulesOutOfLines(editor); // script.js
	applyHeadingFolds(editor);
	normalizeListFolds(editor);
});
applyFoldingSettings();
document.querySelectorAll("#editor-grid .editor").forEach((editor) => {
	moveListsOutOfItems(editor);
	moveHeadingsOutOfLines(editor);
	moveRulesOutOfLines(editor);
	applyHeadingFolds(editor);
	normalizeListFolds(editor);
});
