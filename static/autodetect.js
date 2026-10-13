/*
 * Auto detect: markdown typed into the editor turns into formatting.
 *  - at the start of a line: "* " bullets, "1. " numbers, "- [ ]" / "-[]" a checkbox, "---" a rule, "# " .. "#### " headings
 *  - inline: **bold**, *italic* / _italic_, __underline__, `code` / ``code`` / ```code``` (on the space after it)
 *  - "```" + Enter starts a code block, "```" + Enter on its last line ends it
 * Settings are in Settings > Auto detect and go to the cloud with the notebook (autoDetectKey, script.js).
 * Changes run through execCommand, so Ctrl/Cmd+Z reverts them; inline code and ending a code block can't.
 */
const autoDetectRules = [
	{ id: "bullet", label: "<kbd>*</kbd> + space starts a bulleted list" },
	{ id: "numbered", label: "<kbd>1.</kbd> + space starts a numbered list" },
	{ id: "checkbox", label: "<kbd>- [ ]</kbd> or <kbd>-[]</kbd> inserts a checkbox" },
	{ id: "hr", label: "<kbd>---</kbd> inserts a horizontal rule" },
	{ id: "heading", label: "<kbd>#</kbd> to <kbd>####</kbd> + space makes a heading" },
	{ id: "bold", label: "<kbd>**text**</kbd> makes bold" },
	{ id: "italic", label: "<kbd>*text*</kbd> or <kbd>_text_</kbd> makes italic" },
	{ id: "underline", label: "<kbd>__text__</kbd> makes underline" },
	{ id: "inlineCode", label: "<kbd>`code`</kbd>, <kbd>``code``</kbd> or <kbd>```code```</kbd> and a space makes inline code" },
	{ id: "codeBlock", label: "<kbd>```</kbd> + Enter starts a code block, <kbd>```</kbd> + Enter on its last line ends it" },
];

