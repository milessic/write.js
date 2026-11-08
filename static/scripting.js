/*
 * Scripting: a document with "scripts" in its metadata (doclinks.js) gets a "Script" button in the toolbar. It opens the
 * Script wizard, which adds a script's button to the text at the caret: its display name, border and JavaScript code.
 * A click on the button runs the code and shows a notification of how it went; its right click opens the wizard again.
 * The document's metadata widget (its menus, workspace.js) enables or disables its scripts (off until enabled): disabled, there is no "Script" button and the
 * document's script buttons don't run.
 *
 * A script button is <span class="script-activator" contenteditable="false" data-script="{code}"
 * data-script-border="{border}">{display name}</span>, so it is saved and synced with the document; the exports leave
 * it out (withoutScripts).
 * The code runs as the body of an async function (await works), in strict mode, with:
 * - scope: the script's own variables (scriptScopes[document id]), emptied when it ends,
 * - editor: the document's element, and the functions of scriptapi.js, which only look inside it,
 * - document: the document's own (scriptDocument): its queries (querySelector, getElementById...) only find what is in
 *   it, its body is the editor; window, globalThis and self have that document too, the rest of the page isn't there.
 * What it returns is shown in its notification, as text (scriptResultText).
 * What a script changes in the document isn't on the browser's undo stack (it can't be put there as it is):
 * Ctrl/Cmd+Z and vi's u undo it while the document is as the script left it, Ctrl/Cmd+Shift+Z, Ctrl+Y and vi's Ctrl+R
 * redo it (scriptHistory).
 * The code is plain text in a .vi-editable, so with vi mode on (vi.js) it is edited with vi: :w adds the script, :q
 * closes the wizard.
 * The wizard and its help are windows: no backdrop, moved by their title bar, resized by their corner, so the code
 * can be written with the help beside it.
 * The code is checked when it is added and before each run (checkScriptCode): it can't use localStorage or
 * sessionStorage, nor the ways around that check. It is a guard against scripts changing the app's storage and the page
 * around their document, not a sandbox: the code runs in the page like the app does.
 *
 * Element ids: a right click on a line's "+" (add comment, comments.js) assigns an id to the line, or to its list, kept
 * in its data-element-id so it never clashes with the app's own ids. An id is unique in its document.
 */
