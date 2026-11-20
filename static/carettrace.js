/*
 * Caret trace: a diagnostic for caret jumps (the caret ends up lines away from where it was, usually near the top,
 * without a click). Off unless turned on in Account > Diagnostics (localStorage "__caretTrace__" = "1", this device only).
 * Loaded before script.js, so every script's selection calls go through it.
 * While on, the last 30 s are kept in memory as a timeline: keys, pointer presses, where the caret is (in px from the
 * editor's top, so it doesn't depend on how the document is nested), the selection calls made by scripts (with their
 * stacks), the editors' DOM changes, their scrolls and the focus.
 * A jump (the caret moved more than a few lines with no pointer press just before, or the editor scrolled far without the
 * wheel or a finger) is saved with its timeline; "Save what just happened" in Account > Diagnostics saves the timeline
 * by hand, for a jump the detection misses. The last 20 records are kept across reloads in localStorage
 * "__caretTraceLog__"; Account > Diagnostics copies or shares them, copyCaretTrace() does it from the console.
 */
const caretTraceKey = "__caretTrace__";
const caretTraceLogKey = "__caretTraceLog__";
let caretTraceOn = false;
try { caretTraceOn = localStorage.getItem(caretTraceKey) === "1" } catch ( err ) { /* storage blocked: stays off */ }
let caretTimeline = [];         // {at, type, ...}, the last timelineMs
let caretTraceSnapshot = null;  // the timeline as it was when the Account window opened (saveCaretTraceNow)

