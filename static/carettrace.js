/*
 * Caret trace: a diagnostic for caret jumps (the caret ends up lines away from where it was, usually near the top,
 * without a click). Off unless turned on in Account > Diagnostics (localStorage "__caretTrace__" = "1", this device only).
 * Loaded before script.js, so every script's selection calls go through it. Each jump is logged to the console and kept
 * (the last 30, also across reloads) in localStorage "__caretTraceLog__"; Account > Diagnostics copies or shares them,
 * copyCaretTrace() does it from the console.
 * A jump record has: the lines (top-level blocks of the editor) it went from and to, the last key and pointer press, the
 * last selection calls made by a script (with their stacks) and the editor's recent DOM changes (a caret whose line is
 * taken out of the document is moved by the browser, with no call).
 */
const caretTraceKey = "__caretTrace__";
const caretTraceLogKey = "__caretTraceLog__";
let caretTraceOn = false;
try { caretTraceOn = localStorage.getItem(caretTraceKey) === "1" } catch ( err ) { /* storage blocked: stays off */ }

(() => {
	const jumpLines = 4;        // a move of more lines than this, without a click, is recorded
	const recentMs = 1500;
	const calls = [];           // the last selection calls: {at, method, stack}
	const mutations = [];       // the editors' last child list changes: {at, removed, added, target}
	let lastKey = null, lastPointer = -Infinity, last = null;

	const now = () => Math.round(performance.now());
	// without this file's own frames (and Chrome's "Error" first line; Safari has none)
	const stack = () => (new Error().stack || "").split("\n").map(s => s.trim()).filter(s => s && s !== "Error" && !s.includes("carettrace.js")).slice(0, 10).join("\n");
	for ( const method of ["collapse", "setPosition", "addRange", "removeAllRanges", "removeRange", "setBaseAndExtent", "modify", "collapseToStart", "collapseToEnd", "selectAllChildren", "extend", "empty"] ) {
		const original = Selection.prototype[method];
		if ( typeof original !== "function" ) { continue }
		Selection.prototype[method] = function(...args){
			if ( caretTraceOn ) {
				calls.push({ at: now(), method, stack: stack() });
				if ( calls.length > 12 ) { calls.shift() }
			}
			return original.apply(this, args);
		};
	}

	const describe = (node) => !node ? "null" : node.nodeType === Node.TEXT_NODE ? `#text "${node.data.slice(0, 30)}"` : `<${node.nodeName.toLowerCase()}${node.className ? "." + String(node.className).split(" ").join(".") : ""}>`;
	function position(){
		const selection = window.getSelection();
		if ( !selection.rangeCount ) { return null }
		const node = selection.focusNode;
		const editor = (node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement)?.closest(".editor");
		if ( !editor ) { return null }
		let block = node;
		while ( block && block.parentNode !== editor && block !== editor ) { block = block.parentNode }
		// right in the editor, between two of its lines: half a line
		const line = block === editor ? selection.focusOffset - .5 : [...editor.childNodes].indexOf(block);
		return { editor, line, node: describe(node), offset: selection.focusOffset, text: block === editor ? "" : (block?.textContent || "").slice(0, 40) };
	}

	document.addEventListener("keydown", (e) => { lastKey = { at: now(), key: e.key, ctrl: e.ctrlKey, meta: e.metaKey, alt: e.altKey, shift: e.shiftKey } }, true);
	document.addEventListener("pointerdown", () => { lastPointer = now() }, true);
	document.addEventListener("selectionchange", () => {
		if ( !caretTraceOn ) { last = null; return }
		const current = position();
		if ( !current ) { return }
		const before = last;
		last = current;
		if ( !before || before.editor !== current.editor || Math.abs(current.line - before.line) <= jumpLines ) { return }
		const at = now();
		if ( at - lastPointer < 600 ) { return }
		const recent = (list) => list.filter(x => at - x.at < recentMs).map(x => ({ ...x, ago: at - x.at }));
		const record = {
			time: new Date().toISOString(),
			from: { line: before.line, node: before.node, offset: before.offset, text: before.text },
			to: { line: current.line, node: current.node, offset: current.offset, text: current.text },
			lastKey: lastKey && { ...lastKey, ago: at - lastKey.at },
			calls: recent(calls),
			mutations: recent(mutations),
			userAgent: navigator.userAgent,
		};
		console.warn("Caret jump", record);
		try {
			localStorage.setItem(caretTraceLogKey, JSON.stringify([...readCaretTrace(), record].slice(-30)));
		} catch ( err ) { /* storage full or blocked: the console has it */ }
		if ( typeof createNotification === "function" ) { createNotification("Caret jump recorded (Account > Diagnostics)", "warning") }
	});

	// the editors are made by workspace.js later: the grid is watched once the page is there
	document.addEventListener("DOMContentLoaded", () => {
		const grid = document.getElementById("editor-grid");
		if ( !grid ) { return }
		new MutationObserver((records) => {
			if ( !caretTraceOn ) { return }
			for ( const r of records ) {
				if ( r.type !== "childList" || !r.target.closest?.(".editor") || (!r.removedNodes.length && !r.addedNodes.length) ) { continue }
				mutations.push({ at: now(), target: describe(r.target), removed: r.removedNodes.length, added: r.addedNodes.length });
				if ( mutations.length > 20 ) { mutations.shift() }
			}
		}).observe(grid, { childList: true, subtree: true });
	});
})();

