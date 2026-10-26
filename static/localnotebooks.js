/*
 * The desktop app (tauri_app/): the page comes from the app's local server, rendered with a token for the app's own
 * API, /__writejs_app__ (tauri_app/src-tauri/src/server.rs). This file is loaded only there, before script.js.
 *
 * Notebooks (menu > Notebooks): besides the app's notebook (localStorage, synced with the cloud when logged in), a
 * folder of the computer can be opened as the notebook. Its sub-folders are the notebook's folders and its .html, .md
 * and .txt files the documents: an .html file holds the document as the editor stores it (every feature), Markdown and
 * text files are converted when they are opened and when they are saved. Nothing of such a notebook goes to the cloud,
 * only the settings still sync (cloudsync.js).
 * Which notebook is opened is a preference of this device (localNotebookKey); opening another one reloads the page.
 *
 * While a folder is opened, notebookStorage (script.js) is a LocalNotebookStorage: the documents and the folders are
 * read from the folder on load, and every change is written back to it, one after another (a document typed into is
 * written once more after the write under way). What this device keeps for each notebook (the opened tabs, where
 * each document was left...) gets the notebook's own key in localStorage; the rest is localStorage as always.
 * A change made outside of the app, or in another window, comes as an event: the folder is read again and the tabs
 * without unsaved edits show what changed.
 */
const desktopApp = {
	token: document.querySelector('meta[name="writejs-app-token"]')?.content ?? "",
	// this window, so the events of its own writes are left out
	client: crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
};
const localNotebookKey = "__localNotebook__"; // the id of the folder opened as the notebook, none for the app's notebook; this device only
const localNotebookPrefix = "__notebook:"; // + id + ":" + key: what this device keeps for each folder (isDeviceOnlyKey)
// kept for each notebook apart: lastOpenedKey, openedTabsKey, openedEditorsKey, docPositionsKey and tocFoldsKey (those
// are defined by the files loaded after this one)
const localNotebookScopedKeys = ["__lastOpened__", "__openedTabs__", "__openedEditors__", "__docPositions__", "__tocFolds__"];
const localDocPrefix = "__doc__"; // docPrefix, script.js
const localFoldersKey = "__folders__"; // foldersKey, workspace.js
const localNotebookReloadDelay = 200;

function isLocalNotebookKey(key){
	return key === localNotebookKey || key.startsWith(localNotebookPrefix);
}

function desktopHeaders(json=true){
	return { "x-writejs-app": desktopApp.token, "x-writejs-client": desktopApp.client, ...(json ? { "Content-Type": "application/json" } : {}) };
}

async function desktopRequest(path, { method="GET", body=undefined }={}){
	const resp = await fetch(`/__writejs_app__${path}`, { method, headers: desktopHeaders(), body: body === undefined ? undefined : JSON.stringify(body) });
	const result = await resp.json().catch(() => null);
	if ( !resp.ok ) { throw new Error(result?.detail || `HTTP ${resp.status}`) }
	return result;
}

function desktopRequestSync(path){
	// the notebook is read before the page's scripts run, they read the documents right away
	const xhr = new XMLHttpRequest();
	xhr.open("GET", `/__writejs_app__${path}`, false);
	for ( const [name, value] of Object.entries(desktopHeaders(false)) ) { xhr.setRequestHeader(name, value) }
	xhr.send();
	let result = null;
	try { result = JSON.parse(xhr.responseText) } catch ( err ) {}
	if ( xhr.status !== 200 ) { throw new Error(result?.detail || `HTTP ${xhr.status}`) }
	return result;
}

// documents of a folder: {name, path, format, content, id, meta} as the folder has them, html as the editor has them
function localDocumentHtml(doc){
	doc.html ??= documentFromFile(doc);
	return doc.html;
}

