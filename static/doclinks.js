// links between Write.JS documents (Insert Link > Write.JS doc).
// Every stored document starts with a hidden <div style="display:none;" data-id="{uuid}"></div>, and one with its
// metadata after it if it has any. The editors never show them: loading a document takes the id and the metadata onto
// its tab (workspace.js loadPane) and saving puts them back, so a link keeps pointing at its document after a rename or
// a move to another folder.
// A link is <a data-doc-id="{uuid}" href="?doc={uuid}">: a click opens the document's tab, or a new one;
// a ctrl/middle click opens the app in a new browser tab with that document.
const docIdPattern = /^<div style="display:none;" data-id="([^"]+)"><\/div>/;
// right after it, a document's metadata, e.g. {"showTitle": true} (the title, workspace.js), as JSON
const docMetaPattern = /^<div style="display:none;" data-meta="([^"]*)"><\/div>/;
const docLinkParam = "doc";

ensureDocumentIds(false);
document.getElementById("editor-grid").addEventListener("click", handleDocumentLinkClick);
window.addEventListener("load", openDocumentFromQuery);

function newDocumentId(){
	if ( crypto.randomUUID ) { return crypto.randomUUID() }
	// crypto.randomUUID needs https, getRandomValues doesn't
	const bytes = crypto.getRandomValues(new Uint8Array(16));
	bytes[6] = (bytes[6] & 0x0f) | 0x40;
	bytes[8] = (bytes[8] & 0x3f) | 0x80;
	return formatDocumentId([...bytes].map(b => b.toString(16).padStart(2, "0")).join(""));
}

function legacyDocumentId(name){
	// a document from before the ids gets one from its name, so every device gives it the same one
	// and syncing the migrated notebook doesn't make conflicts
	let hex = "";
	for ( let i = 0; hex.length < 32; i++ ) { hex += parseInt(hashText(`${i}:${name}`), 36).toString(16).padStart(14, "0") }
	return formatDocumentId(hex.slice(0, 12) + "5" + hex.slice(13, 16) + "8" + hex.slice(17, 32));
}