function readCaretTrace(){
	try { return JSON.parse(localStorage.getItem(caretTraceLogKey) || "[]") } catch ( err ) { return [] }
}

function copyCaretTrace(){
	const text = JSON.stringify(readCaretTrace(), null, 1);
	navigator.clipboard?.writeText(text).catch(() => {});
	return JSON.parse(text);
}


// Account > Diagnostics (script2.js / script3.js, through notebookDataHtml in script.js)
function caretTraceHtml(){
	const count = readCaretTrace().length;
	return `
	<h3>Diagnostics</h3>
	<div class="stack" id="caret-trace-section">
		<label class="check"><input id="setting-caret-trace" type="checkbox"${caretTraceOn ? " checked" : ""} onchange="setCaretTrace(this.checked)">Record caret jumps</label>
		<p class="muted small">When the caret jumps several lines without a click, what moved it is recorded on this device. Send the log with the bug report.</p>
		<div class="row">
			<button class="btn" type="button" onclick="copyCaretTraceLog()"${count ? "" : " disabled"}>Copy log (<span id="caret-trace-count">${count}</span>)</button>
			${navigator.share ? `<button class="btn" type="button" onclick="shareCaretTraceLog()"${count ? "" : " disabled"}>Share log</button>` : ""}
			<button class="btn" type="button" onclick="clearCaretTraceLog()"${count ? "" : " disabled"}>Clear log</button>
		</div>
		<details${count ? "" : " hidden"}><summary class="small">Show log</summary><textarea readonly rows="8" style="width:100%;font-family:var(--font-mono);font-size:.75rem">${escapeCaretTrace(JSON.stringify(readCaretTrace(), null, 1))}</textarea></details>
	</div>`;
}

function escapeCaretTrace(text){
	return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function refreshCaretTraceSection(){
	const section = document.getElementById("caret-trace-section");
	if ( !section ) { return }
	const holder = document.createElement("div");
	holder.innerHTML = caretTraceHtml();
	section.replaceWith(holder.querySelector("#caret-trace-section"));
}

function setCaretTrace(on){
	caretTraceOn = on;
	try { on ? localStorage.setItem(caretTraceKey, "1") : localStorage.removeItem(caretTraceKey) } catch ( err ) { /* this page only */ }
	if ( typeof createNotification === "function" ) { createNotification(on ? "Recording caret jumps on this device" : "Caret jumps are no longer recorded", "info") }
}

async function copyCaretTraceLog(){
	const text = JSON.stringify(readCaretTrace(), null, 1);
	try {
		await navigator.clipboard.writeText(text);
		createNotification("Caret log copied", "info");
	} catch ( err ) {
		// no clipboard (e.g. not https): the log is selected in the box to copy by hand
		const details = document.querySelector("#caret-trace-section details");
		if ( details ) { details.open = true; details.querySelector("textarea").select() }
		createNotification("Could not copy, select the log in the box and copy it", "warning");
	}
}

async function shareCaretTraceLog(){
	const text = JSON.stringify(readCaretTrace(), null, 1);
	try {
		await navigator.share({ title: "Write.JS caret log", text });
	} catch ( err ) {
		if ( err?.name !== "AbortError" ) { copyCaretTraceLog() }
	}
}

function clearCaretTraceLog(){
	try { localStorage.removeItem(caretTraceLogKey) } catch ( err ) { return }
	refreshCaretTraceSection();
}
