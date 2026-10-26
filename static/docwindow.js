/*
 * The document window: a document opened on its own in a browser window (tab) of its own, like a link with
 * target="_blank" (?window={document id}, from Menu > Open in New Window or the right-click menu of a document or a tab).
 * It is focus mode that stays on: only the text, the word count, an x that closes the window and a menu next to it with
 * the table of contents (#doc-window-toc, toc.js), search (search.js), inserting HTML or Markdown, copying and exporting.
 * No other document can be opened in it (focusEditorsLocked, workspace.js); a link to another document opens that one in
 * a window of its own. It saves to the same localStorage as the app: the app's tabs of the document show what is saved
 * here (the storage listener, workspace.js), and the window never changes the app's opened tabs, editors, layout or last
 * opened document.
 */
let docWindowTab = null; // the window's document, once it is opened
let docWindowClosing = false; // the x asked about unsaved edits already: the page leaves without asking again

if ( isDocWindow ) {
	// the app's panels stay as they are, the window has its own table of contents
	Object.assign(layout, { tocHidden: true, treeHidden: true });
	applyLayout();
	const exit = document.getElementById("focus-exit-btn");
	exit.title = "Close window";
	exit.setAttribute("aria-label", "Close window");
	document.getElementById("doc-window-menu-btn").addEventListener("click", toggleDocWindowMenu);
	document.getElementById("doc-window-menu-list").addEventListener("click", (e) => {
		const action = e.target.closest("[data-action]")?.dataset.action;
		if ( !action ) { return }
		closeDocWindowMenu();
		docWindowActions[action]();
	});
	document.addEventListener("click", (e) => { if ( !e.target.closest?.("#doc-window-menu") ) { closeDocWindowMenu() } });
}

const docWindowActions = {
	"toc": () => openTableOfContents(true),
	"find": () => openFind(),
	"insert-html": createInsertHtmlModal,
	"insert-markdown": createInsertMarkdownModal,
	"copy-md": () => { copyMarkdown(); createNotification("Copied as Markdown!", "info", notificationTimeoutShort) },
	"export": exportDocument,
	"export-md": exportMarkdown,
};

function openDocumentWindow(name){
	// the window loads the document from localStorage: it must be saved, with its edits
	if ( !name || !documentExists(name) ) {
		createNotification("Save the document first to open it in a new window", "warning");
		return
	}
	if ( tabs.some(t => t.name === name && t.dirty) ) {
		createNotification(`'${name}' has unsaved changes, save it first to open it in a new window`, "warning");
		return
	}
	ensureDocumentIds();
	window.open(`/?${docWindowParam}=${encodeURIComponent(documentIdOf(name))}`, "_blank");
}

function openDocWindow(){
	// on load (script.js), instead of the last opened document
	const name = documentNameById(docWindowId);
	if ( name === null ) {
		informError("The document has not been found, it may have been deleted", "", "warning");
		return
	}
	if ( !openDocumentInTab(name) ) { return }
	docWindowTab = getActiveTab();
	toggleFocusMode(true);
}

function closeDocWindow(){
	if ( docWindowTab?.dirty && !showConfirm(`'${getDocumentName() || untitledTabLabel}' has unsaved changes. Close it anyway?`) ) { return }
	docWindowClosing = true;
	window.close();
	// a window the browser doesn't let a page close (opened by hand, with history) becomes the app
	setTimeout(() => window.location.replace("/"), 100);
}

function toggleDocWindowMenu(e){
	// the click mustn't reach the document, which closes the menu
	e?.stopPropagation();
	document.getElementById("doc-window-menu-list").classList.toggle("menu-opened");
}

function closeDocWindowMenu(){
	document.getElementById("doc-window-menu-list").classList.remove("menu-opened");
}
