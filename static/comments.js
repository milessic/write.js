/*
 * Comments: hover a line and click the "+" right of it to add a comment. A line's comments are its data-comments attribute, a JSON list of
 * {id, by, date, text, resolved}, so they are saved and synced with the document. The line is the list item clicked in,
 * or else the editor's block (a <div>, a heading, ...). The right click keeps the browser's own menu (spelling etc.).
 * A line with comments gets a comment icon in the margin right of it: red while any comment is unresolved, green when
 * all are. The icon opens the comments, newest first; their authors can mark them resolved.
 * The icons and the comments are drawn outside the editor (like the line numbers, linenumbers.js), never in the document.
 * Comment text is plain text: it is cleaned of control characters, capped in length and only ever shown as text.
 */
const commentMaxLength = 5000;
const commentIcon = `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M4 3h16a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H9l-5 4v-4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/></svg>`;
const commentViews = new Map(); // editor -> {layer, add}
let commentsFrame = 0;
let commentsPopover = null; // {el, line, editor, range, scroller, scrollTop}
let commentHover = null; // {editor, line}: the line the "+" is shown for; a text node until it gets its own <div>

function commentUser(){
	// the logged in user (routers/web.py), or one name for everyone writing locally
	return document.body.dataset.user || "Anonymous";
}

function sanitizeCommentText(text){
	return String(text ?? "")
		.replace(/\r\n?/g, "\n")
		.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁦-⁩]/g, "")
		.trim()
		.slice(0, commentMaxLength);
}

function lineComments(line){
	// the line's comments, newest first; anything malformed (imported, synced) is left out
	let list;
	try { list = JSON.parse(line.dataset.comments || "[]") } catch { return [] }
	if ( !Array.isArray(list) ) { return [] }
	return list
		.filter((c) => c && typeof c === "object" && typeof c.text === "string" && !isNaN(Date.parse(c.date)))
		.map((c) => ({
			id: String(c.id || ""),
			by: sanitizeCommentText(c.by).slice(0, 100) || "Anonymous",
			date: new Date(c.date).toISOString(),
			text: sanitizeCommentText(c.text),
			resolved: c.resolved === true,
		}))
		.filter((c) => c.text)
		.sort((a, b) => b.date.localeCompare(a.date));
}

function setLineComments(line, comments){
	if ( comments.length ) {
		line.dataset.comments = JSON.stringify(comments);
	} else {
		line.removeAttribute("data-comments");
	}
	// the comments are part of the document: it changed like after an edit (unsaved tab, autosave)
	const editor = line.closest(".editor");
	editor.dispatchEvent(new Event("input", { bubbles: true }));
	if ( editor.id === "editor" ) { performAutoSave() }
}