function documentFromFile(doc){
	// a document without an id (any file but the app's .html ones) gets one from its place, the same on every load
	const id = doc.id || legacyDocumentId(`${window.localNotebook.id}/${doc.path}`); // doclinks.js
	let html;
	if ( doc.format === "md" && !markdownReady() ) {
		// the tabs opened on load read their documents before checklist.js and tables.js are loaded: plain Markdown
		// for now, converted again once the page is loaded (convertEarlyDocuments)
		doc.early = true;
		html = new showdown.Converter({ tasklists: true, simpleLineBreaks: true, noHeaderId: true, tables: true }).makeHtml(doc.content);
	} else if ( doc.format === "md" ) {
		html = linkDocumentsInMarkdown(markdownToHtml(doc.content)); // script.js
	} else if ( doc.format === "txt" ) {
		html = doc.content.replace(/\r?\n$/, "").split(/\r?\n/).map((line) => `<div>${line ? escapeHtmlText(line) : "<br>"}</div>`).join("");
	} else if ( docIdPattern.test(doc.content) ) {
		return doc.content; // the app's own
	} else if ( /id="content">/.test(doc.content) ) {
		html = stripImportToOnlyContent(doc.content); // exported from the app (script.js)
	} else if ( /<body[\s>]/i.test(doc.content) ) {
		html = new DOMParser().parseFromString(doc.content, "text/html").body.innerHTML; // another page
	} else {
		html = doc.content;
	}
	return withDocumentId(html, id, doc.meta && typeof doc.meta === "object" ? doc.meta : {});
}

function markdownReady(){
	// what markdownToHtml (script.js) needs from the files loaded after workspace.js
	return typeof markdownTaskItemsToChecklist !== "undefined" && typeof widenMarkdownTableSeparators !== "undefined";
}

function convertEarlyDocuments(){
	for ( const doc of window.localNotebookStorage.documents.values() ) {
		if ( !doc.early ) { continue }
		delete doc.early;
		delete doc.html;
		reloadDocumentTabs(doc.name); // workspace.js
	}
}

function linkDocumentsInMarkdown(html){
	// [text](?doc={id}): a link to a document of the notebook again, as the editor makes them (doclinks.js)
	const template = document.createElement("template");
	template.innerHTML = html;
	template.content.querySelectorAll(`a[href^="?${docLinkParam}="]`).forEach((link) => {
		link.dataset.docId = new URLSearchParams(link.getAttribute("href").slice(1)).get(docLinkParam);
		link.setAttribute("contenteditable", "false");
	});
	return template.innerHTML;
}

function documentToFile(doc){
	// {content, id, meta}: what is written to the document's file; Markdown and text can't hold the id and the
	// metadata, the app keeps them beside (.writejs/notebook.json, notebooks.rs)
	const stored = splitDocumentId(doc.html);
	if ( doc.format === "md" ) {
		return { content: getContentAsMarkdown(stored.html), id: stored.id, meta: stored.meta }; // script.js
	}
	if ( doc.format === "txt" ) {
		return { content: documentLines(stored.html).map((line) => line.textContent).join("\n") + "\n", id: stored.id, meta: stored.meta };
	}
	return { content: doc.html };
}

class LocalNotebookStorage {
	// what script.js and the rest use as localStorage while a folder is opened (notebookStorage)
	constructor(notebook, data){
		this.notebook = notebook;
		this.queue = []; // {type: "write" | "delete" | "folders" | "rename-folder", ...}, sent one after another
		this.running = null;
		this.keysCache = null;
		this.errorShown = 0;
		this.load(data);
	}

	load(data){
		// a document unchanged in the folder since this window wrote or read it keeps what it has
		const before = this.documents ?? new Map();
		this.documents = new Map(data.documents.map((doc) => {
			const known = before.get(doc.name);
			const unchanged = known && known.format === doc.format && (known.written ?? known.content) === doc.content;
			return [doc.name, unchanged ? known : doc];
		}));
		this.folders = JSON.stringify(data.folders);
		this.keysCache = null;
		return before;
	}

	scopedKey(key){
		return `${localNotebookPrefix}${this.notebook.id}:${key}`;
	}

	getItem(key){
		key = String(key);
		if ( key.startsWith(localDocPrefix) ) {
			const doc = this.documents.get(key.slice(localDocPrefix.length));
			return doc ? localDocumentHtml(doc) : null;
		}
		if ( key === localFoldersKey ) { return this.folders }
		if ( localNotebookScopedKeys.includes(key) ) { return localStorage.getItem(this.scopedKey(key)) }
		return localStorage.getItem(key);
	}

