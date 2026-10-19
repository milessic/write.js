/*
 * Checklists: an item of a bulleted list (<ul><li>) with data-checked="false" / "true" is a checklist item, so a list
 * can mix bullets and checkboxes and every list behaviour (Enter, Backspace, Tab nesting, Shift+Tab) stays the browser's.
 * The checkbox is the item's ::before (styles.css): a click on it, or Ctrl/Cmd+Enter in the item, toggles it.
 * The state is the attribute, so it is saved with the document, goes to the cloud, and to Markdown as "- [ ]" / "- [x]".
 * Documents from before keep working: their <input type="checkbox"> + span lines are turned into items when loaded.
 * Copied, checklist items are Markdown text ("- [ ] a", "- [x] a", nested by 4 spaces); Markdown checklist lines
 * ("- [ ]", "- []", "- [x]") pasted outside of a list become a checklist (into a list, script.js's paste takes them).
 */
const taskItemSelector = "li[data-checked]";
let paragraphSnapshot = null; // the editor's items before an Enter, to tell which item the browser just made
let markerItem = null; // the item just made from a typed "- [ ]": the space typed after the marker isn't its text

function isTaskItem(el){
	return el?.nodeName === "LI" && el.hasAttribute("data-checked");
}

function isChecked(li){
	return li.dataset.checked === "true";
}

function selectedListItems(editor){
	// the <li>s of the caret's or the selection's lines; a parent item only if the selection is in its own text
	const selection = window.getSelection();
	if ( !selection.rangeCount ) { return [] }
	const range = selection.getRangeAt(0);
	if ( !editor.contains(range.commonAncestorContainer) ) { return [] }
	const itemOf = (node) => (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement)?.closest("li");
	const start = itemOf(range.startContainer);
	if ( range.collapsed ) { return start && editor.contains(start) ? [start] : [] }
	const items = [...editor.querySelectorAll("li")].filter((li) => range.intersectsNode(li));
	return items.filter((li) => li === start || !items.some((other) => other !== li && li.contains(other)));
}

function selectionInBulletList(editor){
	// both ends of the selection are in items of bulleted lists
	const selection = window.getSelection();
	if ( !selection.rangeCount ) { return false }
	const range = selection.getRangeAt(0);
	const inBullet = (node) => (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement)?.closest("li")?.parentElement?.nodeName === "UL";
	return editor.contains(range.commonAncestorContainer) && inBullet(range.startContainer) && inBullet(range.endContainer);
}

function selectionHasTaskItems(editor){
	return selectedListItems(editor).some((li) => isTaskItem(li) || li.querySelector(taskItemSelector));
}

function makeTaskItems(checked=null){
	// the selected lines become checklist items: lines are put in a list first, bullets get a checkbox;
	// items that already have one keep their state, unless checked is given
	restoreEditorSelection();
	const editor = document.getElementById("editor");
	if ( !selectionInBulletList(editor) ) { document.execCommand("insertUnorderedList", false, null) }
	const items = selectedListItems(editor).filter((li) => li.parentElement?.nodeName === "UL");
	for ( const li of items ) {
		if ( checked !== null || !isTaskItem(li) ) { li.dataset.checked = String(Boolean(checked)) }
	}
	normalizeChecklists(editor);
	return items;
}

function makeTaskItemFromMarker(checked){
	// autodetect.js: "- [ ]" or "- [x]" typed at the start of a line
	markerItem = makeTaskItems(checked)[0] || null;
}

function toggleChecklist(){
	// the toolbar's Checklist: on checklist items it takes the lines out of the list, like Bulleted list does
	restoreEditorSelection();
	const editor = document.getElementById("editor");
	const items = selectionInBulletList(editor) ? selectedListItems(editor) : [];
	if ( items.length && items.every(isTaskItem) ) {
		items.forEach((li) => li.removeAttribute("data-checked"));
		document.execCommand("insertUnorderedList", false, null);
		normalizeChecklists(editor);
		return
	}
	makeTaskItems();
}

function taskItemsToBullets(){
	// the toolbar's Bulleted list on checklist items turns them into bullets (instead of taking them out of the list)
	restoreEditorSelection();
	const editor = document.getElementById("editor");
	if ( !selectionInBulletList(editor) ) { return false }
	const items = selectedListItems(editor).filter(isTaskItem);
	items.forEach((li) => li.removeAttribute("data-checked"));
	return items.length > 0;
}

