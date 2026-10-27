/*
 * Script secrets: values the scripts (scripting.js) read with secret("NAME") (scriptapi.js), so API keys and the like
 * aren't written in the documents. They belong to the account, not to a notebook: Settings > Script secrets lists them.
 *
 * A secret is local, kept only in this browser, or synced (logged in only): kept in the cloud (routers/secrets.py, table
 * user_script_secrets) and on every device of the account. A local secret can be made synced, a synced one can't be made
 * local again. The value can be changed and the secret deleted; for a synced one both go to the cloud first.
 * This browser keeps both kinds under scriptSecretsKey, {NAME: {value, synced}}, never synced with the notebook nor in a
 * backup (isDeviceOnlyKey); the synced ones are fetched again with every cloud sync (cloudsync.js) and when the list is
 * opened, the cloud's win. Logged out, the synced ones that were kept can't be changed until logging in again.
 */
const scriptSecretsKey = "__scriptSecrets__"; // {NAME: {value, synced}}, this device only
const scriptSecretNamePattern = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/; // like SECRET_NAME_PATTERN in routers/secrets.py
const scriptSecretMaxLength = 64 * 1024;

let scriptSecretsWrites = 0; // a fetch of the synced secrets that started before a write leaves them as the write made them


// where they are kept
function scriptSecretsRemote(){
	return typeof apiRequest !== "undefined"; // cloudsync.js, logged in only
}

function readScriptSecrets(){
	// the localStorage of the app, also with a folder opened as the notebook (localnotebooks.js): the secrets are the account's
	try {
		const store = JSON.parse(localStorage.getItem(scriptSecretsKey));
		return store && typeof store === "object" && !Array.isArray(store) ? store : {};
	} catch ( err ) {
		return {};
	}
}

function writeScriptSecrets(store){
	localStorage.setItem(scriptSecretsKey, JSON.stringify(store));
}

function scriptSecretRequest(name, options){
	return apiRequest(`/api/secrets/${encodeURIComponent(name)}`, options);
}

async function syncScriptSecrets(){
	// the cloud's synced secrets replace this browser's; the local ones stay, unless the account has one with that name
	if ( !scriptSecretsRemote() || !validateUserConsent(false) ) { return false }
	const writes = scriptSecretsWrites;
	try {
		const { secrets } = await apiRequest("/api/secrets");
		if ( writes !== scriptSecretsWrites ) { return syncScriptSecrets() }
		const store = Object.fromEntries(Object.entries(readScriptSecrets()).filter(([, secret]) => !secret.synced));
		for ( const { name, value } of secrets ) { store[name] = { value, synced: true } }
		writeScriptSecrets(store);
		renderScriptSecretsModal();
		return true;
	} catch ( err ) {
		console.error("Could not fetch the synced script secrets", err);
		return false;
	}
}

function scriptSecret(name, defaultValue=null){
	// secret() of the scripts (scriptapi.js)
	if ( typeof name !== "string" ) { throw new TypeError(`secret: the name has to be a string, not ${name === null ? "null" : typeof name}`) }
	const secret = readScriptSecrets()[name];
	if ( secret && typeof secret.value === "string" ) { return secret.value }
	if ( defaultValue === null ) { throw new Error(`secret: no secret "${name}", add it in Settings > Script secrets`) }
	return defaultValue;
}

function scriptSecretProblem(name, value){
	// what is wrong with a secret to add, null when nothing is
	if ( !scriptSecretNamePattern.test(name) ) { return "A name has letters, digits and _, starts with a letter or _, and is up to 64 characters long" }
	if ( value.length > scriptSecretMaxLength ) { return `A value is up to ${scriptSecretMaxLength} characters long` }
	return null;
}