const elementIdAttribute = "data-element-id";
const elementIdPattern = /^[A-Za-z][\w-]{0,63}$/;
const scriptBorders = [
	{ key: "solid", label: "Solid" },
	{ key: "dashed", label: "Dashed" },
	{ key: "dotted", label: "Dotted" },
	{ key: "double", label: "Double" },
	{ key: "none", label: "None" },
];
const scriptDefaultBorder = "dashed"; // of a new script's button
const scriptNameMaxLength = 80;
const scriptResultMaxLength = 2000; // of what a script returns, shown in its notification
// what the code can't have, anywhere in it (also in strings and comments): the storages, and what would get to them
// without their names
const scriptForbidden = [
	{ pattern: /localStorage/, reason: "localStorage can't be used" },
	{ pattern: /sessionStorage/, reason: "sessionStorage can't be used" },
	{ pattern: /Storage/, reason: "the storages can't be used" },
	{ pattern: /\beval\b|\bFunction\b|\bconstructor\b|\bimport\s*\(|\bReflect\b|getOwnPropertyDescriptor/, reason: "code can't be made from text" },
	{ pattern: /\b(window|globalThis|self|top|parent|frames|opener)\s*(\?\.)?\s*\[|\bdefaultView\b/, reason: "the page's globals can't be looked up by name" },
	{ pattern: /\\u|\\x/, reason: "\\u and \\x escapes can't be used" },
	{ pattern: /\bownerDocument\b|\bgetRootNode\b/, reason: "the page around the document can't be reached" },
];
// names a script sees as undefined
const scriptShadowed = ["localStorage", "sessionStorage", "scriptScopes"];
// names a script sees as its document's (scriptGlobals): document, and the page's globals with that document
const scriptGlobalNames = ["document", "window", "globalThis", "self", "top", "parent", "frames"];
const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
const scriptScopes = {}; // {document id: scope}: the variables of the document's running script
// editor -> {undo: [change], redo: [change]}, a change {before, after, beforeKey, afterKey, activator}: the documents
// before and after a script's run, their keys to compare (scriptHistoryKey), and the index of the script's button
const scriptHistory = new WeakMap();
const scriptHistoryLength = 20;
const scriptApiNames = Object.keys(scriptApi(document.createElement("div")));

document.getElementById("tb-btn-script").addEventListener("click", () => formatText("script"));
// capture: a script button's menu comes before the table's of a table it is in (tables.js)
document.getElementById("editor-grid").addEventListener("contextmenu", handleScriptActivatorMenu, true);
document.getElementById("editor-grid").addEventListener("click", handleScriptActivatorClick);
document.getElementById("editor-grid").addEventListener("mousedown", (e) => {
	// the caret stays where it was
	if ( e.target.closest?.(".script-activator") ) { e.preventDefault() }
});
document.getElementById("editor-grid").addEventListener("input", (e) => {
	const editor = e.target.closest?.(".editor");
	if ( editor ) { normalizeElementIds(editor) }
});
document.getElementById("editor-grid").addEventListener("keydown", handleScriptUndoKeys, true);
// the links of a script's notification (formatScriptText): a document's opens it, one to nowhere does nothing
document.getElementById("notifications-container").addEventListener("click", (e) => {
	if ( e.target.closest?.("a.script-link-missing") ) { e.preventDefault(); return }
	handleDocumentLinkClick(e); // doclinks.js
});
document.getElementById("editor-grid").addEventListener("beforeinput", (e) => {
	// Edit > Undo / Redo of the browser's menu
	const editor = e.target.closest?.(".editor");
	if ( !editor || !["historyUndo", "historyRedo"].includes(e.inputType) ) { return }
	if ( e.inputType === "historyUndo" ? undoScriptChange(editor) : redoScriptChange(editor) ) { e.preventDefault() }
}, true);


// the document's setting
function scriptsEnabled(editor){
	const pane = editor && paneOfEditor(editor);
	return Boolean(pane && tabDocumentMeta(tabById(pane.tabId)).scripts);
}

function renderScripting(){
	// the editors' script buttons look disabled in a document without scripts, the "Script" tool shows for one with them
	for ( const pane of panes ) { pane.editor.classList.toggle("scripts-enabled", scriptsEnabled(pane.editor)) }
	const shown = scriptsEnabled(editorObject);
	document.querySelectorAll(".script-tool").forEach((el) => { el.hidden = !shown });
	syncScriptWizard();
}

function syncScriptWizard(){
	// the wizard shows while its tab is shown in an editor, hidden where it was while not; its tab closed, it goes
	const wizard = document.querySelector(".script-wizard[data-tab-id]");
	if ( !wizard ) { return }
	const tab = tabById(Number(wizard.dataset.tabId));
	if ( !tab ) { wizard.remove(); return }
	const away = !paneOfTab(tab);
	if ( away && wizard.contains(document.activeElement) ) { document.activeElement.blur() }
	wizard.classList.toggle("script-window-away", away);
}


// a script button stays in a line of text: the lines with one can't be made headings (formatBlockWithHeadingBreaks, script.js)
function selectionHasScriptActivators(editor){
	const selection = window.getSelection();
	if ( !selection.rangeCount ) { return false }
	const range = selection.getRangeAt(0);
	if ( !editor.contains(range.commonAncestorContainer) ) { return false }
	// the editor's lines (its children, or the items of its lists) the selection is in
	const lineOf = (node) => {
		let el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
		const li = el?.closest("li");
		if ( li && editor.contains(li) ) { return li }
		while ( el && el.parentElement !== editor ) { el = el.parentElement }
		return el;
	};
	const lines = [...editor.querySelectorAll(".script-activator")].map(lineOf);
	return lines.some((line) => line && (range.intersectsNode(line) || line.contains(range.startContainer)));
}

// the code
function checkScriptCode(code){
	// what is wrong with the code, null when nothing is
	if ( !code.trim() ) { return "The code is empty" }
	for ( const { pattern, reason } of scriptForbidden ) {
		const match = code.match(pattern);
		if ( match ) {
			const line = code.slice(0, match.index).split("\n").length;
			return `Line ${line}: "${match[0]}" - ${reason}`;
		}
	}
	try {
		compileScript(code);
	} catch ( err ) {
		return `${err.name}: ${err.message}`;
	}
	return null;
}

function compileScript(code){
	return new AsyncFunction("scope", "editor", ...scriptApiNames, ...scriptGlobalNames, ...scriptShadowed, `"use strict";\n${code}`);
}

function scriptNotification(text, type="info", timeout=notificationTimeout, result=null, timestamp=false, formatted=false){
	// headed "Script execution" (and the time it was shown, with timestamp), the text (and what the script returned) as
	// plain text; formatted: the text of a script's createNotification, with its bit of formatting (formatScriptText)
	type = ["info", "warning", "warn", "error"].includes(type) ? type : "info";
	const returned = result === null ? "" : `<div class="script-notification-result">${escapeHtmlText(result)}</div>`;
	const time = timestamp ? ` <span class="script-notification-time">${formatTimestamp(new Date())}</span>` : "";
	const body = formatted ? formatScriptText(text) : escapeHtmlText(text);
	return createNotification(`<div class="script-notification-head">Script execution${time}</div><div>${body}</div>${returned}`, type, timeout, true);
}

function formatScriptText(text){
	// a line break is a new line, **text** bold, *text* italic, [text](link) a link: a url (http, https, mailto) as it is,
	// anything else is a document's id, a link to it when there is one, else a link to nowhere
	const links = [];
	let html = escapeHtmlText(text).replace(/\[([^\]\n]+)\]\(([^()\s]+)\)/g, (match, label, target) => {
		links.push({ label, target });
		return `\u0000${links.length - 1}\u0000`;
	});
	const inline = (part) => part
		.replace(/\*\*(?=\S)([^\n]*?\S)\*\*/g, "<strong>$1</strong>")
		.replace(/\*(?=[^\s*])([^*\n]*?[^\s*])\*|\*([^\s*])\*/g, (match, longer, one) => `<em>${longer ?? one}</em>`);
	html = inline(html).replace(/\u0000(\d+)\u0000/g, (match, i) => {
		const { label, target } = links[Number(i)];
		const raw = unescapeHtmlAttribute(target);
		if ( /^(https?:\/\/[^\s]+|mailto:[^\s]+)$/i.test(raw) ) {
			return `<a href="${target}" target="_blank" rel="noopener noreferrer">${inline(label)}</a>`;
		}
		const name = documentNameById(raw); // doclinks.js
		if ( name !== null ) { return `<a href="?${docLinkParam}=${target}" data-doc-id="${target}" title="${escapeHtmlText(name)}">${inline(label)}</a>` }
		return `<a href="" class="script-link-missing" title="No document with this id">${inline(label)}</a>`;
	});
	return html.replace(/\r?\n/g, "<br>");
}

function formatTimestamp(date, seconds=true){
	// "HH:MM:SS dd-mm-YYYY", without the seconds "HH:MM dd-mm-YYYY"
	const two = (n) => String(n).padStart(2, "0");
	const time = [date.getHours(), date.getMinutes(), ...(seconds ? [date.getSeconds()] : [])].map(two).join(":");
	return `${time} ${two(date.getDate())}-${two(date.getMonth() + 1)}-${date.getFullYear()}`;
}

function scriptResultText(value){
	// what a script returned, as text: a string as it is, an element its text, anything else as JSON; null for nothing
	if ( value === undefined ) { return null }
	let text;
	if ( typeof value === "string" ) {
		text = value;
	} else if ( value instanceof Node ) {
		text = value.textContent;
	} else {
		try {
			text = JSON.stringify(value, (key, v) => v instanceof Node ? v.textContent : typeof v === "bigint" ? String(v) : v, 2) ?? String(value);
		} catch ( err ) {
			text = String(value);
		}
	}
	return text.length > scriptResultMaxLength ? text.slice(0, scriptResultMaxLength) + "…" : text;
}

function scriptScopeKey(editor){
	// an editor that isn't shown (a cron job's, cron.js) has its document's id
	const tab = tabById(paneOfEditor(editor)?.tabId);
	return tab?.docId || editor.dataset.docId || `tab-${tab?.id}`;
}

async function executeScript(editor, code){
	// runs the code on the editor's document: {ok, result, error}, null when a script of the document is still running
	const key = scriptScopeKey(editor);
	if ( key in scriptScopes ) { return null }
	const scope = scriptScopes[key] = {};
	const api = scriptApi(editor);
	try {
		return { ok: true, result: scriptResultText(await compileScript(code)(scope, editor, ...scriptApiNames.map((n) => api[n]), ...scriptGlobals(editor))) };
	} catch ( err ) {
		return { ok: false, result: null, error: err };
	} finally {
		delete scriptScopes[key];
	}
}

function scriptDocument(editor){
	// document as a script sees it: only its own document. What finds elements looks inside the editor, what makes them
	// works as in the page, the rest of the page's document isn't there (undefined)
	const escape = (value) => CSS.escape(String(value));
	return Object.freeze({
		querySelector: (selector) => editor.querySelector(selector),
		querySelectorAll: (selector) => editor.querySelectorAll(selector),
		// an element's id, or the id assigned for scripts (data-element-id)
		getElementById: (id) => editor.querySelector(`[id="${escape(id)}"], [${elementIdAttribute}="${escape(id)}"]`),
		getElementsByClassName: (names) => editor.getElementsByClassName(names),
		getElementsByTagName: (name) => editor.getElementsByTagName(name),
		getElementsByName: (name) => editor.querySelectorAll(`[name="${escape(name)}"]`),
		get body(){ return editor },
		get documentElement(){ return editor },
		get activeElement(){ return editor.contains(document.activeElement) ? document.activeElement : null },
		createElement: (...args) => document.createElement(...args),
		createElementNS: (...args) => document.createElementNS(...args),
		createTextNode: (text) => document.createTextNode(text),
		createComment: (text) => document.createComment(text),
		createDocumentFragment: () => document.createDocumentFragment(),
		createRange: () => document.createRange(),
		createTreeWalker: (root, ...args) => {
			if ( !(root instanceof Node) || !editor.contains(root) ) { throw new Error("createTreeWalker: the root has to be in the document") }
			return document.createTreeWalker(root, ...args);
		},
		getSelection: () => window.getSelection(),
		execCommand: (...args) => document.execCommand(...args),
	});
}

function scriptGlobals(editor){
	// the values of scriptGlobalNames: the script's document, and window (globalThis, self...) with it instead of the page's
	const doc = scriptDocument(editor);
	const win = new Proxy(window, {
		get(target, prop){
			if ( prop === "document" ) { return doc }
			if ( scriptGlobalNames.includes(prop) ) { return win }
			if ( scriptShadowed.includes(prop) ) { return undefined }
			const value = Reflect.get(target, prop);
			// the page's functions (setTimeout, fetch...) need the window as this; constructors are left as they are
			return typeof value === "function" && typeof prop === "string" && /^[a-z]/.test(prop) ? value.bind(target) : value;
		},
		set(target, prop, value){ return Reflect.set(target, prop, value) },
	});
	return scriptGlobalNames.map((name) => name === "document" ? doc : win);
}

function afterScriptRun(editor, before, beforeKey, activatorIndex){
	// what the script changed in the document is like an edit (unsaved tab, autosave), and can be undone; returns whether it changed
	const changed = editor.isConnected && editor.innerHTML !== before;
	if ( changed ) {
		editor.dispatchEvent(new Event("input", { bubbles: true }));
		if ( editor.id === "editor" ) { performAutoSave() }
		rememberScriptChange(editor, { before, beforeKey, after: editor.innerHTML, afterKey: scriptHistoryKey(editor), activator: activatorIndex });
	}
	return changed;
}

async function runScript(activator){
	const editor = activator.closest(".editor");
	const name = activator.textContent.trim() || "Script";
	if ( !scriptsEnabled(editor) ) {
		scriptNotification(`Scripts are disabled in this document, '${name}' did not run. Enable them in Document metadata (the document's menu)`, "warning");
		return false;
	}
	const code = activator.dataset.script || "";
	const problem = checkScriptCode(code);
	if ( problem ) {
		scriptNotification(`'${name}' cannot run: ${problem}`, "error", notificationTimeoutLong);
		return false;
	}
	const before = editor.innerHTML;
	const beforeKey = scriptHistoryKey(editor);
	const activatorIndex = [...editor.querySelectorAll(".script-activator")].indexOf(activator);
	const run = await executeScript(editor, code);
	if ( !run ) {
		scriptNotification(`A script of this document is still running, '${name}' did not run`, "warning");
		return false;
	}
	const { ok, result, error } = run;
	if ( !ok ) { console.error(`Script '${name}' failed`, error) }
	const changed = afterScriptRun(editor, before, beforeKey, activatorIndex);
	const outcome = ok ? `'${name}' executed` : `'${name}' failed: ${error?.message ?? error}`;
	const change = changed ? `. It changed the document: ${scriptUndoHint()} undoes it` : "";
	scriptNotification(outcome + change, ok ? "info" : "error", ok && !changed && result === null ? notificationTimeout : notificationTimeoutLong, result);
	return ok;
}


// undo / redo of the scripts' changes
function scriptHistoryKey(editor){
	// the document without what the app recomputes on its own (the lines hidden by folds, folding.js)
	const copy = editor.cloneNode(true);
	copy.querySelectorAll(".fold-hidden").forEach((el) => {
		el.classList.remove("fold-hidden");
		if ( !el.classList.length ) { el.removeAttribute("class") }
	});
	return copy.innerHTML;
}

function scriptUndoHint(){
	const keys = document.body.classList.contains("apple-platform") ? "Cmd+Z" : "Ctrl+Z";
	return viModeEnabled() ? `${keys} or u` : keys;
}

function rememberScriptChange(editor, change){
	const history = scriptHistory.get(editor) || { undo: [], redo: [] };
	history.undo.push(change);
	history.undo.splice(0, history.undo.length - scriptHistoryLength);
	history.redo = [];
	scriptHistory.set(editor, history);
}

function undoScriptChange(editor){
	// only while the document is as the script left it: the edits made since are the browser's to undo first
	const history = scriptHistory.get(editor);
	const change = history?.undo.at(-1);
	if ( !change || scriptHistoryKey(editor) !== change.afterKey ) { return false }
	history.undo.pop();
	history.redo.push(change);
	showScriptChange(editor, change.before, change.activator);
	change.beforeKey = scriptHistoryKey(editor);
	return true;
}

function redoScriptChange(editor){
	const history = scriptHistory.get(editor);
	const change = history?.redo.at(-1);
	if ( !change || scriptHistoryKey(editor) !== change.beforeKey ) { return false }
	history.redo.pop();
	history.undo.push(change);
	showScriptChange(editor, change.after, change.activator);
	change.afterKey = scriptHistoryKey(editor);
	return true;
}

function showScriptChange(editor, html, activatorIndex){
	// the document as it was, where it was scrolled, the caret after the script's button; changed like after an edit
	const scroller = editor.closest(".pane-scroll");
	const scrollTop = scroller?.scrollTop;
	editor.innerHTML = html;
	const activator = editor.querySelectorAll(".script-activator")[activatorIndex];
	if ( activator && editor.contains(document.activeElement) ) {
		const caret = document.createRange();
		caret.setStartAfter(activator);
		caret.collapse(true);
		window.getSelection().removeAllRanges();
		window.getSelection().addRange(caret);
	}
	if ( scroller ) { scroller.scrollTop = scrollTop }
	editor.dispatchEvent(new Event("input", { bubbles: true }));
	if ( editor.id === "editor" ) { performAutoSave() }
}

function handleScriptUndoKeys(e){
	// Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, Ctrl+Y
	const editor = e.target.closest?.(".editor");
	if ( !editor || !(e.ctrlKey || e.metaKey) || e.altKey ) { return }
	const key = e.key.toLowerCase();
	const redo = (key === "z" && e.shiftKey) || (key === "y" && e.ctrlKey && !e.shiftKey);
	if ( !redo && !(key === "z" && !e.shiftKey) ) { return }
	if ( redo ? redoScriptChange(editor) : undoScriptChange(editor) ) {
		e.preventDefault();
		e.stopPropagation();
	}
}

function withoutScripts(html){
	// the script buttons don't run outside of the app: the exports leave them out
	const template = document.createElement("template");
	template.innerHTML = html;
	template.content.querySelectorAll(".script-activator").forEach((el) => el.remove());
	return template.innerHTML;
}


// the buttons in the text
function handleScriptActivatorClick(e){
	const activator = e.target.closest?.(".script-activator");
	if ( !activator || e.button !== 0 ) { return }
	e.preventDefault();
	runScript(activator);
}

function handleScriptActivatorMenu(e){
	const activator = e.target.closest?.(".script-activator");
	if ( !activator ) { return }
	const enabled = scriptsEnabled(activator.closest(".editor"));
	openContextMenu(e, [
		{ label: enabled ? "Open Wizard" : "Open Wizard (scripts are disabled)", action: () => openScriptWizard(activator), disabled: !enabled },
	]);
}

function fillScriptActivator(el, name, border, code){
	el.className = "script-activator";
	el.contentEditable = "false";
	el.setAttribute("role", "button");
	el.dataset.script = code;
	el.dataset.scriptBorder = border;
	el.textContent = name;
	return el;
}

function insertScriptActivator(editor, range, activator){
	// at the caret, or on a line of its own at the end
	if ( range && editor.contains(range.commonAncestorContainer) ) {
		range.deleteContents();
		range.insertNode(activator);
	} else {
		const line = document.createElement("div");
		line.append(activator);
		editor.append(line);
	}
	const caret = document.createRange();
	caret.setStartAfter(activator);
	caret.collapse(true);
	editor.focus({ preventScroll: true });
	const selection = window.getSelection();
	selection.removeAllRanges();
	selection.addRange(caret);
}


// the wizard
function openScriptWizard(activator=null, at=null){
	// at: where a new button goes (vi's :script), else the caret's place in the editor
	const editor = activator?.closest(".editor") || editorObject;
	if ( !scriptsEnabled(editor) ) {
		scriptNotification("Scripts are disabled in this document. Enable them in Document metadata (the document's menu)", "warning");
		return;
	}
	const range = activator ? null : at || (lastEditorRange && editor.contains(lastEditorRange.commonAncestorContainer) ? lastEditorRange.cloneRange() : null);
	closeAllModals();
	createModal("Script wizard", `
		<label>Display name<input type="text" class="script-name" maxlength="${scriptNameMaxLength}" autocomplete="off" placeholder="The button's text"></label>
		<label>Border type<select class="script-border">${scriptBorders.map((b) => `<option value="${b.key}">${b.label}</option>`).join("")}</select></label>
		<div class="script-code-field"><span id="script-code-label">Code</span><div class="script-code vi-editable" role="textbox" aria-multiline="true" aria-labelledby="script-code-label" spellcheck="false" autocapitalize="off" autocorrect="off" data-placeholder="JavaScript, e.g. createNotification(locateHeading(1).hText)"></div></div>
		<div class="script-check small" role="alert" hidden></div>
		<div class="row script-wizard-actions">
			<button type="button" class="btn primary script-save">${activator ? "Save" : "Add"}</button>
			<button type="button" class="btn script-cancel">Cancel</button>
			<button type="button" class="btn ghost script-help-btn">Help</button>
		</div>`);
	const modal = [...document.querySelectorAll(".modal-container")].at(-1);
	modal.classList.add("script-wizard");
	// it belongs to its document's tab: hidden while another tab is shown in its place, back where it was with the tab
	// (syncScriptWizard); the editor shows other content meanwhile, so what it adds to is found again on save
	const tabId = paneOfEditor(editor)?.tabId ?? null;
	if ( tabId !== null ) { modal.dataset.tabId = tabId }
	const activatorIndex = activator ? [...editor.querySelectorAll(".script-activator")].indexOf(activator) : -1;
	const rangePath = range && editor.contains(range.startContainer) ? { node: range.startContainer, path: nodePath(editor, range.startContainer), offset: range.startOffset } : null;
	// a window, not a modal: the help and the document stay usable beside it
	deleteOverlay();
	setupScriptWindow(modal);
	const name = modal.querySelector(".script-name");
	const border = modal.querySelector(".script-border");
	const code = modal.querySelector(".script-code");
	const check = modal.querySelector(".script-check");
	border.value = scriptDefaultBorder;
	if ( activator ) {
		name.value = activator.textContent.trim();
		if ( scriptBorders.some((b) => b.key === activator.dataset.scriptBorder) ) { border.value = activator.dataset.scriptBorder }
	}
	setupScriptCode(code, activator?.dataset.script || "");
	const values = () => JSON.stringify([name.value, border.value, scriptCodeText(code)]);
	const initialValues = values();
	modal.canClose = () => values() === initialValues || showConfirm("Close Script wizard without saving changes?");
	const showProblem = (text) => {
		check.textContent = text || "";
		check.hidden = !text;
	};
	code.addEventListener("input", () => showProblem(null));
	const save = () => {
		const label = name.value.trim();
		const text = scriptCodeText(code);
		if ( !label ) { showProblem("The display name is empty"); name.focus(); return false }
		const problem = checkScriptCode(text);
		if ( problem ) { showProblem(problem); code.focus(); return false }
		const target = wizardTarget();
		if ( !target ) { showProblem("The script's document is no longer opened"); return false }
		const { editor: into, activator: button, range: at } = target;
		if ( activator && !button?.isConnected ) { showProblem("The script's button is no longer in the document"); return false }
		if ( button ) {
			fillScriptActivator(button, label, border.value, text);
		} else {
			insertScriptActivator(into, at, fillScriptActivator(document.createElement("span"), label, border.value, text));
		}
		modal.canClose = null;
		closeAllModals();
		into.dispatchEvent(new Event("input", { bubbles: true }));
		if ( into.id === "editor" ) { performAutoSave() }
		return true;
	};
	const wizardTarget = () => {
		// {editor, activator, range} in the editor showing the wizard's tab now; as they were when nothing moved
		const pane = tabId === null ? paneOfEditor(editor) : paneOfTab(tabById(tabId));
		if ( !pane ) { return null }
		const into = pane.editor;
		// (a range whose node went with the editor's content moves to the editor itself: its node tells)
		if ( into === editor && (!activator || activator.isConnected) && (!rangePath || into.contains(rangePath.node)) ) {
			return { editor: into, activator, range };
		}
		const button = activatorIndex === -1 ? null : into.querySelectorAll(".script-activator")[activatorIndex] || null;
		let at = null;
		const node = rangePath && nodeAtPath(into, rangePath.path);
		if ( node ) {
			at = document.createRange();
			at.setStart(node, Math.min(rangePath.offset, node.nodeType === Node.TEXT_NODE ? node.length : node.childNodes.length));
			at.collapse(true);
		}
		return { editor: into, activator: button, range: at };
	};
	// vi in the code (vi.js): :w adds or saves the script, :q closes the wizard, :wq both
	code.addEventListener("vi-command", (e) => {
		const { name: command } = e.detail;
		if ( ["w", "write", "w!", "wq", "x", "xit", "wq!", "x!"].includes(command) ) {
			e.preventDefault();
			save();
		} else if ( ["q", "quit", "q!", "quit!", "close"].includes(command) ) {
			e.preventDefault();
			modal.canClose = null;
			closeAllModals();
		}
	});
	modal.querySelector(".script-cancel").addEventListener("click", () => {
		modal.canClose = null;
		closeAllModals();
	});
	modal.querySelector(".script-help-btn").addEventListener("click", openScriptHelp);
	modal.querySelector(".script-save").addEventListener("click", save);
	name.focus();
}


// the code: plain text in a contenteditable, its lines <div>s like the editors' so vi works in it (vi.js)
function setupScriptCode(code, text){
	// Firefox before 136 doesn't know plaintext-only; it would be the editors' own <div> lines anyway
	code.contentEditable = "true";
	code.innerHTML = text ? text.split("\n").map((line) => `<div>${line ? escapeHtmlText(line) : "<br>"}</div>`).join("") : "";
	code.addEventListener("beforeinput", (e) => {
		// no formatting, nothing dropped in
		if ( e.inputType.startsWith("format") || e.inputType === "insertFromDrop" ) { e.preventDefault() }
	});
	code.addEventListener("paste", (e) => {
		// only the text of what is pasted
		e.preventDefault();
		document.execCommand("insertText", false, e.clipboardData?.getData("text/plain") ?? "");
	});
	code.addEventListener("keydown", (e) => {
		// Tab indents the code (in vi, only while typing: vi takes the keys of its other modes first)
		if ( e.key !== "Tab" || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented ) { return }
		e.preventDefault();
		document.execCommand("insertText", false, "\t");
	});
}

function scriptCodeText(code){
	// the lines as they show; the last line's break isn't a line
	return code.innerText.replace(/\u00a0/g, " ").replace(/\n$/, "");
}


// the help: the functions are read from scriptapi.js
async function openScriptHelp(){
	document.querySelectorAll(".script-help-modal").forEach((el) => el.remove());
	const dialog = document.createElement("dialog");
	dialog.className = "modal-container script-help-modal";
	dialog.innerHTML = `
		<div class="section-head">
			<h2>Script help</h2>
			<button type="button" class="small-btn" aria-label="Close">✕</button>
		</div>
		<div class="modal-content stack">
			<p>A script is JavaScript that runs when its button is clicked, in this document only. It can use
			<code>await</code>; an error it throws ends it with an error notification.</p>
			<ul class="script-help-notes">
				<li><code>scope</code>: the script's own variables, e.g. <code>scope.count = 1</code>, emptied when it ends.</li>
				<li><code>editor</code>: the document's element.</li>
				<li><code>document</code>: only this document: <code>querySelector</code>, <code>querySelectorAll</code>,
					<code>getElementById</code> (also the ids assigned with the line's +) and the like look inside it, <code>document.body</code> is
					<code>editor</code>; the rest of Write.JS isn't reachable from it (nor from <code>window.document</code>).</li>
				<li><code>return</code> a value to show it in the notification, as text: a string as it is, anything else as JSON.</li>
				<li>Not allowed: ${scriptForbidden.map((f) => escapeHtmlText(f.reason)).join("; ")}.</li>
			</ul>
			<h3>Functions</h3>
			<div class="script-help-functions muted">Loading…</div>
		</div>`;
	dialog.querySelector(".section-head .small-btn").addEventListener("click", () => dialog.remove());
	document.body.append(dialog);
	dialog.show();
	setupScriptWindow(dialog);
	placeBesideWizard(dialog);
	const list = dialog.querySelector(".script-help-functions");
	try {
		const response = await fetch(scriptApiUrl);
		if ( !response.ok ) { throw new Error(`${response.status} ${response.statusText}`) }
		const docs = scriptApiDocs(await response.text());
		list.classList.remove("muted");
		list.replaceChildren(...docs.map(({ name, params, doc, async }) => {
			const item = document.createElement("section");
			item.className = "script-help-function";
			const signature = document.createElement("code");
			signature.textContent = `${async ? "async " : ""}${name}(${params})`;
			const text = document.createElement("p");
			text.textContent = doc;
			item.append(signature, text);
			return item;
		}));
	} catch ( err ) {
		console.error("Could not load the script functions", err);
		list.textContent = "Could not load the functions, try again when online.";
	}
}

// the windows
let scriptWindowLayer = 31;

function setupScriptWindow(dialog){
	// dragged by its title bar, kept inside the viewport; the one clicked last is on top
	dialog.classList.add("script-window");
	const head = dialog.querySelector(".section-head");
	head.title = "Drag to move";
	dialog.addEventListener("pointerdown", () => { dialog.style.zIndex = ++scriptWindowLayer }, true);
	dialog.style.zIndex = ++scriptWindowLayer;
	head.addEventListener("pointerdown", (e) => {
		if ( e.button !== 0 || e.target.closest("button, input, select, textarea") ) { return }
		e.preventDefault();
		const rect = dialog.getBoundingClientRect();
		const offset = { x: e.clientX - rect.left, y: e.clientY - rect.top };
		placeScriptWindow(dialog, rect.left, rect.top);
		head.setPointerCapture(e.pointerId);
		const move = (e) => placeScriptWindow(dialog, e.clientX - offset.x, e.clientY - offset.y);
		const end = () => {
			head.removeEventListener("pointermove", move);
			head.removeEventListener("pointerup", end);
			head.removeEventListener("pointercancel", end);
			dialog.classList.remove("moving");
		};
		dialog.classList.add("moving");
		head.addEventListener("pointermove", move);
		head.addEventListener("pointerup", end);
		head.addEventListener("pointercancel", end);
	});
}

function placeScriptWindow(dialog, left, top){
	// from the centre the theme puts it in to where it is moved; its title bar never leaves the viewport
	const { width } = dialog.getBoundingClientRect();
	const head = dialog.querySelector(".section-head").getBoundingClientRect().height || 40;
	dialog.style.transform = "none";
	dialog.style.right = dialog.style.bottom = "auto";
	dialog.style.left = Math.max(48 - width, Math.min(left, window.innerWidth - 48)) + "px";
	dialog.style.top = Math.max(0, Math.min(top, window.innerHeight - head)) + "px";
}

function placeBesideWizard(help){
	// right of the wizard when there's room for both, else left of it
	const wizard = document.querySelector(".script-wizard");
	if ( !wizard ) { return }
	const gap = 12;
	const w = wizard.getBoundingClientRect();
	const h = help.getBoundingClientRect();
	const total = w.width + gap + h.width;
	if ( total > window.innerWidth - 16 ) { return }
	const left = Math.max(8, Math.min(w.left, window.innerWidth - total - 8));
	placeScriptWindow(wizard, left, w.top);
	placeScriptWindow(help, left + w.width + gap, w.top);
}

function scriptApiDocs(source){
	// [{name, params, doc, async}] of every function with a /** comment right above it
	const docs = [];
	for ( const match of source.matchAll(/\/\*\*([\s\S]*?)\*\/\s*(async\s+)?function\s+([\w$]+)\s*\(([^)]*)\)/g) ) {
		const doc = match[1].split("\n").map((line) => line.replace(/^\s*\*\s?/, "").trim()).filter(Boolean).join(" ");
		docs.push({ name: match[3], params: match[4].replace(/\s+/g, " ").trim(), doc, async: Boolean(match[2]) });
	}
	return docs;
}