	setItem(key, value){
		key = String(key);
		value = String(value);
		this.keysCache = null;
		if ( key.startsWith(localDocPrefix) ) {
			const name = key.slice(localDocPrefix.length);
			let doc = this.documents.get(name);
			if ( doc && localDocumentHtml(doc) === value ) { return }
			if ( !doc ) {
				doc = { name, path: "", format: this.notebook.newFormat, content: "" };
				this.documents.set(name, doc);
			}
			doc.html = value;
			this.enqueue({ type: "write", name });
		} else if ( key === localFoldersKey ) {
			if ( this.folders === value ) { return }
			this.folders = value;
			this.enqueue({ type: "folders" });
		} else if ( localNotebookScopedKeys.includes(key) ) {
			localStorage.setItem(this.scopedKey(key), value);
		} else {
			localStorage.setItem(key, value);
		}
	}

	removeItem(key){
		key = String(key);
		this.keysCache = null;
		if ( key.startsWith(localDocPrefix) ) {
			const name = key.slice(localDocPrefix.length);
			if ( this.documents.delete(name) ) { this.enqueue({ type: "delete", name }) }
		} else if ( key === localFoldersKey ) {
			this.setItem(key, JSON.stringify({ folders: [], documents: {}, colors: {} }));
		} else if ( localNotebookScopedKeys.includes(key) ) {
			localStorage.removeItem(this.scopedKey(key));
		} else {
			localStorage.removeItem(key);
		}
	}

	keys(){
		// computed once for a loop over key(i), anew on the next task
		if ( this.keysCache ) { return this.keysCache }
		const keys = [];
		for ( let i = 0; i < localStorage.length; i++ ) {
			const key = localStorage.key(i);
			if ( key.startsWith(localDocPrefix) || key === localFoldersKey || localNotebookScopedKeys.includes(key) || isLocalNotebookKey(key) ) { continue }
			keys.push(key);
		}
		keys.push(...localNotebookScopedKeys.filter((key) => localStorage.getItem(this.scopedKey(key)) !== null));
		keys.push(localFoldersKey, ...[...this.documents.keys()].map((name) => localDocPrefix + name));
		this.keysCache = keys;
		queueMicrotask(() => { this.keysCache = null });
		return keys;
	}

	get length(){
		return this.keys().length;
	}

	key(i){
		return this.keys()[i] ?? null;
	}

	clear(){
		// the folder's files stay, only what is in localStorage goes
		localStorage.clear();
	}

	relocateFolder(from, to){
		// a folder renamed or moved (workspace.js): moved on the disk with everything in it, before the folders are written
		this.enqueue({ type: "rename-folder", from, to });
	}

	// writing to the folder
	enqueue(op){
		// a write that is waiting writes what the document holds by then: another one isn't needed
		const waiting = this.queue.findLast((o) => op.type === "write" ? o.name === op.name : o.type === "folders" || o.type === "rename-folder");
		if ( waiting && waiting.type === op.type && op.type !== "rename-folder" && op.type !== "delete" ) { return }
		this.queue.push(op);
		this.running ??= this.flush();
	}

	async flush(){
		while ( this.queue.length ) {
			const op = this.queue.shift();
			try {
				await this.send(op);
			} catch ( err ) {
				this.showError(op, err);
			}
		}
		this.running = null;
	}

	async send(op){
		const base = `/notebooks/${encodeURIComponent(this.notebook.id)}`;
		if ( op.type === "write" ) {
			const doc = this.documents.get(op.name);
			if ( !doc || doc.html === undefined ) { return }
			const file = documentToFile(doc);
			await desktopRequest(`${base}/documents`, { method: "PUT", body: { name: op.name, format: doc.format, ...file } });
			doc.written = file.content;
		} else if ( op.type === "delete" ) {
			await desktopRequest(`${base}/documents/delete`, { method: "POST", body: { name: op.name } });
		} else if ( op.type === "folders" ) {
			await desktopRequest(`${base}/folders`, { method: "PUT", body: JSON.parse(this.folders) });
		} else if ( op.type === "rename-folder" ) {
			await desktopRequest(`${base}/folders/rename`, { method: "POST", body: { from: op.from, to: op.to } });
		}
	}

	showError(op, err){
		console.error(err);
		// one at a time, a broken folder would fill the screen
		if ( Date.now() - this.errorShown < notificationTimeoutLong ) { return }
		this.errorShown = Date.now();
		const what = op.name ? `'${escapeHtmlText(op.name)}'` : "the folders";
		createNotification(`Could not write ${what} to the notebook's folder: ${escapeHtmlText(err.message)}`, "error", notificationTimeoutLong, true);
	}

