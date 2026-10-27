/*
 * Cloud sync (logged in users): the notebook goes to the cloud document by document.
 * Every user has a "Default" notebook (routers/notebooks.py), nothing about notebooks is shown yet.
 * A document is known by its id (doclinks.js), its name and its content (pako-compressed, like the
 * notebook before) are sent together; the folders and the settings go as the notebook's meta.
 * The cloud keeps a version of each; this device remembers, under cloudSyncKey, the version and the
 * hash of what it last synced, so a sync tells which side changed a document:
 * - only this device: pushed, only the cloud: pulled, both: shown in the conflict resolver (script.js)
 * - deleted here and unchanged in the cloud: deleted in the cloud, and the other way round
 * Auto-sync runs 5 seconds after the last save, but not sooner than a minute after the last sync;
 * a manual sync (Save, Settings > Cloud sync > Resync) runs right away.
 */
const cloudFetchChunk = 200; // documents fetched in one request, see MAX_FETCH in routers/notebooks.py

let cloudNotebookId = null;
let cloudSyncRunning = null; // the running sync, a sync asked for meanwhile runs after it
let cloudSyncQueued = false;
let lastCloudSyncAt = 0;
let cloudSyncTimer;
let cloudManifest = new Map(); // id: {doc_id, name, version, deleted} the cloud listed at the last sync
const cloudDocStatus = {}; // id: "progress" | "error", for Settings > Cloud sync
const cloudSyncFilter = new Set(); // the statuses Settings > Cloud sync lists, all when empty

class CloudHttpError extends Error {
	constructor(status, body){
		super(`cloud sync: HTTP ${status}`);
		this.status = status;
		this.body = body;
	}
}

// requests
function cloudRequest(path, options={}){
	return apiRequest(`/api/notebooks${path}`, options);
}

async function apiRequest(url, options={}, retried=false){
	// a request to the Write.js server as the logged in user: JSON in and out, throws CloudHttpError when it isn't ok
	if ( tokenRefresh ) { await tokenRefresh.catch(() => {}) }
	const refreshes = tokenRefreshes;
	const resp = await fetch(url, {
		credentials: "include",
		...options,
		headers: options.body ? {"Content-Type": "application/json"} : undefined,
		body: options.body ? JSON.stringify(options.body) : undefined,
	});
	if ( resp.status === 401 && !retried && ( tokenRefresh || tokenRefreshes !== refreshes ) ) {
		// sent with the access token a refresh (script3.js) just replaced: again with the new one
		await tokenRefresh?.catch(() => {});
		return apiRequest(url, options, true);
	}
	if ( resp.status === 401 ) {
		// an expired session: handleSessionExpired (script2.js) lets the user keep the documents
		window.location = "?logout=3";
		throw new CloudHttpError(401, null);
	}
	const body = await resp.json().catch(() => null);
	if ( !resp.ok ) { throw new CloudHttpError(resp.status, body) }
	return body;
}

async function cloudDefaultNotebookId(){
	if ( cloudNotebookId === null ) {
		const { notebooks } = await cloudRequest("");
		cloudNotebookId = notebooks[0].notebook_id;
	}
	return cloudNotebookId;
}

async function cloudFetchDocuments(ids){
	const documents = new Map();
	for ( let i = 0; i < ids.length; i += cloudFetchChunk ) {
		const resp = await cloudRequest(`/${cloudNotebookId}/documents/fetch`, { method: "POST", body: { doc_ids: ids.slice(i, i + cloudFetchChunk) } });
		for ( const doc of resp.documents ) { documents.set(doc.doc_id, doc) }
	}
	return documents;
}

// what this device remembers about the last sync
function readCloudState(){
	const state = readJsonSetting(cloudSyncKey);
	return {
		notebookId: state.notebookId ?? null,
		meta: state.meta ?? null,
		docs: state.docs && typeof state.docs === "object" ? state.docs : {},
		lastSync: state.lastSync ?? null,
	};
}

function writeCloudState(state){
	localStorage.setItem(cloudSyncKey, JSON.stringify(state));
}

function documentSyncHash(name, html){
	// a rename is a change to push as well
	return hashText(`${name}\n${html}`);
}