// element ids
function elementIdMenuItems(editor, line){
	// the line's id, and its list's for a list item
	const items = elementIdItems(editor, line, line.nodeName === "LI" ? "item" : "line");
	const list = line.nodeName === "LI" ? line.closest("ul, ol") : null;
	if ( list ) { items.push(...elementIdItems(editor, list, "list")) }
	return items;
}

function elementIdItems(editor, el, what){
	const id = el.getAttribute(elementIdAttribute);
	return [
		{ label: id ? `Change ${what} ID (${id})` : `Assign ID to ${what}`, action: () => promptElementId(editor, el, what) },
		...(id ? [{ label: `Remove ${what} ID`, action: () => setElementId(editor, el, null) }] : []),
	];
}

function promptElementId(editor, el, what){
	const answer = window.prompt(`ID of the ${what} (letters, digits, - and _), unique in the document:`, el.getAttribute(elementIdAttribute) || "");
	if ( answer === null ) { return false }
	const id = answer.trim();
	if ( !id ) { return setElementId(editor, el, null) }
	if ( !elementIdPattern.test(id) ) {
		createNotification(`"${id}" is not a valid ID: it starts with a letter and has only letters, digits, - and _`, "warning", notificationTimeoutLong);
		return false;
	}
	const holder = editor.querySelector(`[${elementIdAttribute}="${CSS.escape(id)}"]`);
	if ( holder && holder !== el ) {
		createNotification(`The ID "${id}" is already used in this document`, "warning", notificationTimeoutLong);
		return false;
	}
	return setElementId(editor, el, id);
}