	pending(){
		return Boolean(this.running || this.queue.length);
	}

	async idle(){
		while ( this.running ) { await this.running }
	}
}

// opening the notebook: before script.js reads it
(function openLocalNotebook(){
	const id = localStorage.getItem(localNotebookKey);
	if ( !id || !desktopApp.token ) { return }
	try {
		const data = desktopRequestSync(`/notebooks/${encodeURIComponent(id)}/data`);
		window.localNotebook = { id: data.id, name: data.name, path: data.path, newFormat: data.newFormat, skipped: data.skipped };
		window.localNotebookStorage = new LocalNotebookStorage(window.localNotebook, data);
	} catch ( err ) {
		localStorage.removeItem(localNotebookKey);
		window.addEventListener("load", () => createNotification(`The notebook's folder could not be opened, the app's notebook is opened instead: ${escapeHtmlText(err.message)}`, "error", notificationTimeoutLong, true));
	}
})();

window.addEventListener("load", () => {
	document.getElementById("notebooks-btn")?.addEventListener("click", createNotebooksModal);
	if ( window.localNotebook ) {
		convertEarlyDocuments();
		showLocalNotebook();
	}
	askForDesktopSettings();
});

window.addEventListener("beforeunload", (e) => {
	// what is still being written to the folder would be lost
	if ( window.localNotebookStorage?.pending() ) { e.preventDefault() }
});

function showLocalNotebook(){
	const { name, path, skipped } = window.localNotebook;
	const tab = document.getElementById("documents-tab");
	tab.textContent = name;
	tab.title = `${path}\nDrag to another side, or right-click for options`;
	document.body.dataset.localNotebook = name;
	if ( skipped ) {
		createNotification(`${skipped} file${skipped === 1 ? " was" : "s were"} left out of '${escapeHtmlText(name)}': bigger than 8 MB, not text, or in folders nested deeper than ${maxFolderDepth} levels`, "info", notificationTimeoutLong, true);
	}
	// changes made elsewhere: outside of the app or in another window
	const events = new EventSource(`/__writejs_app__/notebooks/${encodeURIComponent(window.localNotebook.id)}/events?token=${encodeURIComponent(desktopApp.token)}`);
	let timer = 0;
	events.addEventListener("changed", (e) => {
		let origin = null;
		try { origin = JSON.parse(e.data).origin } catch ( err ) {}
		if ( origin === desktopApp.client ) { return }
		clearTimeout(timer);
		timer = setTimeout(reloadLocalNotebook, localNotebookReloadDelay);
	});
}

async function reloadLocalNotebook(){
	const storage = window.localNotebookStorage;
	// this window's own writes first, the folder holds them then
	await storage.idle();
	let data;
	try {
		data = await desktopRequest(`/notebooks/${encodeURIComponent(window.localNotebook.id)}/data`);
	} catch ( err ) {
		console.error(err);
		return;
	}
	if ( storage.pending() ) { setTimeout(reloadLocalNotebook, localNotebookReloadDelay); return }
	const before = storage.load(data);
	for ( const [name, doc] of before ) {
		const now = storage.documents.get(name);
		if ( !now ) {
			// deleted elsewhere: its tabs close, unless they hold unsaved edits (saving them makes the file again)
			tabs.filter((t) => t.name === name && !t.dirty).forEach((t) => closeTab(t.id));
		} else if ( now !== doc ) {
			reloadDocumentTabs(name); // workspace.js
		}
	}
	refreshFileTree(true);
	renderTabs();
	scheduleToc(); // toc.js
}

// menu > Notebooks
function createNotebooksModal(){
	closeAllModals();
	createModal("Notebooks", `
	<p class="muted small">The documents are in the app's notebook, synced with the cloud when you are logged in, or in a folder of this computer opened as a notebook: its sub-folders are the folders, its <em>.html</em>, <em>.md</em> and <em>.txt</em> files the documents. A folder's documents stay on this computer, only the settings sync with the cloud.</p>
	<ul class="notebook-list" aria-label="Notebooks"><li class="muted small">Loading...</li></ul>
	<div class="row"><button class="btn primary" id="add-notebook-btn" type="button">Open a folder as a notebook...</button></div>`);
	document.getElementById("modal").classList.add("notebooks-modal");
	document.getElementById("add-notebook-btn").addEventListener("click", addLocalNotebook);
	renderNotebooksList();
}