function localDocumentsById(){
	const docs = new Map();
	for ( const name of getDocumentNamesFromLocalStorage() || [] ) {
		const html = localStorage.getItem(docPrefix + name);
		const id = splitDocumentId(html).id;
		if ( id ) { docs.set(id, { id, name, html, hash: documentSyncHash(name, html) }) }
	}
	return docs;
}

function collectMeta(){
	// everything that goes with the notebook besides the documents, in a stable order to hash it
	const items = getAllLocalStorageItems();
	const meta = {};
	for ( const key of Object.keys(items).sort() ) {
		if ( key.startsWith(docPrefix) || key === lastOpenedKey || key === userConsentKey ) { continue }
		meta[key] = items[key];
	}
	return JSON.stringify(meta);
}

// scheduling
function handleRemoteAutosave(){
	// something to sync was saved: auto-sync 5 s after the last save, at most once a minute
	if ( !remoteAutoSaveEnabled ) { return }
	clearTimeout(cloudSyncTimer);
	const wait = Math.max(remoteAutoSaveValue, lastCloudSyncAt + remoteForceAutoSaveValue - Date.now());
	cloudSyncTimer = setTimeout(() => syncCloud(), wait);
	renderCloudSyncModal();
}

function syncCloud(options={}){
	// options: manual (tells how it went), onStart (opens the last opened document)
	if ( cloudSyncRunning ) {
		cloudSyncQueued ||= !!options.manual || "auto";
		return cloudSyncRunning;
	}
	clearTimeout(cloudSyncTimer);
	cloudSyncRunning = runCloudSync(options).finally(() => {
		cloudSyncRunning = null;
		lastCloudSyncAt = Date.now();
		renderCloudSyncModal();
		if ( cloudSyncQueued ) {
			const manual = cloudSyncQueued === true;
			cloudSyncQueued = false;
			manual ? syncCloud({ manual }) : handleRemoteAutosave();
		}
	});
	return cloudSyncRunning;
}

function markSyncPending(){
	if ( !localStorage.getItem(syncPendingKey) ) {
		createNotification("Offline - saved in this browser, will sync to the cloud when you are back online", "info", notificationTimeoutLong);
	}
	localStorage.setItem(syncPendingKey, "1");
}

// the sync
async function runCloudSync({ manual=false, onStart=false }={}){
	if ( !validateUserConsent(false) ) { return }
	if ( !navigator.onLine ) { markSyncPending(); return }
	try {
		const notebookId = await cloudDefaultNotebookId();
		let manifest = await cloudRequest(`/${notebookId}/documents`);
		if ( manifest.legacy ) {
			await moveLegacyNotebook();
			manifest = await cloudRequest(`/${notebookId}/documents`);
		}
		ensureDocumentIds();
		let state = readCloudState();
		if ( state.notebookId !== notebookId ) { state = { notebookId, meta: null, docs: {}, lastSync: null } }
		cloudManifest = new Map(manifest.documents.map(d => [d.doc_id, d]));
		const welcome = onStart && !manifest.documents.length && !manifest.meta_version && !getDocumentNamesFromLocalStorage().length;

		const conflicts = [];
		const failed = await syncDocuments(state, conflicts);
		await syncMeta(state, manifest.meta_version);
		state.lastSync = Date.now();
		writeCloudState(state);

		afterCloudPull();
		syncScriptSecrets(); // secrets.js: the account's synced secrets, apart from the notebook
		if ( onStart ) { loadLastOpenedDocument() }
		if ( !failed ) { localStorage.removeItem(syncPendingKey) }
		if ( welcome ) { createNewNotebookModal() }
		if ( failed ) {
			createNotification(`Sync error! ${failed} document${failed === 1 ? "" : "s"} could not be synced, see Settings > Cloud sync`, "error", notificationTimeoutLong);
		} else if ( manual ) {
			createNotification("Notebook synced with the cloud", "info", notificationTimeoutShort);
		}
		// a resolver already shown is answered first, the rest are asked again on the next sync
		if ( conflicts.length && !document.querySelector(".sync-compare-modal") ) {
			resolveSyncConflicts(conflicts, "Cloud", true, resolveCloudConflict);
		}
	} catch ( err ) {
		if ( err instanceof CloudHttpError && err.status === 401 ) { return }
		// fetch rejects with TypeError when the network is gone
		if ( err instanceof TypeError ) { markSyncPending() }
		if ( !navigator.onLine ) { return }
		informError("Sync error! Cannot sync the notebook with the cloud!", err);
	}
}