async function saveScriptSecret(name, value, synced){
	// adds a secret or changes its value; synced makes it synced (it can't be made local again)
	const store = readScriptSecrets();
	synced = synced || Boolean(store[name]?.synced);
	if ( synced ) {
		if ( !scriptSecretsRemote() ) { throw new Error("Log in to change a synced secret") }
		scriptSecretsWrites++;
		await scriptSecretRequest(name, { method: "PUT", body: { value } });
	}
	const current = readScriptSecrets(); // it may have changed during the request
	current[name] = { value, synced };
	writeScriptSecrets(current);
}

async function deleteScriptSecret(name){
	const secret = readScriptSecrets()[name];
	if ( secret?.synced ) {
		if ( !scriptSecretsRemote() ) { throw new Error("Log in to delete a synced secret") }
		scriptSecretsWrites++;
		try {
			await scriptSecretRequest(name, { method: "DELETE" });
		} catch ( err ) {
			if ( !(err instanceof CloudHttpError && err.status === 404) ) { throw err } // deleted on another device already
		}
	}
	const current = readScriptSecrets();
	delete current[name];
	writeScriptSecrets(current);
}


// Settings > Script secrets
function scriptSecretsSettingsHtml(){
	return `<div class="row"><button class="btn" id="script-secrets-btn" type="button">Script secrets</button></div>
	<p class="muted small">Values scripts read with <code>secret("NAME")</code>, like API keys, so they aren't written in the documents.</p>`;
}

function initScriptSecretsSettings(){
	document.getElementById("script-secrets-btn")?.addEventListener("click", openScriptSecretsModal);
}

function openScriptSecretsModal(){
	if ( !validateUserConsent() ) { return }
	closeAllModals();
	const remote = scriptSecretsRemote();
	const modal = createModal("Script secrets", `
	<p class="muted small">Scripts read a secret with <code>secret("NAME")</code>. A local secret stays in this browser;
	a synced one is kept with your account, on every device you are logged in on. A local secret can be made synced, not
	the other way round.</p>
	<ul class="script-secrets-list" aria-label="Script secrets"></ul>
	<h3>Add a secret</h3>
	<form class="script-secret-add stack" autocomplete="off">
		<div class="script-secret-fields">
			<input type="text" class="script-secret-new-name" placeholder="NAME" aria-label="Name" spellcheck="false" autocapitalize="off" maxlength="64">
			<input type="password" class="script-secret-new-value" placeholder="Value" aria-label="Value" autocomplete="new-password">
		</div>
		<label class="check"><input type="checkbox" class="script-secret-new-synced"${remote ? "" : " disabled"}>Synced${remote ? "" : ` <span class="muted small">(log in to sync secrets)</span>`}</label>
		<div class="row"><button type="submit" class="btn primary">Add</button></div>
	</form>
	<div class="script-secrets-problem small" role="alert" hidden></div>`);
	modal.classList.add("script-secrets-modal");
	modal.querySelector(".script-secret-add").addEventListener("submit", async (e) => {
		e.preventDefault();
		const name = modal.querySelector(".script-secret-new-name").value.trim();
		const value = modal.querySelector(".script-secret-new-value").value;
		const synced = modal.querySelector(".script-secret-new-synced").checked;
		const problem = scriptSecretProblem(name, value) || (name in readScriptSecrets() ? `There is a secret "${name}" already, change its value in the list` : null);
		if ( problem ) { showScriptSecretsProblem(problem); return }
		if ( await runScriptSecretChange(() => saveScriptSecret(name, value, synced)) ) {
			e.target.reset();
			modal.querySelector(".script-secret-new-name").focus();
		}
	});
	renderScriptSecretsModal();
	if ( remote ) { syncScriptSecrets() }
}

function showScriptSecretsProblem(text){
	const problem = document.querySelector(".script-secrets-modal .script-secrets-problem");
	if ( !problem ) { return }
	problem.textContent = text || "";
	problem.hidden = !text;
}

