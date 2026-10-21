/*
 * Code blocks: a "Copy" button in the top right corner of each code block (<pre>) copies its text. It shows while the
 * pointer is over the block or the caret is in it, and always, faintly, on touch screens.
 * Like the line numbers and the comments, the buttons are drawn in the editor's card, outside the editor, so they are
 * never part of the document.
 */
const codeCopyLayers = new Map(); // editor -> layer of its buttons
let codeCopyFrame = 0;
let codeCopyHovered = null; // the code block under the pointer

function codeCopyLayer(editor){
	let layer = codeCopyLayers.get(editor);
	const card = editor.closest(".editor-card");
	if ( layer && layer.parentElement === card ) { return layer }
	layer = document.createElement("div");
	layer.className = "code-copy-layer";
	card.append(layer);
	codeCopyLayers.set(editor, layer);
	return layer;
}

function renderCodeCopy(editor){
	const blocks = [...editor.querySelectorAll("pre")];
	if ( !blocks.length && !codeCopyLayers.has(editor) ) { return }
	const layer = codeCopyLayer(editor);
	const origin = layer.getBoundingClientRect();
	const buttons = [...layer.children];
	blocks.forEach((pre, i) => {
		let button = buttons[i];
		if ( !button ) {
			button = layer.appendChild(document.createElement("button"));
			button.type = "button";
			button.className = "small-btn code-copy";
			button.textContent = "Copy";
			button.title = "Copy the code";
			button.setAttribute("aria-label", "Copy the code");
			button.addEventListener("mousedown", (e) => e.preventDefault()); // the editor keeps its caret
			button.addEventListener("click", () => copyCodeBlock(button));
		}
		button.pre = pre;
		const rect = pre.getBoundingClientRect();
		// a block in a collapsed section has no box
		button.hidden = !rect.height;
		// set only on change: a change is a mutation the other margins' observers redraw for
		const top = `${rect.top - origin.top + 4}px`;
		const right = `${origin.right - rect.right + 4}px`;
		if ( rect.height && button.style.top !== top ) { button.style.top = top }
		if ( rect.height && button.style.right !== right ) { button.style.right = right }
	});
	buttons.slice(blocks.length).forEach((button) => button.remove());
	markShownCodeCopy();
}

function markShownCodeCopy(){
	// the button of the block under the pointer, and of the block with the caret
	const selection = window.getSelection();
	const caret = selection.rangeCount ? selection.focusNode : null;
	for ( const layer of codeCopyLayers.values() ) {
		for ( const button of layer.children ) {
			button.classList.toggle("shown", button.pre === codeCopyHovered || Boolean(caret && button.pre.contains(caret)));
		}
	}
}

async function copyCodeBlock(button){
	const text = button.pre.innerText.replace(/\n$/, "");
	try {
		await copyText(text);
	} catch ( err ) {
		informError("Could not copy the code!", err);
		return
	}
	button.textContent = "Copied";
	button.classList.add("copied");
	clearTimeout(button.copiedTimer);
	button.copiedTimer = setTimeout(() => {
		button.textContent = "Copy";
		button.classList.remove("copied");
	}, 1500);
}

async function copyText(text){
	// the clipboard API needs https (or localhost); elsewhere the old way, through a selected textarea
	if ( navigator.clipboard?.writeText && window.isSecureContext ) { return navigator.clipboard.writeText(text) }
	const area = document.createElement("textarea");
	area.value = text;
	area.setAttribute("readonly", "");
	area.style.cssText = "position: fixed; opacity: 0; pointer-events: none";
	document.body.append(area);
	const selection = window.getSelection();
	const saved = selection.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
	const focused = document.activeElement;
	area.select();
	const copied = document.execCommand("copy");
	area.remove();
	focused?.focus?.({preventScroll: true});
	if ( saved ) { selection.removeAllRanges(); selection.addRange(saved) }
	if ( !copied ) { throw new Error("copy command failed") }
}

function scheduleCodeCopy(){
	if ( codeCopyFrame ) { return }
	codeCopyFrame = requestAnimationFrame(() => {
		codeCopyFrame = 0;
		for ( const editor of codeCopyLayers.keys() ) {
			if ( !editor.isConnected ) {
				codeCopyLayers.get(editor).remove();
				codeCopyLayers.delete(editor);
			}
		}
		document.querySelectorAll("#editor-grid .editor").forEach((editor) => {
			codeCopyResizeObserver.observe(editor);
			renderCodeCopy(editor);
		});
	});
}

// the buttons follow the blocks: edits, documents opened, folds, split editors, wrapping when the width changes
const codeCopyResizeObserver = new ResizeObserver(scheduleCodeCopy);
// not for the margins drawn around the editors (these buttons, the line numbers, the comments)
const editorMargins = ".code-copy-layer, .line-numbers, .line-comments";
new MutationObserver((records) => {
	if ( records.some((r) => !r.target.closest?.(editorMargins) && !r.target.parentElement?.closest(editorMargins)) ) { scheduleCodeCopy() }
}).observe(document.getElementById("editor-grid"), {childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["class", "data-collapsed"]});
document.getElementById("editor-grid").addEventListener("mouseover", (e) => {
	const button = e.target.closest?.(".code-copy");
	const pre = button ? button.pre : e.target.closest?.(".editor pre") || null;
	if ( pre === codeCopyHovered ) { return }
	codeCopyHovered = pre;
	markShownCodeCopy();
});
document.getElementById("editor-grid").addEventListener("mouseleave", () => {
	codeCopyHovered = null;
	markShownCodeCopy();
});
document.addEventListener("selectionchange", markShownCodeCopy);
window.addEventListener("resize", scheduleCodeCopy);
document.fonts?.ready.then(scheduleCodeCopy);
scheduleCodeCopy();