async function renderNotebooksList(){
	const list = document.querySelector(".notebooks-modal .notebook-list");
	if ( !list ) { return }
	let notebooks;
	try {
		({ notebooks } = await desktopRequest("/notebooks"));
	} catch ( err ) {
		list.innerHTML = `<li class="danger small">Could not list the notebooks: ${escapeHtmlText(err.message)}</li>`;
		return;
	}
	const current = window.localNotebook?.id ?? null;
	const item = (id, name, details, extra="") => `
	<li class="notebook-item${id === current ? " current" : ""}" data-notebook="${escapeHtmlText(id ?? "")}">
		<div class="notebook-info"><strong>${escapeHtmlText(name)}</strong><span class="muted small notebook-path">${details}</span></div>
		<div class="row">
			${extra}
			<button class="btn small" type="button" data-action="open"${id === current ? " disabled" : ""}>${id === current ? "Opened" : "Open"}</button>
		</div>
	</li>`;
	list.innerHTML = item(null, "Write.JS notebook", "In the app, synced with the cloud when you are logged in")
		+ notebooks.map((nb) => item(nb.id, nb.name, nb.available ? escapeHtmlText(nb.path) : `${escapeHtmlText(nb.path)} <span class="danger">(not found)</span>`, `
			<label class="small">New documents as <select data-action="format" aria-label="Format of new documents">
				<option value="html"${nb.newFormat === "html" ? " selected" : ""}>Write.JS (.html)</option>
				<option value="md"${nb.newFormat === "md" ? " selected" : ""}>Markdown (.md)</option>
			</select></label>
			<button class="btn small" type="button" data-action="reveal"${nb.available ? "" : " disabled"}>Show folder</button>
			<button class="btn small" type="button" data-action="remove" title="Takes it off this list, the folder and its files stay">Remove</button>`)).join("");
	list.querySelectorAll(".notebook-item").forEach((li) => {
		const id = li.dataset.notebook || null;
		li.querySelector('[data-action="open"]').addEventListener("click", () => openNotebook(id));
		li.querySelector('[data-action="reveal"]')?.addEventListener("click", () => desktopRequest(`/notebooks/${id}/reveal`, { method: "POST" }).catch(showDesktopError));
		li.querySelector('[data-action="remove"]')?.addEventListener("click", () => removeLocalNotebook(id, li.querySelector("strong").textContent));
		li.querySelector('[data-action="format"]')?.addEventListener("change", async (e) => {
			try {
				await desktopRequest(`/notebooks/${id}`, { method: "PATCH", body: { newFormat: e.target.value } });
				if ( id === current ) { window.localNotebook.newFormat = e.target.value }
			} catch ( err ) { showDesktopError(err) }
		});
	});
}

function showDesktopError(err){
	createNotification(escapeHtmlText(err.message), "error", notificationTimeoutLong, true);
}

async function addLocalNotebook(){
	try {
		const { notebook } = await desktopRequest("/notebooks", { method: "POST", body: {} });
		if ( notebook ) { openNotebook(notebook.id) }
	} catch ( err ) {
		showDesktopError(err);
	}
}

async function removeLocalNotebook(id, name){
	const opened = id === window.localNotebook?.id;
	if ( !showConfirm(`Remove '${name}' from the notebooks?\n\nThe folder and its files stay as they are, it can be opened again.` + (opened ? "\n\nThe app's notebook is opened instead." : "")) ) { return }
	try {
		await desktopRequest(`/notebooks/${id}`, { method: "DELETE" });
	} catch ( err ) {
		showDesktopError(err);
		return;
	}
	if ( opened ) { openNotebook(null) } else { renderNotebooksList() }
}