async function syncDocuments(state, conflicts){
	// returns how many documents failed
	const local = localDocumentsById();
	const legacyBase = readSyncBase(); // hashes from when the notebook was synced as a whole
	const ids = new Set([...cloudManifest.keys(), ...local.keys(), ...Object.keys(state.docs)]);
	const push = [], pull = [], remove = [], compare = [];

	for ( const id of ids ) {
		const remote = cloudManifest.get(id), doc = local.get(id), base = state.docs[id];
		const unsaved = doc ? unsavedDocumentHtml(doc.name) : null;
		const changedHere = !!doc && ( unsaved !== null || ( base
			? base.hash !== doc.hash
			: legacyBase[docPrefix + doc.name] !== hashText(doc.html) ) );
		const changedThere = !!remote && remote.version !== base?.version;

		if ( !remote ) {
			if ( doc ) { push.push([doc, 0]) } else { delete state.docs[id] }
		} else if ( remote.deleted ) {
			if ( doc && ( changedHere || !base ) ) { push.push([doc, remote.version]) } // edited here: it comes back
			else if ( doc ) { remove.push([doc, remote]) } // deleted on another device
			else { delete state.docs[id] }
		} else if ( !doc ) {
			if ( base && !changedThere ) { push.push([{ id, deleted: true }, base.version]) } // deleted here
			else { pull.push(id) } // new in the cloud, or changed there after it was deleted here
		} else if ( !changedThere && base ) {
			if ( changedHere && unsaved === null ) { push.push([doc, remote.version]) }
		} else if ( !changedHere ) {
			pull.push(id); // changed only in the cloud, or unchanged here since the notebook was synced as a whole
		} else {
			compare.push(id); // changed on both sides, or never synced from this device
		}
	}

	const fetched = await cloudFetchDocuments([...pull, ...compare]);
	let failed = 0;
	for ( const id of pull ) {
		const remote = fetched.get(id);
		if ( remote ) { applyPulledDocument(state, remote, local.get(id)) }
	}
	for ( const id of compare ) {
		const remote = fetched.get(id), doc = local.get(id);
		if ( !remote ) { continue }
		const html = decompressObject(remote.content);
		const mine = unsavedDocumentHtml(doc.name) ?? doc.html;
		if ( splitDocumentId(mine).html === splitDocumentId(html).html ) {
			// the same content, at most the name differs: this device's goes
			state.docs[id] = { version: remote.version, hash: documentSyncHash(remote.name, html) };
			if ( doc.name !== remote.name ) { push.push([doc, remote.version]) }
			continue
		}
		conflicts.push({ key: docPrefix + doc.name, name: doc.name, local: mine, remote: html, id, version: remote.version, remoteName: remote.name });
	}
	for ( const [doc, remote] of remove ) {
		localStorage.removeItem(docPrefix + doc.name);
		closeTabsOfDocument(doc.name);
		forgetDocumentFolder(doc.name);
		delete state.docs[doc.id];
		cloudManifest.set(doc.id, remote);
	}
	for ( const [doc, baseVersion] of push ) {
		if ( !await pushDocument(state, doc, baseVersion, conflicts) ) { failed++ }
	}
	return failed;
}

async function pushDocument(state, doc, baseVersion, conflicts){
	// returns false when it failed
	const id = doc.id;
	cloudDocStatus[id] = "progress";
	renderCloudSyncModal();
	try {
		const resp = doc.deleted
			? await cloudRequest(`/${cloudNotebookId}/documents/${id}?base_version=${baseVersion}`, { method: "DELETE" })
			: await cloudRequest(`/${cloudNotebookId}/documents/${id}`, { method: "PUT", body: { name: doc.name, content: compressObject(doc.html), base_version: baseVersion } });
		if ( doc.deleted ) {
			delete state.docs[id];
			cloudManifest.set(id, { ...cloudManifest.get(id), version: resp.version, deleted: true });
		} else {
			state.docs[id] = { version: resp.version, hash: doc.hash };
			cloudManifest.set(id, { doc_id: id, name: doc.name, version: resp.version, deleted: false });
		}
		delete cloudDocStatus[id];
		return true;
	} catch ( err ) {
		if ( err instanceof CloudHttpError && err.status === 409 ) {
			// changed in the cloud meanwhile: compared on the next sync
			delete cloudDocStatus[id];
			cloudManifest.set(id, { ...cloudManifest.get(id), version: err.body?.version, deleted: !!err.body?.deleted });
			handleRemoteAutosave();
			return true;
		}
		if ( err instanceof CloudHttpError && err.status === 404 && doc.deleted ) {
			delete state.docs[id];
			delete cloudDocStatus[id];
			return true;
		}
		if ( err instanceof CloudHttpError && err.status === 401 ) { throw err }
		console.error(err);
		cloudDocStatus[id] = "error";
		return false;
	} finally {
		renderCloudSyncModal();
	}
}