function formatDocumentId(hex){
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function splitDocumentId(html){
	// {id, html, meta}: a stored document's id (null without one), its content and its metadata (documentMeta)
	const match = (html ?? "").match(docIdPattern);
	if ( !match ) { return { id: null, html: html ?? "", meta: {} } }
	const rest = html.slice(match[0].length);
	const meta = rest.match(docMetaPattern);
	if ( !meta ) { return { id: match[1], html: rest, meta: {} } }
	let parsed = {};
	try { parsed = JSON.parse(unescapeHtmlAttribute(meta[1])) } catch ( err ) {}
	return { id: match[1], html: rest.slice(meta[0].length), meta: parsed && typeof parsed === "object" ? parsed : {} };
}

function withDocumentId(html, id, meta=undefined){
	// the metadata of html stays, unless other is given
	const split = splitDocumentId(html);
	meta = meta ?? split.meta;
	const metaDiv = meta && Object.keys(meta).length ? `<div style="display:none;" data-meta="${escapeHtmlText(JSON.stringify(meta))}"></div>` : "";
	return `<div style="display:none;" data-id="${id}"></div>` + metaDiv + split.html;
}

function unescapeHtmlAttribute(text){
	return text.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

function documentIdOf(name){
	// a folder opened as the notebook knows the ids without reading the documents (localnotebooks.js)
	if ( notebookStorage.documentId ) { return notebookStorage.documentId(name) }
	return splitDocumentId(notebookStorage.getItem(docPrefix + name)).id;
}

function documentNameById(id){
	for ( const name of getDocumentNamesFromLocalStorage() || [] ) {
		if ( documentIdOf(name) === id ) { return name }
	}
	return null;
}

function ensureDocumentIds(withTabs=true){
	// documents without an id get one; a copy that came with another document's id gets its own
	if ( !validateUserConsent(false) ) { return }
	const seen = new Set();
	for ( const name of getDocumentNamesFromLocalStorage() ) {
		const key = docPrefix + name;
		let id = documentIdOf(name);
		if ( !id || seen.has(id) ) {
			const stored = notebookStorage.getItem(key);
			id = id ? newDocumentId() : legacyDocumentId(name);
			notebookStorage.setItem(key, withDocumentId(stored, id));
			// on load this runs before workspace.js, which has no tabs yet
			if ( withTabs ) { tabs.filter(t => t.savedName === name).forEach(t => { t.docId = id }) }
		}
		seen.add(id);
	}
}

function documentHtmlToStore(tab=getActiveTab(), name=getDocumentName(), html=getDocumentText()){
	// a document as it is saved (the focused one by default): its id, then the editor's content
	let id;
	if ( !tab ) {
		id = documentIdOf(name);
	} else if ( name !== tab.savedName && documentExists(name) ) {
		// saved over another document: links to that one keep working
		id = documentIdOf(name);
	} else if ( name !== tab.savedName && tab.savedName && tabs.some(t => t !== tab && t.name === tab.savedName) ) {
		// saved under a new name while another tab keeps the old document: a copy, with its own id
		id = null;
	} else {
		id = tab.docId || documentIdOf(tab.savedName || name);
	}
	id ||= newDocumentId();
	if ( tab ) { tab.docId = id }
	if ( !documentFoldsSaved() ) { html = withoutFolds(html) } // folding.js
	return withDocumentId(html, id, tab?.meta ?? (documentExists(name) ? splitDocumentId(notebookStorage.getItem(docPrefix + name)).meta : {}));
}

function fillDocumentLinkOptions(datalist){
	// the documents to pick from in the Insert Link modal, their folders beside the names
	const names = (getDocumentNamesFromLocalStorage() || []).sort((a, b) => a.localeCompare(b));
	for ( const name of names ) {
		const option = document.createElement("option");
		option.value = name;
		const folder = folderOfDocument(name);
		if ( folder ) { option.label = folderSeparator + folder + folderSeparator }
		datalist.appendChild(option);
	}
}

function insertDocumentLink(name, text){
	if ( !documentExists(name) ) {
		informError(`Document with name "${name}" has not been found!`, "", "warning");
		return false;
	}
	ensureDocumentIds();
	const id = documentIdOf(name);
	injectHtml(`<a contenteditable="false" href="?${docLinkParam}=${id}" data-doc-id="${id}">${escapeHtmlText(text || name)}</a>`);
	const tab = getActiveTab();
	if ( tab && !tab.dirty ) {
		tab.dirty = true;
		renderTabs();
	}
	performAutoSave();
	return true;
}

function withoutDocumentLinks(html){
	// an exported document is read outside of the app, where its links to other documents lead nowhere: their text stays
	const template = document.createElement("template");
	template.innerHTML = html;
	template.content.querySelectorAll("a[data-doc-id]").forEach((link) => link.replaceWith(...link.childNodes));
	return template.innerHTML;
}

function openDocumentById(id){
	const name = documentNameById(id);
	if ( name === null ) {
		informError("The linked document has not been found, it may have been deleted", "", "warning");
		return false;
	}
	// the document window shows only its document: another one opens in a window of its own (docwindow.js)
	return isDocWindow ? openDocumentWindow(name) : loadDocumentFromLocalStorage(name);
}

function handleDocumentLinkClick(e){
	// a plain click opens the linked document in the app; ctrl/shift/middle click is left to the browser
	const link = e.target.closest?.("a[data-doc-id]");
	if ( !link || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey ) { return }
	e.preventDefault();
	openDocumentById(link.dataset.docId);
}

function openDocumentFromQuery(){
	// ?doc={uuid}: a document link opened in a new browser tab
	const id = new URLSearchParams(window.location.search).get(docLinkParam);
	if ( !id ) { return }
	removeParams(docLinkParam);
	if ( validateUserConsent(false) ) { openDocumentById(id) }
}