// the opening mark has to start a word, so 2*3*4 or snake_case_names stay as they are
const autoDetectInline = [
	{ rule: "bold", command: "bold", re: /(?:^|[\s([{"'])(\*\*([^*\s](?:[^*]*[^*\s])?)\*\*)$/ },
	{ rule: "underline", command: "underline", re: /(?:^|[\s([{"'])(__([^_\s](?:[^_]*[^_\s])?)__)$/ },
	{ rule: "italic", command: "italic", re: /(?:^|[\s([{"'])(\*([^*\s](?:[^*]*[^*\s])?)\*)$/ },
	{ rule: "italic", command: "italic", re: /(?:^|[\s([{"'])(_([^_\s](?:[^_]*[^_\s])?)_)$/ },
];
// the same number of backticks on both sides; between two or three, a single backtick can be part of the code
const autoDetectInlineCode = [
	/(?:^|[\s([{"'])((`)([^`]*[^`\s][^`]*)`)$/,
	/(?:^|[\s([{"'])((`{2,3})([^`\s](?:.*[^`\s])?)\2)$/,
];

function readAutoDetectSettings(){
	// {enabled, rules: {id: bool}}; everything is on until turned off
	let stored = {};
	try { stored = JSON.parse(localStorage.getItem(autoDetectKey)) || {} } catch ( err ) {}
	const rules = {};
	for ( const rule of autoDetectRules ) { rules[rule.id] = stored.rules?.[rule.id] !== false }
	return { enabled: stored.enabled !== false, rules };
}

function saveAutoDetectSettings(settings){
	if ( !validateUserConsent() ) { return }
	localStorage.setItem(autoDetectKey, JSON.stringify(settings));
	if ( typeof handleRemoteAutosave !== "undefined" ) { handleRemoteAutosave() } // the setting goes to the cloud with the notebook
}

function autoDetectRuleOn(id){
	if ( !validateUserConsent(false) ) { return false }
	const settings = readAutoDetectSettings();
	return settings.enabled && settings.rules[id];
}

function autoDetectSettingsHtml(){
	const settings = readAutoDetectSettings();
	const rules = autoDetectRules.map(rule =>
		`<label class="check"><input type="checkbox" data-autodetect-rule="${rule.id}"${settings.rules[rule.id] ? " checked" : ""}${settings.enabled ? "" : " disabled"}>${rule.label}</label>`
	).join("");
	return `
	<h3>Auto detect</h3>
	<div class="stack">
		<label class="check"><input id="setting-autodetect" type="checkbox"${settings.enabled ? " checked" : ""}>Turn markdown into formatting while typing</label>
		<div class="stack autodetect-rules">${rules}</div>
		<p class="muted small">Undo (Ctrl/Cmd+Z) reverts a change, press it again to get the typed text back.</p>
	</div>`;
}

function initAutoDetectSettings(){
	const master = document.getElementById("setting-autodetect");
	const ruleInputs = [...document.querySelectorAll("[data-autodetect-rule]")];
	const save = () => {
		const rules = {};
		for ( const input of ruleInputs ) { rules[input.dataset.autodetectRule] = input.checked }
		saveAutoDetectSettings({ enabled: master.checked, rules });
	};
	master.addEventListener("change", () => {
		if ( !validateUserConsent() ) { master.checked = !master.checked; return }
		for ( const input of ruleInputs ) { input.disabled = !master.checked }
		save();
	});
	for ( const input of ruleInputs ) {
		input.addEventListener("change", () => {
			if ( !validateUserConsent() ) { input.checked = !input.checked; return }
			save();
		});
	}
}

function handleAutoDetect(e){
	if ( e.inputType !== "insertText" || !e.data || e.isComposing ) { return }
	const selection = window.getSelection();
	if ( !selection.rangeCount || !selection.isCollapsed ) { return }
	const editor = document.getElementById("editor");
	const node = selection.anchorNode;
	if ( node?.nodeType !== Node.TEXT_NODE || !editor.contains(node) ) { return }
	if ( node.parentElement.closest("pre, code") ) { return }
	const before = node.textContent.slice(0, selection.anchorOffset).replace(/\u00a0/g, " ");
	if ( autoDetectBlock(editor, node, before) ) { return }
	if ( autoDetectCode(node, before) ) { return }
	autoDetectInlineFormat(node, before);
}

function handleAutoDetectEnter(e){
	// "```" alone on a line: Enter starts a code block there, or ends the code block it is in
	if ( e.key !== "Enter" || e.shiftKey || e.isComposing || e.defaultPrevented ) { return }
	const selection = window.getSelection();
	if ( !selection.rangeCount || !selection.isCollapsed ) { return }
	const editor = document.getElementById("editor");
	const node = selection.anchorNode;
	if ( node?.nodeType !== Node.TEXT_NODE || !editor.contains(node) ) { return }
	const before = node.textContent.slice(0, selection.anchorOffset);
	if ( !/^```[\w+#.-]*$/.test(before) || !lineIsEmptyAfter(node, before.length) || !autoDetectRuleOn("codeBlock") ) { return }
	const pre = node.parentElement.closest("pre");
	if ( pre ) {
		if ( before !== "```" || !startsLine(pre, node) ) { return }
		e.preventDefault();
		closeCodeBlock(pre, node);
	} else {
		if ( !startsLine(editor, node) || node.parentElement.closest("li, h1, h2, h3, h4, h5, h6, code") ) { return }
		e.preventDefault();
		// a language after the backticks has nowhere to go in the document, it is dropped
		replaceBeforeCaret(node, 0, before.length);
		document.execCommand("formatBlock", false, "pre");
	}
	updateBlockSelect();
	performAutoSave();
}

function closeCodeBlock(pre, node){
	// the "```" line goes away, and typing goes on in a plain line under the block
	const selection = window.getSelection();
	const range = document.createRange();
	const lineBreak = node.previousSibling?.nodeName === "BR" ? node.previousSibling : null;
	lineBreak ? range.setStartBefore(lineBreak) : range.setStart(node, 0);
	range.setEnd(pre, pre.childNodes.length);
	selection.removeAllRanges();
	selection.addRange(range);
	document.execCommand("delete", false, null);
	if ( !lineBreak || pre.textContent === "" ) {
		// nothing was typed in the block, it turns back into a plain line
		document.execCommand("formatBlock", false, "div");
		return
	}
	const next = document.createElement("div");
	next.appendChild(document.createElement("br"));
	pre.after(next);
	const caret = document.createRange();
	caret.setStart(next, 0);
	caret.collapse(true);
	selection.removeAllRanges();
	selection.addRange(caret);
}

function autoDetectBlock(editor, node, before){
	if ( !startsLine(editor, node) ) { return false }
	const inList = !!node.parentElement.closest("li");
	const inHeading = !!node.parentElement.closest("h1, h2, h3, h4, h5, h6");
	let ordered = null;
	let action = null;
	if ( before === "* " && !inList && autoDetectRuleOn("bullet") ) {
		action = () => document.execCommand("insertUnorderedList", false, null);
	} else if ( (ordered = before.match(/^(\d{1,9})\. $/)) && !inList && autoDetectRuleOn("numbered") ) {
		action = () => {
			document.execCommand("insertOrderedList", false, null);
			const start = parseInt(ordered[1]);
			const list = getCaretListItem()?.closest("ol");
			if ( list && start !== 1 ) { list.setAttribute("start", start) }
		};
	} else if ( /^- ?\[ ?\]$/.test(before) && !inHeading && autoDetectRuleOn("checkbox") ) {
		action = () => {
			updateCaretPosition();
			insertCheckbox();
		};
	} else if ( before === "---" && !inList && !inHeading && lineIsEmptyAfter(node, before.length) && autoDetectRuleOn("hr") ) {
		action = () => {
			// the rule takes the line, typing goes on in a new line under it
			document.execCommand("insertHTML", false, "<hr><div><br></div>");
		};
	} else if ( /^#{1,4} $/.test(before) && !inList && autoDetectRuleOn("heading") ) {
		action = () => formatBlockWithHeadingBreaks(`h${before.length - 1}`);
	}
	if ( !action ) { return false }
	replaceBeforeCaret(node, 0, before.length);
	action();
	updateBlockSelect();
	performAutoSave();
	return true
}

function autoDetectCode(node, before){
	// fires on the space or punctuation typed after the closing backticks: that character keeps the caret
	// outside the code (Chrome types into an inline element the caret is at the end of)
	if ( !/^[\s.,;:!?)\]}"']$/.test(before.slice(-1)) ) { return false }
	const closed = before.slice(0, -1);
	const match = autoDetectInlineCode.map(re => closed.match(re)).find(Boolean);
	if ( !match || !autoDetectRuleOn("inlineCode") ) { return false }
	// execCommand has no inline code and insertHTML mangles it, so the DOM is changed directly:
	// Ctrl/Cmd+Z does not bring the backticks back
	const after = node.splitText(closed.length);
	const marked = node.splitText(closed.length - match[1].length);
	const code = document.createElement("code");
	code.textContent = match[3];
	marked.replaceWith(code);
	if ( node.textContent === "" ) { node.remove() }
	const caret = document.createRange();
	caret.setStart(after, 1);
	caret.collapse(true);
	const selection = window.getSelection();
	selection.removeAllRanges();
	selection.addRange(caret);
	performAutoSave();
	return true
}

function autoDetectInlineFormat(node, before){
	for ( const { rule, command, re } of autoDetectInline ) {
		const match = before.match(re);
		if ( !match || !autoDetectRuleOn(rule) ) { continue }
		const start = before.length - match[1].length;
		const text = match[2];
		// the marked text goes back in plain, gets the style, and typing goes on unstyled after it
		selectInTextNode(node, start, before.length);
		document.execCommand("insertText", false, text);
		const selection = window.getSelection();
		const caret = selection.getRangeAt(0);
		const range = document.createRange();
		range.setStart(caret.startContainer, caret.startOffset - text.length);
		range.setEnd(caret.startContainer, caret.startOffset);
		selection.removeAllRanges();
		selection.addRange(range);
		document.execCommand(command, false, null);
		selection.collapseToEnd();
		if ( document.queryCommandState(command) ) { document.execCommand(command, false, null) }
		performAutoSave();
		return
	}
}

function selectInTextNode(node, start, end){
	const selection = window.getSelection();
	const range = document.createRange();
	range.setStart(node, start);
	range.setEnd(node, end);
	selection.removeAllRanges();
	selection.addRange(range);
}

function replaceBeforeCaret(node, start, end){
	// deletes [start, end) of the caret's text node on the undo stack
	selectInTextNode(node, start, end);
	document.execCommand("delete", false, null);
}

function startsLine(editor, node){
	// nothing but empty inline elements between the start of the line (a block or a <br>) and this text node
	let current = node;
	while ( current && current !== editor ) {
		for ( let prev = current.previousSibling; prev; prev = prev.previousSibling ) {
			if ( prev.nodeName === "BR" || isBlockNode(prev) ) { return true }
			if ( prev.textContent !== "" || prev.nodeName === "INPUT" || prev.nodeName === "IMG" ) { return false }
		}
		if ( isBlockNode(current.parentNode) ) { return true }
		current = current.parentNode;
	}
	return true
}

function lineIsEmptyAfter(node, offset){
	if ( node.textContent.slice(offset).trim() !== "" ) { return false }
	for ( let next = node.nextSibling; next; next = next.nextSibling ) {
		if ( next.nodeName === "BR" || isBlockNode(next) ) { return true }
		if ( next.textContent.trim() !== "" ) { return false }
	}
	return true
}

function isBlockNode(node){
	return node?.nodeType === Node.ELEMENT_NODE && /^(DIV|P|LI|UL|OL|H[1-6]|PRE|BLOCKQUOTE|HR|SECTION|TABLE)$/.test(node.nodeName);
}

document.getElementById("editor-grid").addEventListener("input", handleAutoDetect);
document.getElementById("editor-grid").addEventListener("keydown", handleAutoDetectEnter);