function applyPulledDocument(state, remote, doc){
	// the cloud's version of a document replaces this device's, a rename moves its tabs along
	const html = decompressObject(remote.content);
	let name = remote.name;
	const holder = documentNameById(remote.doc_id);
	if ( name !== holder && documentExists(name) ) {
		// another document has this name here: the pulled one gets another, this device keeps it
		const taken = name;
		name = `${taken} (cloud)`;
		for ( let i = 2; documentExists(name); i++ ) { name = `${taken} (cloud ${i})` }
	}
	if ( doc && doc.name !== name ) {
		localStorage.removeItem(docPrefix + doc.name);
		renameDocumentTabs(doc.name, name);
	}
	localStorage.setItem(docPrefix + name, html);
	reloadDocumentTabs(name);
	state.docs[remote.doc_id] = { version: remote.version, hash: documentSyncHash(name, html) };
}

function resolveCloudConflict(conflict, pick){
	// resolveSyncConflicts (script.js) changed this device; what the cloud holds now is remembered
	const state = readCloudState();
	const html = pick === "remote" ? conflict.remote : null;
	state.docs[conflict.id] = { version: conflict.version, hash: html === null ? null : documentSyncHash(conflict.name, html) };
	writeCloudState(state);
	if ( pick !== "remote" ) { handleRemoteAutosave() } // this device's version and the copy are pushed
	renderCloudSyncModal();
}

async function syncMeta(state, remoteVersion){
	// the folders and the settings: as for a document, but changes on both sides are merged
	let localMeta = collectMeta();
	const base = state.meta;
	const changedHere = !base || base.hash !== hashText(localMeta);
	if ( remoteVersion !== (base?.version ?? 0) ) {
		const remote = await cloudRequest(`/${cloudNotebookId}/meta`);
		const remoteMeta = remote.content ? decompressObject(remote.content) : "{}";
		applyRemoteMeta(remoteMeta, changedHere);
		localMeta = collectMeta();
		state.meta = { version: remote.version, hash: hashText(remoteMeta) };
		remoteVersion = remote.version;
	}
	if ( hashText(localMeta) === state.meta?.hash ) { return }
	try {
		const resp = await cloudRequest(`/${cloudNotebookId}/meta`, { method: "PUT", body: { content: compressObject(localMeta), base_version: remoteVersion } });
		state.meta = { version: resp.version, hash: hashText(localMeta) };
	} catch ( err ) {
		if ( !(err instanceof CloudHttpError && err.status === 409) ) { throw err }
		handleRemoteAutosave(); // changed in the cloud meanwhile: merged on the next sync
	}
}

function applyRemoteMeta(json, changedHere){
	let meta;
	try { meta = JSON.parse(json) } catch ( err ) { return }
	for ( const [key, value] of Object.entries(meta) ) {
		if ( isDeviceOnlyKey(key) || key.startsWith(docPrefix) || key === lastOpenedKey || key === userConsentKey ) { continue }
		if ( key === foldersKey ) {
			// unchanged here: the cloud's folders, deleted ones go; changed on both sides: both are kept
			changedHere ? mergeFolders(value) : localStorage.setItem(foldersKey, value);
			continue
		}
		// settings changed on both sides: the cloud's win
		localStorage.setItem(key, value);
	}
}

function afterCloudPull(){
	// what was pulled shows: the settings, the folders and the documents
	applyFoldingSettings();
	applyLineNumbersSetting();
	applySpellcheckSetting(); // script.js
	loadAutosaveSetting();
	scheduleToc();
	applyViMode();
	applyCronSetting(); // cron.js
	renderTabs();
	refreshFileTree();
}