async function openNotebook(id){
	// id null: the app's notebook. The page is loaded anew with the other notebook
	if ( (window.localNotebook?.id ?? null) === id ) { closeAllModals(); return }
	const unsaved = tabs.filter((t) => t.dirty && t.name).map((t) => `- ${t.name}`);
	if ( unsaved.length && !showConfirm(`These documents have unsaved changes, they will be lost:\n\n${unsaved.join("\n")}\n\nOpen the other notebook anyway?`) ) { return }
	tabs.forEach((t) => { t.dirty = false });
	saveOpenedTabs(); // workspace.js
	await window.localNotebookStorage?.idle();
	id ? localStorage.setItem(localNotebookKey, id) : localStorage.removeItem(localNotebookKey);
	window.location.href = "/";
}

// Settings > Desktop app: the servers the app talks to
function desktopSettingsHtml(){
	return `<h3>Desktop app</h3>
	<div class="stack">
		${desktopServerFieldsHtml()}
		<div class="row">
			<button class="btn" id="desktop-settings-save" type="button">Save and reload</button>
			<button class="btn" id="desktop-notebooks-btn" type="button">Notebooks</button>
		</div>
	</div>`;
}

function desktopServerFieldsHtml(){
	return `<label>Write.JS server<input id="desktop-server-url" type="url" placeholder="https://..." spellcheck="false" autocomplete="off"></label>
		<p class="muted small">Logging in and the cloud sync go to this server. Empty: no account, the documents stay on this computer.</p>
		<label>Themes server<input id="desktop-themes-url" type="url" placeholder="optional" spellcheck="false" autocomplete="off"></label>
		<p class="muted small">A <em>milessic-themes</em> server for more themes. Empty: the bundled Write.js theme.</p>`;
}

async function fillDesktopServerFields(){
	try {
		const settings = await desktopRequest("/settings");
		document.getElementById("desktop-server-url").value = settings.serverUrl;
		document.getElementById("desktop-themes-url").value = settings.themesUrl;
		return settings;
	} catch ( err ) {
		showDesktopError(err);
		return null;
	}
}

async function saveDesktopServerFields(){
	try {
		await desktopRequest("/settings", { method: "PUT", body: {
			serverUrl: document.getElementById("desktop-server-url").value,
			themesUrl: document.getElementById("desktop-themes-url").value,
		} });
		window.location.reload();
	} catch ( err ) {
		showDesktopError(err);
	}
}

function initDesktopSettings(){
	if ( !document.getElementById("desktop-server-url") ) { return }
	fillDesktopServerFields();
	document.getElementById("desktop-settings-save").addEventListener("click", saveDesktopServerFields);
	document.getElementById("desktop-notebooks-btn").addEventListener("click", createNotebooksModal);
}

async function askForDesktopSettings(){
	// the first start: which server, if any; after the storage consent (script.js)
	if ( isDocWindow ) { return }
	let settings;
	try { settings = await desktopRequest("/settings") } catch ( err ) { return }
	if ( settings.configured ) { return }
	while ( openPopups().length ) { await new Promise((resolve) => setTimeout(resolve, 500)) }
	createModal("Welcome to Write.JS", `
	<p>Write.JS can keep your documents in the cloud of a Write.JS server, with an account, or only on this computer. You can change this later in <em>Settings &gt; Desktop app</em>, and open folders of this computer as notebooks in <em>Menu &gt; Notebooks</em>.</p>
	<div class="stack">${desktopServerFieldsHtml()}</div>
	<div class="row">
		<button class="btn primary" id="desktop-welcome-save" type="button">Save</button>
		<button class="btn" id="desktop-welcome-local" type="button">Use without an account</button>
	</div>`);
	fillDesktopServerFields();
	document.getElementById("desktop-welcome-save").addEventListener("click", saveDesktopServerFields);
	document.getElementById("desktop-welcome-local").addEventListener("click", () => {
		document.getElementById("desktop-server-url").value = "";
		saveDesktopServerFields();
	});
}

// files the page exports (script.js saveFileOnDevice): saved where the user picks
async function saveFileWithDialog(blob, fileName, message, timeout){
	try {
		const resp = await fetch(`/__writejs_app__/save?name=${encodeURIComponent(fileName)}`, { method: "POST", headers: desktopHeaders(false), body: blob });
		const result = await resp.json().catch(() => null);
		if ( !resp.ok ) { throw new Error(result?.detail || `HTTP ${resp.status}`) }
		if ( result.path ) { createNotification(`${message}<br><span class="small">${escapeHtmlText(result.path)}</span>`, "info", timeout, true) }
	} catch ( err ) {
		showDesktopError(err);
	}
}