function autoCheckParentsEnabled(){
	// on until turned off
	return !validateUserConsent(false) || localStorage.getItem(autoCheckParentsKey) !== "0";
}

function childTaskItems(li){
	// the checklist items of the lists nested under li (not the ones nested deeper)
	return nestedListsOf(li).flatMap((list) => [...list.children].filter(isTaskItem));
}

function parentItem(li){
	return isListElement(li.parentElement) ? listOwner(li.parentElement) : null;
}

function updateParentTaskItems(items){
	// a checklist item with checklist items nested in it is checked when all of them are, unchecked when one isn't;
	// the items it is nested in follow. Checked by hand, it stays so until one of its items changes
	for ( const item of items ) {
		for ( let parent = parentItem(item); isTaskItem(parent); parent = parentItem(parent) ) {
			const children = childTaskItems(parent);
			const checked = String(children.length > 0 && children.every(isChecked));
			if ( !children.length || parent.dataset.checked === checked ) { break }
			parent.dataset.checked = checked;
		}
	}
}

function setTaskItemsChecked(items, checked){
	const editors = new Set();
	for ( const li of items ) {
		li.dataset.checked = String(checked);
		editors.add(li.closest(".editor"));
	}
	if ( autoCheckParentsEnabled() ) { updateParentTaskItems(items) }
	// the state is part of the document: it changed like after an edit (unsaved tab, autosave)
	for ( const editor of editors ) {
		if ( !editor ) { continue }
		editor.dispatchEvent(new Event("input", { bubbles: true }));
		if ( editor.id === "editor" ) { performAutoSave() }
	}
}

function autoCheckParentsSettingsHtml(){
	// goes in the Lists section of Settings (createSettingsModal, script.js)
	return `
		<label class="check"><input id="setting-auto-check-parents" type="checkbox"${autoCheckParentsEnabled() ? " checked" : ""}>Check a checklist item when all the items nested in it are checked</label>
		<p class="muted small">Unchecking one of them unchecks it again.</p>`;
}

function initAutoCheckParentsSettings(){
	document.getElementById("setting-auto-check-parents").addEventListener("change", (e) => {
		if ( !validateUserConsent() ) { e.target.checked = !e.target.checked; return }
		localStorage.setItem(autoCheckParentsKey, e.target.checked ? "1" : "0");
		if ( typeof handleRemoteAutosave !== "undefined" ) { handleRemoteAutosave() } // the setting goes to the cloud with the notebook
	});
}

function taskItemAtCheckbox(e){
	// the checkbox is the item's ::before, in the list's gutter left of its first line; a click next to the box
	// lands on the list itself
	const target = e.target.nodeType === Node.ELEMENT_NODE ? e.target : e.target.parentElement;
	if ( !target?.closest(".editor") ) { return null }
	const candidates = target.nodeName === "UL" ? [...target.children].filter(isTaskItem) : [target.closest(taskItemSelector)];
	return candidates.find((li) => li && onCheckbox(li, e)) || null;
}

function onCheckbox(li, e){
	const rect = li.getBoundingClientRect();
	const style = getComputedStyle(li);
	const fontSize = parseFloat(style.fontSize) || 16;
	const lineHeight = parseFloat(style.lineHeight) || fontSize * 1.5;
	const inGutter = e.clientX < rect.left + 2 && e.clientX >= rect.left - fontSize * 1.9;
	const onFirstLine = e.clientY >= rect.top && e.clientY <= rect.top + lineHeight;
	return inGutter && onFirstLine;
}

function handleChecklistMouseDown(e){
	if ( e.button !== 0 ) { return }
	const li = taskItemAtCheckbox(e);
	if ( !li ) { return }
	// the caret (and the phone keyboard) stays where it was
	e.preventDefault();
	setTaskItemsChecked([li], !isChecked(li));
}

// iOS Safari ignores a cancelled mousedown (it comes after the tap): the caret still moves to the tap and the editor
// scrolls to it. A tap on the checkbox is handled at touchend instead; cancelling it stops the mouse events, the focus
// and the caret move. A touch that moved is a scroll and is left alone
let checkboxTouch = null;

function handleChecklistTouchStart(e){
	const touch = e.touches.length === 1 ? e.touches[0] : null;
	checkboxTouch = touch && { x: touch.clientX, y: touch.clientY };
}