async function moveLegacyNotebook(){
	// the notebook from before, kept as a whole: merged into this device, pushed document by document next
	const resp = await fetch("/api/notebooks/notebook", { method: "GET", credentials: "include" });
	if ( !resp.ok ) { return }
	const { json_content } = await resp.json();
	if ( json_content ) { loadNotebookFromJson(json_content, true, false, true) }
}

// Settings > Cloud sync
const cloudStatusLabels = {
	synced: "Synced",
	queued: "In sync queue",
	progress: "In progress",
	error: "Sync error",
	pending: "Out of sync",
};

function documentCloudStatus(state, id, doc){
	// queued: changed on this device, goes to the cloud with the next sync;
	// out of sync: changed in the cloud and not on this device yet, or changed on both sides (to review)
	if ( cloudDocStatus[id] ) { return cloudDocStatus[id] }
	const base = state.docs[id];
	const remote = cloudManifest.get(id);
	if ( !remote ) { return "queued" } // never pushed
	const changedHere = !base || base.hash !== doc.hash || unsavedDocumentHtml(doc.name) !== null;
	const changedThere = remote.deleted || remote.version !== base?.version;
	if ( changedThere ) { return "pending" }
	return changedHere ? "queued" : "synced";
}

function cloudSyncSettingsHtml(){
	return `<h3>Cloud sync</h3>
	<div class="stack">
		<div class="row"><button class="btn" id="cloud-sync-btn" type="button">Cloud sync</button></div>
		<p class="muted small">The state of every document in the cloud; auto-sync runs after saving, at most once a minute.</p>
	</div>`;
}

function initCloudSyncSettings(){
	document.getElementById("cloud-sync-btn")?.addEventListener("click", createCloudSyncModal);
}

function createCloudSyncModal(){
	closeAllModals();
	createModal("Cloud sync", `
	<div class="row cloud-sync-head">
		<p class="muted small cloud-sync-last"></p>
		<button class="btn primary" id="cloud-resync-btn" type="button">Resync</button>
	</div>
	<ul class="cloud-sync-legend muted small" aria-label="Show documents by status">
		${Object.entries(cloudStatusLabels).map(([status, label]) => `<li><button class="cloud-sync-filter" type="button" data-status="${status}" aria-pressed="false"><span class="sync-dot" data-status="${status}"></span><span>${label} (<span class="sync-count">0</span>)</span></button></li>`).join("")}
	</ul>
	<ul class="cloud-sync-tree" role="tree" aria-label="Documents in the cloud"></ul>`);
	document.getElementById("modal").classList.add("cloud-sync-modal");
	document.getElementById("cloud-resync-btn").addEventListener("click", () => syncCloud({ manual: true }));
	// a status in the legend filters the list, several can be picked
	document.querySelectorAll(".cloud-sync-filter").forEach((btn) => btn.addEventListener("click", () => {
		const status = btn.dataset.status;
		cloudSyncFilter.has(status) ? cloudSyncFilter.delete(status) : cloudSyncFilter.add(status);
		renderCloudSyncModal();
	}));
	renderCloudSyncModal();
	// a filtered list is shorter, the modal keeps the size it opened with
	const tree = document.querySelector(".cloud-sync-tree");
	tree.style.minHeight = `${tree.offsetHeight}px`;
}