function setElementId(editor, el, id){
	if ( (el.getAttribute(elementIdAttribute) || null) === id ) { return false }
	id ? el.setAttribute(elementIdAttribute, id) : el.removeAttribute(elementIdAttribute);
	// part of the document: it changed like after an edit (unsaved tab, autosave)
	editor.dispatchEvent(new Event("input", { bubbles: true }));
	if ( editor.id === "editor" ) { performAutoSave() }
	return true;
}

function normalizeElementIds(editor){
	// Enter splits a line into two with the same attributes, a paste may bring a copy: an id stays on one element,
	// the one with text, else the first
	const holders = new Map();
	for ( const el of editor.querySelectorAll(`[${elementIdAttribute}]`) ) {
		const id = el.getAttribute(elementIdAttribute);
		if ( !holders.has(id) ) { holders.set(id, []) }
		holders.get(id).push(el);
	}
	for ( const els of holders.values() ) {
		if ( els.length < 2 ) { continue }
		const withText = els.filter((el) => el.textContent.trim() !== "");
		const keep = withText.length === 1 ? withText[0] : els[0];
		els.filter((el) => el !== keep).forEach((el) => el.removeAttribute(elementIdAttribute));
	}
}

document.querySelectorAll("#editor-grid .editor").forEach(normalizeElementIds);
renderScripting();