function newCommentId(){
	return crypto.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function addComment(line, text){
	const clean = sanitizeCommentText(text);
	if ( !clean ) { return false }
	const comments = lineComments(line);
	comments.unshift({ id: newCommentId(), by: commentUser(), date: new Date().toISOString(), text: clean, resolved: false });
	setLineComments(line, comments);
	return true;
}

function resolveComment(line, id){
	// only its author resolves a comment
	const comments = lineComments(line);
	const comment = comments.find((c) => c.id === id);
	if ( !comment || comment.by !== commentUser() ) { return }
	comment.resolved = true;
	setLineComments(line, comments);
}

function commentLineAt(editor, target, x, y, create=true){
	// the line the pointer is on: its list item, or the editor's block holding it
	let node = target;
	if ( node === editor ) {
		const caret = document.caretPositionFromPoint?.(x, y);
		node = caret ? caret.offsetNode : document.caretRangeFromPoint?.(x, y)?.startContainer;
		if ( node === editor ) { node = editor.childNodes[caret?.offset ?? 0] || editor.lastChild }
	}
	if ( !node || !editor.contains(node) || node === editor ) { return null }
	const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
	const item = element.closest("li");
	if ( item && editor.contains(item) ) { return item }
	while ( node.parentNode !== editor ) { node = node.parentNode }
	if ( node.nodeType === Node.ELEMENT_NODE ) { return node.nodeName === "HR" ? null : node }
	// text typed straight into the editor gets a line <div> to hold its comments
	if ( node.nodeType !== Node.TEXT_NODE || node.data.trim() === "" ) { return null }
	return create ? wrapCommentLine(node) : node;
}

function wrapCommentLine(node){
	if ( node.nodeType === Node.ELEMENT_NODE ) { return node }
	const line = document.createElement("div");
	node.before(line);
	line.appendChild(node);
	return line;
}

function normalizeComments(editor){
	// Enter splits a line into two with the same attributes: a comment stays on one line only, the one with the text
	const holders = new Map(); // comment id -> lines holding it
	for ( const line of editor.querySelectorAll("[data-comments]") ) {
		for ( const comment of lineComments(line) ) {
			if ( !comment.id ) { continue }
			if ( !holders.has(comment.id) ) { holders.set(comment.id, []) }
			holders.get(comment.id).push(line);
		}
	}
	const dropFrom = new Map(); // line -> ids it loses
	for ( const [id, lines] of holders ) {
		if ( lines.length < 2 ) { continue }
		const withText = lines.filter((line) => line.textContent.trim() !== "");
		const keep = withText.length === 1 ? withText[0] : lines[0];
		for ( const line of lines ) {
			if ( line === keep ) { continue }
			if ( !dropFrom.has(line) ) { dropFrom.set(line, new Set()) }
			dropFrom.get(line).add(id);
		}
	}
	for ( const [line, ids] of dropFrom ) {
		const rest = lineComments(line).filter((c) => !ids.has(c.id));
		rest.length ? line.dataset.comments = JSON.stringify(rest) : line.removeAttribute("data-comments");
	}
}

function commentsView(editor){
	let view = commentViews.get(editor);
	const card = editor.closest(".editor-card");
	if ( view && view.layer.parentElement === card ) { return view }
	view?.add.remove();
	const layer = document.createElement("div");
	layer.className = "line-comments";
	card.append(layer);
	const add = document.createElement("button");
	add.type = "button";
	add.className = "line-comment-add";
	add.title = "Add comment";
	add.setAttribute("aria-label", "Add comment");
	add.innerHTML = `<span aria-hidden="true">+</span>${commentIcon}`;
	add.hidden = true;
	add.addEventListener("mousedown", (e) => e.preventDefault()); // the editor keeps its caret and scroll
	add.addEventListener("click", () => {
		if ( commentHover?.editor !== editor || !commentHover.line.isConnected ) { return }
		const line = wrapCommentLine(commentHover.line);
		hideCommentAdd();
		openCommentsPopover(editor, line, true);
	});
	card.append(add);
	view = {layer, add};
	commentViews.set(editor, view);
	return view;
}

function commentLineRect(line){
	// the box of the line's first line of text; null when it is hidden (a collapsed section or item)
	if ( line.nodeType === Node.TEXT_NODE ) {
		const range = document.createRange();
		range.selectNodeContents(line);
		const first = range.getClientRects()[0];
		return first?.height ? {top: first.top, height: first.height} : null;
	}
	const rect = line.getBoundingClientRect();
	if ( !rect.height ) { return null }
	const style = getComputedStyle(line);
	const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.5;
	const top = rect.top + (parseFloat(style.paddingTop) || 0) + (parseFloat(style.borderTopWidth) || 0);
	return {top, height: Math.min(lineHeight, rect.height)};
}

function renderComments(editor){
	const lines = [...editor.querySelectorAll("[data-comments]")]
		.map((line) => ({line, comments: lineComments(line)}))
		.filter(({comments}) => comments.length);
	const card = editor.closest(".editor-card");
	if ( !card ) { return }
	card.classList.toggle("has-comments", lines.length > 0);
	if ( !lines.length && !commentViews.has(editor) ) { return }
	const view = commentsView(editor);
	const origin = view.layer.getBoundingClientRect().top;
	const icons = [...view.layer.children];
	lines.forEach(({line, comments}, i) => {
		let icon = icons[i];
		if ( !icon ) {
			icon = view.layer.appendChild(document.createElement("button"));
			icon.type = "button";
			icon.className = "line-comment";
			icon.innerHTML = commentIcon;
			icon.addEventListener("mousedown", (e) => e.preventDefault()); // the editor keeps its caret
			icon.addEventListener("click", () => openCommentsPopover(editor, icon.line, false));
		}
		icon.line = line;
		const open = comments.filter((c) => !c.resolved).length;
		icon.classList.toggle("resolved", open === 0);
		const label = `${comments.length} comment${comments.length === 1 ? "" : "s"}${open ? `, ${open} unresolved` : ", resolved"}`;
		icon.title = label;
		icon.setAttribute("aria-label", label);
		const rect = commentLineRect(line);
		icon.hidden = !rect;
		if ( rect ) {
			icon.style.top = `${rect.top - origin}px`;
			icon.style.height = `${rect.height}px`;
		}
	});
	icons.slice(lines.length).forEach((icon) => icon.remove());
	if ( commentHover?.editor === editor ) { placeCommentAdd() }
	if ( commentsPopover?.editor === editor ) { refreshCommentsPopover() }
}

function placeCommentAdd(){
	// the "+" right of the hovered line, for a line without comments (one with them has its own icon)
	const {editor, line} = commentHover;
	const view = commentViews.get(editor);
	const rect = line.isConnected && editor.contains(line) && !(line.nodeType === Node.ELEMENT_NODE && lineComments(line).length)
		? commentLineRect(line) : null;
	if ( !view || !rect ) { hideCommentAdd(); return }
	const origin = view.layer.getBoundingClientRect().top;
	view.add.style.top = `${rect.top - origin}px`;
	view.add.style.height = `${rect.height}px`;
	view.add.hidden = false;
}

function hideCommentAdd(){
	commentHover = null;
	for ( const {add} of commentViews.values() ) { add.hidden = true }
}

function handleCommentsHover(e){
	if ( e.target.closest?.(".line-comment-add") ) { return }
	const editor = e.target.closest?.(".editor");
	if ( !editor ) {
		// the pointer is on its way across the card's margin to the "+": it stays
		if ( !commentHover || !commentHover.editor.closest(".editor-card").contains(e.target) ) { hideCommentAdd() }
		return;
	}
	if ( commentsPopover ) { hideCommentAdd(); return }
	const line = commentLineAt(editor, e.target, e.clientX, e.clientY, false);
	if ( !line ) { hideCommentAdd(); return }
	if ( commentHover?.editor === editor && commentHover.line === line ) { return }
	hideCommentAdd();
	commentsView(editor);
	commentHover = {editor, line};
	placeCommentAdd();
}

function scheduleComments(){
	if ( commentsFrame ) { return }
	commentsFrame = requestAnimationFrame(() => {
		commentsFrame = 0;
		for ( const editor of commentViews.keys() ) {
			if ( !editor.isConnected ) {
				commentViews.get(editor).layer.remove();
				commentViews.get(editor).add.remove();
				commentViews.delete(editor);
			}
		}
		document.querySelectorAll("#editor-grid .editor").forEach((editor) => {
			commentsResizeObserver.observe(editor);
			renderComments(editor);
		});
	});
}

function formatCommentDate(iso){
	return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function commentItem(line, comment){
	const item = document.createElement("li");
	item.className = "comment" + (comment.resolved ? " resolved" : "");
	const meta = document.createElement("div");
	meta.className = "comment-meta";
	const by = document.createElement("strong");
	by.textContent = comment.by;
	const date = document.createElement("time");
	date.dateTime = comment.date;
	date.textContent = formatCommentDate(comment.date);
	meta.append(by, date);
	if ( comment.resolved ) {
		const badge = document.createElement("span");
		badge.className = "comment-badge";
		badge.textContent = "Resolved";
		meta.append(badge);
	} else if ( comment.by === commentUser() ) {
		const resolve = document.createElement("button");
		resolve.type = "button";
		resolve.className = "small-btn comment-resolve";
		resolve.textContent = "Resolve";
		resolve.addEventListener("click", () => resolveComment(line, comment.id));
		meta.append(resolve);
	}
	const text = document.createElement("div");
	text.className = "comment-text";
	text.textContent = comment.text;
	item.append(meta, text);
	return item;
}

function openCommentsPopover(editor, line, focusNew){
	closeCommentsPopover();
	const el = document.createElement("div");
	el.className = "menu comments-popover menu-opened";
	el.setAttribute("role", "dialog");
	el.setAttribute("aria-label", "Comments");
	el.innerHTML = `
		<div class="comments-head"><span>Comments</span><button type="button" class="small-btn comments-close" title="Close" aria-label="Close">✕</button></div>
		<ul class="comments-list"></ul>
		<textarea class="comment-input" rows="3" maxlength="${commentMaxLength}" placeholder="Add a comment" aria-label="New comment"></textarea>
		<div class="comments-actions"><span class="muted small">Ctrl+Enter</span><button type="button" class="btn primary small comment-add">Comment</button></div>`;
	document.body.append(el);
	// closing it puts the caret back where it was, without scrolling the document (focus() would, to its start)
	const selection = window.getSelection();
	const range = selection.rangeCount && editor.contains(selection.anchorNode) ? selection.getRangeAt(0).cloneRange() : null;
	const scroller = editor.closest(".pane-scroll");
	commentsPopover = {el, line, editor, range, scroller, scrollTop: scroller?.scrollTop};
	const input = el.querySelector(".comment-input");
	const submit = () => {
		if ( !line.isConnected || !addComment(line, input.value) ) { return }
		input.value = "";
		input.focus();
	};
	el.querySelector(".comment-add").addEventListener("click", submit);
	el.querySelector(".comments-close").addEventListener("click", () => closeCommentsPopover(true));
	input.addEventListener("keydown", (e) => {
		if ( e.key === "Enter" && (e.ctrlKey || e.metaKey) ) { e.preventDefault(); submit() }
	});
	refreshCommentsPopover();
	if ( focusNew || !lineComments(line).length ) { input.focus() } else { el.querySelector(".comment-add").focus() }
}

function refreshCommentsPopover(){
	const {el, line} = commentsPopover;
	if ( !line.isConnected ) { closeCommentsPopover(); return }
	const list = el.querySelector(".comments-list");
	list.replaceChildren(...lineComments(line).map((comment) => commentItem(line, comment)));
	list.hidden = !list.children.length;
	placeCommentsPopover();
}

function placeCommentsPopover(){
	// right of the line (over the margin), kept inside the viewport
	const {el, line, editor} = commentsPopover;
	const rect = commentLineRect(line);
	if ( !rect ) { closeCommentsPopover(); return }
	const card = editor.closest(".editor-card").getBoundingClientRect();
	const {width, height} = el.getBoundingClientRect();
	el.style.left = Math.max(4, Math.min(card.right - width - 8, window.innerWidth - width - 4)) + "px";
	// under the line, or over it when there's no room, or as low as it fits
	const below = rect.top + rect.height + 4;
	const above = rect.top - height - 4;
	const top = below + height <= window.innerHeight - 4 ? below : above >= 4 ? above : window.innerHeight - height - 4;
	el.style.top = Math.max(4, top) + "px";
}

function closeCommentsPopover(restoreCaret=false){
	if ( !commentsPopover ) { return false }
	const {el, editor, range, scroller, scrollTop} = commentsPopover;
	el.remove();
	commentsPopover = null;
	if ( restoreCaret && editor.isConnected ) {
		editor.focus({preventScroll: true});
		if ( range && editor.contains(range.commonAncestorContainer) ) {
			const selection = window.getSelection();
			selection.removeAllRanges();
			selection.addRange(range);
		}
		if ( scroller ) { scroller.scrollTop = scrollTop }
	}
	return true;
}

document.getElementById("editor-grid").addEventListener("mousemove", handleCommentsHover);
document.getElementById("editor-grid").addEventListener("mouseleave", hideCommentAdd);
document.getElementById("editor-grid").addEventListener("input", (e) => {
	const editor = e.target.closest?.(".editor");
	if ( editor ) { normalizeComments(editor) }
});
document.addEventListener("mousedown", (e) => {
	if ( commentsPopover && !commentsPopover.el.contains(e.target) && !e.target.closest?.(".line-comment, .context-menu") ) { closeCommentsPopover() }
}, true);
document.addEventListener("scroll", () => { if ( commentsPopover ) { placeCommentsPopover() } }, true);
// the icons follow the text: edits, documents opened, folds, split editors, wrapping when the width changes
const commentsResizeObserver = new ResizeObserver(scheduleComments);
new MutationObserver((records) => {
	if ( records.some((r) => !r.target.closest?.(".line-comments") && !r.target.parentElement?.closest(".line-comments")) ) { scheduleComments() }
}).observe(document.getElementById("editor-grid"), {childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["class", "data-collapsed", "data-comments", "data-checked"]});
window.addEventListener("resize", scheduleComments);
document.fonts?.ready.then(scheduleComments);
document.querySelectorAll("#editor-grid .editor").forEach(normalizeComments);
scheduleComments();