function renderCloudSyncModal(){
	const modal = document.querySelector(".cloud-sync-modal");
	if ( !modal ) { return }
	const state = readCloudState();
	const running = !!cloudSyncRunning;
	const button = modal.querySelector("#cloud-resync-btn");
	button.disabled = running;
	button.textContent = running ? "Syncing..." : "Resync";
	modal.querySelector(".cloud-sync-last").textContent = !navigator.onLine
		? "Offline, changes sync when you are back online."
		: state.lastSync ? `Last synced ${new Date(state.lastSync).toLocaleString()}` : "Not synced yet.";

	const local = localDocumentsById();
	const byName = new Map([...local.values()].map(d => [d.name, d]));
	const store = readFolders();
	const byFolder = new Map(store.folders.map(f => [f, []]));
	const loose = [];
	for ( const name of [...byName.keys()].sort((a, b) => a.localeCompare(b)) ) {
		(byFolder.get(store.documents[name]) || loose).push(name);
	}
	const statuses = new Map([...local.values()].map(d => [d.name, documentCloudStatus(state, d.id, d)]));
	// what this device doesn't hold: deleted here and not in the cloud yet, or not pulled yet
	const elsewhere = [];
	for ( const [id, base] of Object.entries(state.docs) ) {
		if ( !local.has(id) && !cloudManifest.get(id)?.deleted ) { elsewhere.push([cloudManifest.get(id)?.name ?? id, "Deleted on this device", cloudDocStatus[id] || "queued"]) }
	}
	for ( const [id, remote] of cloudManifest ) {
		if ( !remote.deleted && !local.has(id) && !state.docs[id] ) { elsewhere.push([remote.name, "Not on this device yet", cloudDocStatus[id] || "pending"]) }
	}

	// the legend: how many documents have each status, the picked ones filter the list
	const counts = {};
	for ( const status of [...statuses.values(), ...elsewhere.map(e => e[2])] ) { counts[status] = (counts[status] || 0) + 1 }
	modal.querySelectorAll(".cloud-sync-filter").forEach((btn) => {
		btn.querySelector(".sync-count").textContent = counts[btn.dataset.status] || 0;
		btn.setAttribute("aria-pressed", String(cloudSyncFilter.has(btn.dataset.status)));
	});
	const filtering = cloudSyncFilter.size > 0;
	const shown = (status) => !filtering || cloudSyncFilter.has(status);

	const list = modal.querySelector(".cloud-sync-tree");
	list.replaceChildren();
	const appendDocument = (into, name, depth) => {
		if ( shown(statuses.get(name)) ) { into.append(cloudSyncItem("tree-document", name, depth, statuses.get(name))) }
	};
	const appendFolder = (into, li, group) => {
		// a filtered list leaves out the folders without a matching document
		if ( filtering && !group.children.length ) { return }
		li.append(group);
		into.append(li);
	};
	const folderLevel = (parent, depth, into) => {
		for ( const folder of store.folders.filter(f => parentFolder(f) === parent).sort((a, b) => folderLabel(a).localeCompare(folderLabel(b))) ) {
			const li = cloudSyncItem("tree-folder", folderLabel(folder), depth, null);
			li.setAttribute("aria-expanded", "true");
			const group = document.createElement("ul");
			group.setAttribute("role", "group");
			folderLevel(folder, depth + 1, group);
			byFolder.get(folder).forEach(name => appendDocument(group, name, depth + 1));
			appendFolder(into, li, group);
		}
	};
	folderLevel("", 0, list);
	loose.forEach(name => appendDocument(list, name, 0));

	if ( elsewhere.length ) {
		const li = cloudSyncItem("tree-folder", "Not on this device", 0, null);
		const group = document.createElement("ul");
		group.setAttribute("role", "group");
		for ( const [name, note, status] of elsewhere.sort((a, b) => a[0].localeCompare(b[0])) ) {
			if ( !shown(status) ) { continue }
			const item = cloudSyncItem("tree-document", name, 1, status);
			item.querySelector(".sync-status").textContent = note;
			group.append(item);
		}
		appendFolder(list, li, group);
	}
	if ( !list.children.length ) {
		const li = document.createElement("li");
		li.className = "muted small";
		li.textContent = filtering ? "No documents with the picked status." : "No documents yet.";
		list.append(li);
	}
}

function cloudSyncItem(className, label, depth, status){
	const li = document.createElement("li");
	li.setAttribute("role", "treeitem");
	const row = document.createElement("div");
	row.className = `tree-row ${className}`;
	row.style.setProperty("--depth", depth);
	if ( status ) {
		const dot = document.createElement("span");
		dot.className = "sync-dot";
		dot.dataset.status = status;
		row.append(dot);
	}
	const name = document.createElement("span");
	name.className = "tree-label";
	name.textContent = label;
	row.append(name);
	if ( status ) {
		row.dataset.status = status;
		row.title = `${label}: ${cloudStatusLabels[status]}`;
		const text = document.createElement("span");
		text.className = "sync-status muted small";
		text.textContent = cloudStatusLabels[status];
		row.append(text);
	}
	li.append(row);
	return li;
}

// a document window (docwindow.js) leaves the sync on start to the app, it syncs what it saves
if ( !isDocWindow ) { setTimeout(() => { syncCloud({ onStart: true }) }, 1) }
window.addEventListener("online", renderCloudSyncModal);
window.addEventListener("offline", renderCloudSyncModal);