async function runScriptSecretChange(change){
	// the list shows what was stored, or what went wrong; returns whether it went
	showScriptSecretsProblem(null);
	try {
		await change();
		renderScriptSecretsModal();
		return true;
	} catch ( err ) {
		console.error("Could not change the script secret", err);
		showScriptSecretsProblem(typeof CloudHttpError !== "undefined" && err instanceof CloudHttpError ? `Could not save it in the cloud: ${err.body?.detail ?? `HTTP ${err.status}`}` : err.message);
		return false;
	}
}

function renderScriptSecretsModal(){
	const modal = document.querySelector(".script-secrets-modal");
	if ( !modal ) { return }
	const list = modal.querySelector(".script-secrets-list");
	const store = readScriptSecrets();
	const names = Object.keys(store).sort((a, b) => a.localeCompare(b));
	if ( !names.length ) {
		list.replaceChildren(Object.assign(document.createElement("li"), { className: "muted small", textContent: "No secrets yet." }));
		return;
	}
	// an unsaved value typed in the list stays
	const typed = new Map([...list.querySelectorAll(".script-secret")].map((row) => [row.dataset.name, row.querySelector(".script-secret-value").value]));
	list.replaceChildren(...names.map((name) => scriptSecretRow(name, store[name], typed.get(name))));
}

function scriptSecretRow(name, secret, typed){
	const remote = scriptSecretsRemote();
	const locked = secret.synced && !remote; // logged out: kept, but not changed until logging in
	const row = document.createElement("li");
	row.className = "script-secret";
	row.dataset.name = name;
	row.innerHTML = `
		<code class="script-secret-name"></code>
		<input type="password" class="script-secret-value" aria-label="Value" autocomplete="off">
		<button type="button" class="btn small script-secret-show">Show</button>
		<label class="check small" title="${secret.synced ? "Synced secrets can't be made local again" : remote ? "Keep it with your account, on every device" : "Log in to sync secrets"}"><input type="checkbox" class="script-secret-synced">Synced</label>
		<button type="button" class="btn small script-secret-save">Save</button>
		<button type="button" class="btn small danger script-secret-delete">Delete</button>`;
	row.querySelector(".script-secret-name").textContent = name;
	const value = row.querySelector(".script-secret-value");
	value.value = typed ?? secret.value;
	value.disabled = locked;
	const synced = row.querySelector(".script-secret-synced");
	synced.checked = Boolean(secret.synced);
	synced.disabled = Boolean(secret.synced) || !remote;
	row.querySelector(".script-secret-save").disabled = locked;
	row.querySelector(".script-secret-delete").disabled = locked;
	if ( locked ) { row.title = "Log in to change or delete a synced secret" }

	row.querySelector(".script-secret-show").addEventListener("click", (e) => {
		const hidden = value.type === "password";
		value.type = hidden ? "text" : "password";
		e.target.textContent = hidden ? "Hide" : "Show";
	});
	const save = () => {
		const problem = scriptSecretProblem(name, value.value);
		if ( problem ) { showScriptSecretsProblem(problem); return }
		runScriptSecretChange(() => saveScriptSecret(name, value.value, false));
	};
	row.querySelector(".script-secret-save").addEventListener("click", save);
	value.addEventListener("keydown", (e) => { if ( e.key === "Enter" ) { e.preventDefault(); save() } });
	synced.addEventListener("change", () => {
		if ( !showConfirm(`Sync "${name}" with your account? A synced secret can't be made local again.`) ) { synced.checked = false; return }
		runScriptSecretChange(() => saveScriptSecret(name, readScriptSecrets()[name]?.value ?? value.value, true)).then((ok) => { if ( !ok ) { synced.checked = false } });
	});
	row.querySelector(".script-secret-delete").addEventListener("click", () => {
		if ( !showConfirm(`Delete the secret "${name}"${secret.synced ? " from every device" : ""}?`) ) { return }
		runScriptSecretChange(() => deleteScriptSecret(name));
	});
	return row;
}