(() => {
	const timelineMs = 30000;
	const jumpPx = 100;         // about four lines
	const scrollJumpPx = 400;
	let lastPointer = -Infinity, lastWheel = -Infinity, last = null;
	const scrolls = new WeakMap();

	const now = () => Math.round(performance.now());
	const add = (entry) => {
		const at = now();
		caretTimeline.push({ at, ...entry });
		while ( caretTimeline.length && (at - caretTimeline[0].at > timelineMs || caretTimeline.length > 600) ) { caretTimeline.shift() }
	};
	// without this file's own frames (and Chrome's "Error" first line; Safari has none)
	const stack = () => (new Error().stack || "").split("\n").map(s => s.trim()).filter(s => s && s !== "Error" && !s.includes("carettrace.js")).slice(0, 8).join("\n");
	for ( const method of ["collapse", "setPosition", "addRange", "removeAllRanges", "removeRange", "setBaseAndExtent", "modify", "collapseToStart", "collapseToEnd", "selectAllChildren", "extend", "empty"] ) {
		const original = Selection.prototype[method];
		if ( typeof original !== "function" ) { continue }
		Selection.prototype[method] = function(...args){
			if ( caretTraceOn ) { add({ type: "call", method, stack: stack() }) }
			return original.apply(this, args);
		};
	}

	const describe = (node) => !node ? "null" : node.nodeType === Node.TEXT_NODE ? `#text "${node.data.slice(0, 30)}"` : `<${node.nodeName.toLowerCase()}${node.id ? "#" + node.id : ""}${typeof node.className === "string" && node.className ? "." + node.className.trim().split(/\s+/).join(".") : ""}>`;
	const elementOf = (node) => node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;

	function position(){
		// where the caret is: its editor (or what else has it), its y from the editor's top, its line block and node
		const selection = window.getSelection();
		if ( !selection.rangeCount ) { return { where: "none" } }
		const node = selection.focusNode;
		const editor = elementOf(node)?.closest(".editor");
		if ( !editor ) { return { where: describe(elementOf(node)) } }
		let rect = null;
		try {
			const range = document.createRange();
			range.setStart(node, selection.focusOffset);
			rect = range.getClientRects()[0] || null;
		} catch ( err ) { /* a position the range can't take */ }
		if ( !rect || (!rect.height && !rect.width && !rect.top) ) {
			const child = node.nodeType === Node.ELEMENT_NODE ? node.childNodes[selection.focusOffset] || node.childNodes[selection.focusOffset - 1] : null;
			rect = elementOf(child || node)?.getBoundingClientRect() || null;
		}
		const y = rect ? Math.round(rect.top - editor.getBoundingClientRect().top) : null;
		let block = node;
		while ( block && block.parentNode !== editor && block !== editor ) { block = block.parentNode }
		return {
			editor, where: "editor", y,
			block: block === editor ? `between ${selection.focusOffset - 1} and ${selection.focusOffset}` : [...editor.childNodes].indexOf(block),
			node: describe(node), offset: selection.focusOffset,
			// the caret's own line: its list item, heading, cell... not all of a list
			text: block === editor ? "" : ownLineText(elementOf(node)?.closest("li, h1, h2, h3, h4, td, th, pre, blockquote, div:not(.editor)") || block),
		};
	}
	function ownLineText(el){
		// without its nested lists
		const text = [...(el?.childNodes || [])].filter(n => n.nodeName !== "UL" && n.nodeName !== "OL").map(n => n.textContent).join("");
		return text.slice(0, 40);
	}
	const plain = (p) => { const { editor, ...rest } = p; return rest };

	function saveRecord(kind, extra){
		const at = now();
		const record = {
			kind, time: new Date().toISOString(), ...extra,
			timeline: (kind === "manual" && caretTraceSnapshot ? caretTraceSnapshot : caretTimeline).map(e => ({ ...e, ago: at - e.at })),
			userAgent: navigator.userAgent, viewport: `${innerWidth}x${innerHeight}`,
		};
		console.warn("Caret trace", record);
		try {
			localStorage.setItem(caretTraceLogKey, JSON.stringify([...readCaretTrace(), record].slice(-20)));
		} catch ( err ) {
			// too big for the storage: the oldest records go
			try { localStorage.setItem(caretTraceLogKey, JSON.stringify([record])) } catch ( err2 ) { /* the console has it */ }
		}
		return record;
	}
	window.saveCaretTraceRecord = saveRecord;

	document.addEventListener("keydown", (e) => {
		if ( caretTraceOn ) { add({ type: "key", key: e.key, mods: [e.ctrlKey && "ctrl", e.metaKey && "meta", e.altKey && "alt", e.shiftKey && "shift"].filter(Boolean).join("+"), target: describe(e.target) }) }
	}, true);
	document.addEventListener("pointerdown", (e) => {
		lastPointer = now();
		if ( caretTraceOn ) { add({ type: "pointer", target: describe(e.target), x: Math.round(e.clientX), y: Math.round(e.clientY) }) }
	}, true);
	for ( const type of ["wheel", "touchmove"] ) {
		document.addEventListener(type, () => { lastWheel = now() }, { capture: true, passive: true });
	}
	document.addEventListener("focusin", (e) => { if ( caretTraceOn ) { add({ type: "focus", target: describe(e.target) }) } }, true);
	document.addEventListener("selectionchange", () => {
		if ( !caretTraceOn ) { last = null; return }
		const current = position();
		add({ type: "caret", ...plain(current) });
		const before = last;
		last = current;
		if ( !before?.editor || before.editor !== current.editor || before.y === null || current.y === null ) { return }
		if ( Math.abs(current.y - before.y) <= jumpPx || now() - lastPointer < 600 ) { return }
		saveRecord("jump", { from: plain(before), to: plain(current) });
		if ( typeof createNotification === "function" ) { createNotification("Caret jump recorded (Account > Diagnostics)", "warning") }
	});
	document.addEventListener("scroll", (e) => {
		if ( !caretTraceOn || !e.target.classList?.contains("pane-scroll") ) { return }
		const top = Math.round(e.target.scrollTop);
		const before = scrolls.get(e.target);
		scrolls.set(e.target, top);
		add({ type: "scroll", top });
		if ( before === undefined || Math.abs(top - before) <= scrollJumpPx || now() - lastWheel < 600 || now() - lastPointer < 600 ) { return }
		saveRecord("scroll jump", { from: before, to: top, caret: plain(position()) });
		if ( typeof createNotification === "function" ) { createNotification("Scroll jump recorded (Account > Diagnostics)", "warning") }
	}, true);

	// the editors are made by workspace.js later: the grid is watched once the page is there
	document.addEventListener("DOMContentLoaded", () => {
		const grid = document.getElementById("editor-grid");
		if ( !grid ) { return }
		new MutationObserver((records) => {
			if ( !caretTraceOn ) { return }
			for ( const r of records ) {
				if ( !r.target.closest?.(".editor") ) { continue }
				if ( r.type === "childList" && (r.removedNodes.length || r.addedNodes.length) ) {
					add({ type: "dom", target: describe(r.target), removed: r.removedNodes.length, added: r.addedNodes.length });
				} else if ( r.type === "attributes" ) {
					add({ type: "attr", target: describe(r.target), name: r.attributeName });
				}
			}
		}).observe(grid, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-collapsed", "class", "hidden", "contenteditable"] });
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
	// the timeline up to the opening of the Account window, before the clicks to get here
	caretTraceSnapshot = caretTimeline.slice();
	const log = readCaretTrace();
	const count = log.length;
	return `
	<h3>Diagnostics</h3>
	<div class="stack" id="caret-trace-section">
		<label class="check"><input id="setting-caret-trace" type="checkbox"${caretTraceOn ? " checked" : ""} onchange="setCaretTrace(this.checked)">Record caret jumps</label>
		<p class="muted small">While on, the last 30 seconds of the editor's activity are kept on this device. A caret jump is saved by itself; if it isn't, open this window right after it and press <em>Save what just happened</em>. Send the log with the bug report.</p>
		<div class="row">
			<button class="btn" type="button" onclick="saveCaretTraceNow()"${caretTraceOn ? "" : " disabled"}>Save what just happened</button>
			<button class="btn" type="button" onclick="copyCaretTraceLog()"${count ? "" : " disabled"}>Copy log (<span id="caret-trace-count">${count}</span>)</button>
			${navigator.share ? `<button class="btn" type="button" onclick="shareCaretTraceLog()"${count ? "" : " disabled"}>Share log</button>` : ""}
			<button class="btn" type="button" onclick="clearCaretTraceLog()"${count ? "" : " disabled"}>Clear log</button>
		</div>
		<details${count ? "" : " hidden"}><summary class="small">Show log</summary><textarea readonly rows="8" style="width:100%;font-family:var(--font-mono);font-size:.75rem">${escapeCaretTrace(JSON.stringify(log, null, 1))}</textarea></details>
	</div>`;
}

function escapeCaretTrace(text){
	return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function refreshCaretTraceSection(){
	const section = document.getElementById("caret-trace-section");
	if ( !section ) { return }
	const snapshot = caretTraceSnapshot;
	const holder = document.createElement("div");
	holder.innerHTML = caretTraceHtml();
	caretTraceSnapshot = snapshot; // still the one from when the window opened
	section.replaceWith(holder.querySelector("#caret-trace-section"));
}

function setCaretTrace(on){
	caretTraceOn = on;
	if ( !on ) { caretTimeline = [] }
	try { on ? localStorage.setItem(caretTraceKey, "1") : localStorage.removeItem(caretTraceKey) } catch ( err ) { /* this page only */ }
	refreshCaretTraceSection();
	if ( typeof createNotification === "function" ) { createNotification(on ? "Recording caret jumps on this device" : "Caret jumps are no longer recorded", "info") }
}

function saveCaretTraceNow(){
	const record = saveCaretTraceRecord("manual", { note: "saved by hand from Account > Diagnostics" });
	refreshCaretTraceSection();
	createNotification(`Saved the last ${Math.round((record.timeline[0]?.ago || 0) / 1000)} s (${record.timeline.length} events)`, "info");
}

async function copyCaretTraceLog(){
	const text = JSON.stringify(readCaretTrace(), null, 1);
	try {
		await navigator.clipboard.writeText(text);
		createNotification("Caret log copied", "info");
	} catch ( err ) {
		// no clipboard (e.g. not https): the log is selected in the box to copy by hand
		const details = document.querySelector("#caret-trace-section details");
		if ( details ) { details.hidden = false; details.open = true; details.querySelector("textarea").select() }
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
