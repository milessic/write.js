// links between Write.JS documents (Insert Link > Write.JS doc).
// Every stored document starts with a hidden <div style="display:none;" data-id="{uuid}"></div>. The editors
// never show it: loading a document takes the id onto its tab (workspace.js loadPane) and saving puts it back,
// so a link keeps pointing at its document after a rename or a move to another folder.
// A link is <a data-doc-id="{uuid}" href="?doc={uuid}">: a click opens the document's tab, or a new one;
// a ctrl/middle click opens the app in a new browser tab with that document.
const docIdPattern = /^<div style="display:none;" data-id="([^"]+)"><\/div>/;
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
	// {id, html}: a stored document's id (null without one) and its content
	const match = (html ?? "").match(docIdPattern);
	return match ? { id: match[1], html: html.slice(match[0].length) } : { id: null, html: html ?? "" };
}

function withDocumentId(html, id){
	return `<div style="display:none;" data-id="${id}"></div>` + splitDocumentId(html).html;
}

function documentIdOf(name){
	return splitDocumentId(localStorage.getItem(docPrefix + name)).id;
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
		const stored = localStorage.getItem(key);
		let { id } = splitDocumentId(stored);
		if ( !id || seen.has(id) ) {
			id = id ? newDocumentId() : legacyDocumentId(name);
			localStorage.setItem(key, withDocumentId(stored, id));
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
	return withDocumentId(html, id);
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

function openDocumentById(id){
	const name = documentNameById(id);
	if ( name === null ) {
		informError("The linked document has not been found, it may have been deleted", "", "warning");
		return false;
	}
	return loadDocumentFromLocalStorage(name);
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