function handleChecklistTouchEnd(e){
	const start = checkboxTouch;
	checkboxTouch = null;
	const touch = e.changedTouches[0];
	if ( !start || !touch || e.touches.length || Math.hypot(touch.clientX - start.x, touch.clientY - start.y) > 10 ) { return }
	const li = taskItemAtCheckbox({ target: touch.target, clientX: touch.clientX, clientY: touch.clientY });
	if ( !li ) { return }
	e.preventDefault();
	setTaskItemsChecked([li], !isChecked(li));
}

function handleChecklistKeydown(e){
	// Ctrl/Cmd+Enter toggles the selected checklist items: all checked when any isn't, else all unchecked
	if ( e.key !== "Enter" || !(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.isComposing ) { return }
	const editor = e.target.closest?.(".editor");
	const items = editor ? selectedListItems(editor).filter(isTaskItem) : [];
	if ( !items.length ) { return }
	e.preventDefault();
	e.stopPropagation();
	setTaskItemsChecked(items, !items.every(isChecked));
}

function takeChecklistSnapshot(editor){
	const selection = window.getSelection();
	const node = selection.rangeCount ? selection.getRangeAt(0).startContainer : null;
	const item = node && (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement)?.closest("li");
	if ( !isTaskItem(item) ) { return { editor, item: null } }
	return { editor, item, text: item.textContent, checked: item.dataset.checked, items: new Set(editor.querySelectorAll("li")) };
}

function fixNewTaskItems(snapshot){
	// Enter in a checklist item splits it: both parts are checklist items (the browser copies the attribute, or not),
	// the part with the item's text keeps its state and the new one starts unchecked
	if ( !snapshot?.item ) { return }
	const created = [...snapshot.editor.querySelectorAll("li")].filter((li) => !snapshot.items.has(li));
	const parts = [snapshot.item, ...created].filter((li) => li.isConnected && li.parentElement?.nodeName === "UL");
	if ( !created.length || !parts.length ) { return }
	const keeper = parts.find((li) => li.textContent !== "" && snapshot.text.startsWith(li.textContent))
		|| (parts.includes(snapshot.item) ? snapshot.item : null);
	for ( const li of parts ) {
		li.dataset.checked = li === keeper ? snapshot.checked : "false";
	}
}

function withNewTaskItemsUnchecked(editor, fn){
	// for edits made with execCommand (vi's o / O), which the beforeinput below doesn't see
	const snapshot = takeChecklistSnapshot(editor);
	fn();
	fixNewTaskItems(snapshot);
}

function keepTaskItemState(fn){
	// Tab / Shift+Tab move the caret's item in or out of a nested list; it stays a checklist item if it is still an item
	const editor = document.getElementById("editor");
	const before = selectedListItems(editor).filter(isTaskItem).map((li) => [li.textContent, li.dataset.checked]);
	fn();
	const after = selectedListItems(editor);
	if ( before.length !== 1 || after.length !== 1 ) { return }
	const [text, checked] = before[0];
	const li = after[0];
	if ( !isTaskItem(li) && li.parentElement?.nodeName === "UL" && li.textContent === text ) { li.dataset.checked = checked }
}

function emptyItemMerge(editor, inputType){
	// Backspace at the start of an item under an empty one (or Delete in an empty item above one): the browser keeps
	// the empty item and moves the text into it; the text's state goes with it
	const selection = window.getSelection();
	if ( !selection.rangeCount || !selection.isCollapsed ) { return null }
	const range = selection.getRangeAt(0);
	const li = (range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer : range.startContainer.parentElement)?.closest("li");
	if ( !li || !editor.contains(li) ) { return null }
	const edge = document.createRange();
	edge.selectNodeContents(li);
	inputType === "deleteContentBackward" ? edge.setEnd(range.startContainer, range.startOffset) : edge.setStart(range.startContainer, range.startOffset);
	if ( edge.toString() !== "" ) { return null }
	const [empty, item] = inputType === "deleteContentBackward" ? [li.previousElementSibling, li] : [li, li.nextElementSibling];
	if ( empty?.nodeName !== "LI" || empty.textContent !== "" || !isTaskItem(item) || item.textContent === "" ) { return null }
	return { editor, text: item.textContent, checked: item.dataset.checked };
}

function handleChecklistBeforeInput(e){
	const editor = e.target.closest?.(".editor");
	paragraphSnapshot = null;
	const marker = markerItem;
	markerItem = null;
	if ( !editor || e.defaultPrevented ) { return }
	if ( e.inputType === "insertText" && e.data === " " && marker?.textContent === "" && selectedListItems(editor)[0] === marker ) {
		e.preventDefault();
		return
	}
	if ( e.inputType === "insertParagraph" ) {
		paragraphSnapshot = takeChecklistSnapshot(editor);
	} else if ( e.inputType === "deleteContentBackward" || e.inputType === "deleteContentForward" ) {
		paragraphSnapshot = emptyItemMerge(editor, e.inputType);
		if ( paragraphSnapshot ) { paragraphSnapshot.merge = true }
	}
}

function handleChecklistInput(e){
	const editor = e.target.closest?.(".editor");
	if ( !editor ) { return }
	if ( paragraphSnapshot?.editor === editor ) {
		if ( paragraphSnapshot.merge ) {
			const li = selectedListItems(editor)[0];
			if ( li?.parentElement?.nodeName === "UL" && li.textContent === paragraphSnapshot.text ) { li.dataset.checked = paragraphSnapshot.checked }
		} else if ( e.inputType === "insertParagraph" ) {
			fixNewTaskItems(paragraphSnapshot);
		}
	}
	paragraphSnapshot = null;
	normalizeChecklists(editor);
}

function normalizeChecklists(editor){
	// only items of bulleted lists can be checklist items: a list turned numbered, or an item taken out of its list, loses it
	migrateLegacyCheckboxes(editor);
	for ( const el of editor.querySelectorAll("[data-checked]") ) {
		if ( el.nodeName !== "LI" || el.parentElement?.nodeName !== "UL" ) {
			el.removeAttribute("data-checked");
		} else if ( el.dataset.checked !== "true" && el.dataset.checked !== "false" ) {
			el.dataset.checked = "false";
		}
	}
	// checklist items are only ever Text: a heading in one, or around its list (pasted, or from before), goes away
	for ( const heading of editor.querySelectorAll("h1, h2, h3, h4, h5, h6") ) {
		if ( !heading.closest(taskItemSelector) && !heading.querySelector(taskItemSelector) ) { continue }
		const hr = heading.nextElementSibling;
		if ( typeof isHeadingBreak !== "undefined" && isHeadingBreak(hr) ) { hr.remove() }
		heading.replaceWith(...heading.childNodes);
	}
}


// documents from before: <input type="checkbox" onclick=...> followed by a <span contenteditable> with the item's text,
// one per line, sometimes inside a wrapper <span>
function hasContent(node){
	return node.textContent.trim() !== "" || Boolean(node.querySelector?.("img, hr, iframe, video, input"));
}

function takeLegacyItemContent(box, li){
	// what follows the checkbox up to the end of its line: a <br>, a new line in the text, a block or the next checkbox
	let node = box.nextSibling;
	let parent = box.parentNode;
	while ( true ) {
		if ( !node ) {
			// the end of a wrapper span: the line goes on after it
			if ( parent.nodeType !== Node.ELEMENT_NODE || parent.classList?.contains("editor") || isBlockNode(parent) ) { return }
			node = parent.nextSibling;
			parent = parent.parentNode;
			continue
		}
		const next = node.nextSibling;
		if ( node.nodeName === "BR" ) { node.remove(); return }
		if ( isBlockNode(node) || node.nodeName === "INPUT" || node.querySelector?.('input[type="checkbox"]') ) { return }
		if ( node.nodeType === Node.TEXT_NODE && node.textContent.includes("\n") ) {
			const at = node.textContent.indexOf("\n");
			const rest = node.splitText(at);
			rest.textContent = rest.textContent.slice(1);
			if ( !rest.textContent ) { rest.remove() }
			li.appendChild(node);
			return
		}
		li.appendChild(node);
		node = next;
	}
}

function liftToEditor(editor, li){
	// puts the item in its own list under the editor; what was before and after it on its line stays as lines around it
	let top = li;
	while ( top.parentNode !== editor ) { top = top.parentNode }
	const ul = document.createElement("ul");
	if ( top === li ) {
		li.before(ul);
		ul.appendChild(li);
		return ul
	}
	const after = document.createRange();
	after.setStartAfter(li);
	after.setEnd(top, top.childNodes.length);
	const rest = after.extractContents();
	li.remove();
	top.after(ul);
	ul.appendChild(li);
	if ( hasContent(rest) ) {
		const line = isBlockNode(top) ? top.cloneNode(false) : document.createElement("div");
		line.appendChild(rest);
		ul.after(line);
	}
	if ( !hasContent(top) ) { top.remove() }
	return ul
}

function migrateLegacyCheckboxes(editor){
	const boxes = [...editor.querySelectorAll('input[type="checkbox"]')];
	if ( !boxes.length ) { return }
	const lists = new Set();
	for ( const box of boxes ) {
		if ( !editor.contains(box) ) { continue }
		const checked = String(box.checked || box.hasAttribute("checked"));
		const owner = box.parentElement.closest("li");
		let li;
		if ( owner && editor.contains(owner) ) {
			// already in a list item (from a Markdown import): the item becomes the checklist item
			li = owner;
			box.remove();
		} else {
			li = document.createElement("li");
			takeLegacyItemContent(box, li);
			box.replaceWith(li);
			lists.add(liftToEditor(editor, li));
		}
		li.dataset.checked = checked;
		li.querySelectorAll("[contenteditable]").forEach((el) => el.removeAttribute("contenteditable"));
		li.querySelectorAll('span[id^="editor-checkbox"]').forEach((span) => span.replaceWith(...span.childNodes));
		li.removeAttribute("class");
		li.removeAttribute("style");
		// the spaces the old checkbox put before its text
		const first = li.firstChild;
		if ( first?.nodeType === Node.TEXT_NODE ) {
			first.textContent = first.textContent.replace(/^[  ]+/, "");
			if ( !first.textContent ) { first.remove() }
		}
		if ( !li.firstChild ) { li.appendChild(document.createElement("br")) }
	}
	// the lines of one checklist make one list
	for ( const ul of lists ) {
		let prev = ul.previousSibling;
		while ( prev?.nodeType === Node.TEXT_NODE && prev.textContent.trim() === "" ) {
			const blank = prev;
			prev = prev.previousSibling;
			blank.remove();
		}
		if ( prev?.nodeName === "UL" && lists.has(prev) ) {
			prev.append(...ul.childNodes);
			ul.remove();
			lists.delete(ul);
		}
	}
}

function markdownTaskItemsToChecklist(html){
	// showdown's task list items: <li class="task-list-item"><input type="checkbox" disabled [checked]> text</li>
	const template = document.createElement("template");
	template.innerHTML = html;
	for ( const li of template.content.querySelectorAll("li.task-list-item") ) {
		const box = li.querySelector(':scope > input[type="checkbox"]');
		li.dataset.checked = String(Boolean(box?.hasAttribute("checked")));
		box?.remove();
		li.removeAttribute("class");
		li.removeAttribute("style");
		const first = li.firstChild;
		if ( first?.nodeType === Node.TEXT_NODE ) { first.textContent = first.textContent.replace(/^\s+/, "") }
	}
	return template.innerHTML;
}

const plainTextBlockTags = new Set(["DIV", "P", "H1", "H2", "H3", "H4", "H5", "H6", "PRE", "BLOCKQUOTE"]);

function selectionWithListContext(range, editor){
	// the selected nodes inside clones of the lists and items around them, so the items keep their depth and checkbox
	let fragment = range.cloneContents();
	const container = range.commonAncestorContainer;
	let el = container.nodeType === Node.ELEMENT_NODE ? container : container.parentElement;
	for ( ; el && el !== editor; el = el.parentElement ) {
		if ( el.nodeName !== "LI" && !isListElement(el) ) { continue }
		const wrapper = el.cloneNode(false);
		wrapper.append(fragment);
		fragment = wrapper;
	}
	const root = document.createElement("div");
	root.append(fragment);
	return root;
}

function checklistPlainText(root){
	// the copied lines as text, list items with their Markdown marker, nested ones indented by 4 spaces
	const lines = []; // {depth, prefix, text}; depth: lists around a list item, 0 for other lines
	let line = null;
	const start = (depth, prefix) => { line = { depth, prefix, text: "" }; lines.push(line) };
	const walk = (node, depth) => {
		for ( const child of node.childNodes ) {
			if ( child.nodeType === Node.TEXT_NODE ) {
				if ( isListElement(node) && child.data.trim() === "" ) { continue }
				if ( !line ) { start(0, "") }
				line.text += child.data;
			} else if ( child.nodeName === "BR" ) {
				if ( !line ) { start(0, "") }
				line = null;
			} else if ( isListElement(child) ) {
				line = null;
				walk(child, depth + 1);
				line = null;
			} else if ( child.nodeName === "LI" ) {
				const number = [...node.children].filter((el) => el.nodeName === "LI").indexOf(child) + 1;
				const marker = isTaskItem(child) ? `- [${isChecked(child) ? "x" : " "}] ` : node.nodeName === "OL" ? `${number}. ` : "- ";
				start(depth, marker);
				walk(child, depth);
				line = null;
			} else if ( child.nodeName === "HR" ) {
				start(0, "---");
				line = null;
			} else if ( plainTextBlockTags.has(child.nodeName) ) {
				line = null;
				walk(child, depth);
				line = null;
			} else if ( child.nodeType === Node.ELEMENT_NODE ) {
				walk(child, depth);
			}
		}
	};
	walk(root, 0);
	const items = lines.filter((l) => l.depth > 0);
	const top = items.length ? Math.min(...items.map((l) => l.depth)) : 0;
	return lines
		.map((l) => (l.depth ? " ".repeat(indentSize * (l.depth - top)) : "") + l.prefix + l.text.replace(/\n+$/, ""))
		.join("\n");
}

function handleChecklistCopy(e){
	// only a selection with checklist items is copied by us; anything else stays the browser's
	const editor = e.target.closest?.(".editor");
	const selection = window.getSelection();
	if ( !editor || !e.clipboardData || !selection.rangeCount || selection.isCollapsed ) { return }
	const range = selection.getRangeAt(0);
	if ( !editor.contains(range.commonAncestorContainer) ) { return }
	const root = selectionWithListContext(range, editor);
	if ( !root.querySelector(taskItemSelector) ) { return }
	e.preventDefault();
	e.clipboardData.setData("text/plain", checklistPlainText(root));
	e.clipboardData.setData("text/html", root.innerHTML);
	if ( e.type === "cut" && editor.isContentEditable ) { document.execCommand("delete") }
}

function handleChecklistPaste(e){
	// a pasted Markdown (or HTML) list with checkboxes, outside of a list, becomes a checklist; into a list,
	// handlePasteListIntoList (script.js) takes it
	if ( e.defaultPrevented ) { return }
	const editor = e.target.closest?.(".editor");
	const selection = window.getSelection();
	if ( !editor || !selection.rangeCount ) { return }
	const range = selection.getRangeAt(0);
	const inList = (node) => (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement)?.closest("li, ul, ol");
	if ( inList(range.startContainer) || inList(range.endContainer) ) { return }
	const html = e.clipboardData?.getData("text/html");
	const items = (html && pastedItemsFromHtml(html)) || pastedItemsFromText(e.clipboardData?.getData("text/plain") || "");
	const hasCheckbox = (list) => list.some((item) => item.checked !== null || hasCheckbox(item.children));
	if ( !items?.length || !hasCheckbox(items) ) { return }
	e.preventDefault();
	const list = items[0].ordered ? "ol" : "ul";
	document.execCommand("insertHTML", false, `<${list}>${pastedItemsHtml(items, false)}</${list}>`);
	normalizeChecklists(editor);
}

// capture: Ctrl/Cmd+Enter is the toggle before any Enter handling
document.getElementById("editor-grid").addEventListener("keydown", handleChecklistKeydown, true);
document.getElementById("editor-grid").addEventListener("mousedown", handleChecklistMouseDown);
document.getElementById("editor-grid").addEventListener("touchstart", handleChecklistTouchStart, {passive: true});
document.getElementById("editor-grid").addEventListener("touchend", handleChecklistTouchEnd, {passive: false});
document.getElementById("editor-grid").addEventListener("beforeinput", handleChecklistBeforeInput);
document.getElementById("editor-grid").addEventListener("input", handleChecklistInput);
document.getElementById("editor-grid").addEventListener("copy", handleChecklistCopy);
document.getElementById("editor-grid").addEventListener("cut", handleChecklistCopy);
document.getElementById("editor-grid").addEventListener("paste", handleChecklistPaste);
document.querySelectorAll("#editor-grid .editor").forEach(normalizeChecklists);
