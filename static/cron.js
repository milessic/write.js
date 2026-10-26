/*
 * Notebook Cron: runs the documents' scripts (scripting.js) on a schedule. Settings > Notebook cron turns it on; off,
 * nothing is fetched or run and the jobs stay as they are. The menu's "Notebook Cron" opens the jobs and their log.
 *
 * A job is {cron_id, doc_id, script, cron, executor, executor_name, enabled, enabled_at, last_run, missed}: the script
 * is the display name of a script's button in the document (by its id, doclinks.js), so the document can be renamed.
 * The jobs and the log are kept apart from the notebook: logged in, in the cloud (routers/notebooks.py, tables
 * notebook_crons and notebook_cron_log), else in this browser (cronLocalKey).
 * A job runs only in its executor, the browser that was set as it ("Set this browser"), and only in one of its tabs
 * (the one holding cronLockName). It runs in the document's editor when the document is shown, else on the stored
 * document (or its tab's unsaved edits) in an editor that isn't shown, and what it changes is saved.
 *
 * The cron is "minute hour day month weekday", each field *, a number, a range (1-5), a list (1,3) or a step (*\/15,
 * 0-30/10); weekday 0 or 7 is Sunday, and with both day and weekday given, either one is enough (like cron).
 * _ means "once in the period, if not yet executed": "_ * * * *" every hour, "_ _ * * *" every day, "_ _ * * 2" on
 * Tuesdays, "_ _ _ * *" every month. A _ job runs as soon as the app is open in a matching period it hasn't run in,
 * e.g. on a Tuesday at 7 or at 11, whenever the app is opened first. The _ fields come first and weekday can't be _.
 * A job that should have run while the app was closed (or the computer asleep) is marked missed: it shows a "!" until it
 * runs again, and the executor is told once with a notification that opens the jobs.
 */
const cronEnabledKey = "__cron__"; // "1" when Notebook cron is on (Settings), goes with the notebook
const cronExecutorKey = "__cronExecutor__"; // {id, name} of this browser as an executor, this device only
const cronLastTickKey = "__cronLastTick__"; // when the scheduler last looked at the jobs, this device only
const cronLocalKey = "__crons__"; // {crons, log} when not logged in, this device only
const cronLockName = "writejs-cron"; // the tab of this browser that runs the jobs holds it
const cronTickInterval = 20 * 1000;
const cronReloadInterval = 5 * 60 * 1000; // the jobs are fetched again, other browsers may have changed them
const cronLateRun = 2 * 60 * 1000; // a job's time this long ago still runs, an older one was missed
const cronLogLength = 100; // see MAX_CRON_LOG in routers/notebooks.py
const cronMessageLength = 2000;
const cronSearchLimit = 5 * 366 * 24 * 60 * 60 * 1000; // how far the next run is looked for
const cronFields = [
	{ name: "minute", min: 0, max: 59 },
	{ name: "hour", min: 0, max: 23 },
	{ name: "day", min: 1, max: 31 },
	{ name: "month", min: 1, max: 12 },
	{ name: "weekday", min: 0, max: 7 },
];
const cronPeriods = ["minute", "hour", "day", "month", "year"]; // of a job with that many _ fields
const cronDefault = "_ _ * * *";

let cronJobs = [];
let cronLog = [];
let cronLoaded = null; // the loading of the jobs, null until they are asked for
let cronSchedulerTimer = 0;
let cronLeader = false; // this tab runs the jobs
let cronLastLoad = 0;
let cronMissedNotified = false;
const cronRunning = new Set(); // cron_id of the jobs running now
const cronDrafts = new Map(); // cron_id: the fields of a new job that isn't complete yet, shown only in the modal

document.getElementById("cron-btn")?.addEventListener("click", () => openCronModal());
document.addEventListener("visibilitychange", () => { if ( document.visibilityState === "visible" ) { cronTick(true) } });
window.addEventListener("load", applyCronSetting);


// the setting
function cronEnabled(){
	// the jobs name documents of the app's notebook: none run while a folder is opened as the notebook (localnotebooks.js)
	return validateUserConsent(false) && notebookStorage.getItem(cronEnabledKey) === "1" && !window.localNotebook;
}

function cronSettingsHtml(){
	return `<label class="check"><input id="setting-cron" type="checkbox"${cronEnabled() ? " checked" : ""}>Notebook cron</label>
	<p class="muted small">Runs the documents' scripts on a schedule, in the browser picked for each job (menu &gt; Notebook Cron). Turned off, the jobs are kept but nothing runs.</p>`;
}

function initCronSettings(){
	document.getElementById("setting-cron")?.addEventListener("change", (e) => {
		if ( !validateUserConsent() ) { e.target.checked = false; return }
		notebookStorage.setItem(cronEnabledKey, e.target.checked ? "1" : "0");
		applyCronSetting();
		if ( typeof handleRemoteAutosave !== "undefined" ) { handleRemoteAutosave() } // the setting goes to the cloud with the notebook
	});
}

function applyCronSetting(){
	// on: the menu item, the jobs and the scheduler; off: none of them. A document window leaves the jobs to the app.
	const on = cronEnabled() && !isDocWindow;
	const button = document.getElementById("cron-btn");
	if ( button ) { button.hidden = !on }
	if ( on ) {
		startCronScheduler();
		return;
	}
	clearInterval(cronSchedulerTimer);
	cronSchedulerTimer = 0;
	cronLoaded = null;
	cronMissedNotified = false;
	// turned on again, what was due meanwhile wasn't missed
	if ( validateUserConsent(false) ) { notebookStorage.removeItem(cronLastTickKey) }
	document.querySelector(".cron-modal")?.remove();
	if ( !document.querySelector(".modal-container") ) { deleteOverlay() }
}


// this browser
function cronExecutor(){
	let executor = readJsonSetting(cronExecutorKey);
	if ( !executor.id ) {
		executor = { id: newDocumentId(), name: cronBrowserName() };
		notebookStorage.setItem(cronExecutorKey, JSON.stringify(executor));
	}
	return executor;
}

function cronBrowserName(){
	const agent = navigator.userAgent;
	const browser = /Edg\//.test(agent) ? "Edge" : /Firefox\//.test(agent) ? "Firefox" : /Chrome\//.test(agent) ? "Chrome" : /Safari\//.test(agent) ? "Safari" : "Browser";
	const system = /Android/.test(agent) ? "Android" : /iPhone|iPad/.test(agent) ? "iOS" : /Mac OS/.test(agent) ? "macOS" : /Windows/.test(agent) ? "Windows" : /Linux/.test(agent) ? "Linux" : "";
	return system ? `${browser} on ${system}` : browser;
}

function isCronExecutor(job){
	return Boolean(job.executor) && job.executor === cronExecutor().id;
}


// where the jobs are kept
function cronRemote(){
	return typeof cloudRequest !== "undefined"; // cloudsync.js, logged in only
}

async function cronRequest(path, options={}){
	return cloudRequest(`/${await cloudDefaultNotebookId()}/crons${path}`, options);
}

function readCronLocal(){
	const store = readJsonSetting(cronLocalKey);
	return { crons: Array.isArray(store.crons) ? store.crons : [], log: Array.isArray(store.log) ? store.log : [] };
}

function writeCronLocal(store){
	notebookStorage.setItem(cronLocalKey, JSON.stringify(store));
}

function loadCronJobs(force=false){
	// the jobs and the log, fetched once (again with force)
	if ( cronLoaded && !force ) { return cronLoaded }
	cronLoaded = (async () => {
		const { crons, log } = cronRemote() ? await cronRequest("") : readCronLocal();
		cronJobs = crons;
		cronLog = log;
		cronLastLoad = Date.now();
		renderCronModal();
	})().catch((err) => {
		cronLoaded = null;
		throw err;
	});
	return cronLoaded;
}

async function saveCronJob(job, fields){
	// fields of the job changed: stored, and the job takes what was stored
	if ( cronRemote() ) {
		Object.assign(job, await cronRequest(`/${job.cron_id}`, { method: "PUT", body: fields }));
	} else {
		Object.assign(job, fields);
		const store = readCronLocal();
		const i = store.crons.findIndex((c) => c.cron_id === job.cron_id);
		i === -1 ? store.crons.push({ ...job }) : store.crons[i] = { ...job };
		writeCronLocal(store);
	}
	if ( !cronJobs.includes(job) ) { cronJobs.push(job) }
	return job;
}

async function deleteCronJob(job){
	if ( cronRemote() ) {
		await cronRequest(`/${job.cron_id}`, { method: "DELETE" });
	} else {
		const store = readCronLocal();
		store.crons = store.crons.filter((c) => c.cron_id !== job.cron_id);
		writeCronLocal(store);
	}
	cronJobs = cronJobs.filter((c) => c !== job);
}

async function addCronLog(job, ok, message){
	const entry = { cron_id: job.cron_id, at: Date.now(), ok, message: message.slice(0, cronMessageLength), executor_name: cronExecutor().name };
	cronLog.unshift(entry);
	cronLog.splice(cronLogLength);
	renderCronLog();
	try {
		if ( cronRemote() ) {
			await cronRequest("/log", { method: "POST", body: entry });
		} else {
			const store = readCronLocal();
			store.log.unshift(entry);
			store.log.splice(cronLogLength);
			writeCronLocal(store);
		}
	} catch ( err ) {
		console.error("Could not save the cron log", err);
	}
}


// the cron
function parseCron(text){
	// {fields: [Set], any: [bool], once: how many _ fields lead, period}; throws with what is wrong
	const parts = String(text ?? "").trim().split(/\s+/);
	if ( parts.length !== 5 ) { throw new Error("A cron has 5 fields: minute hour day month weekday") }
	const once = parts.findIndex((p) => p !== "_") === -1 ? 5 : parts.findIndex((p) => p !== "_");
	if ( parts.slice(once).includes("_") ) { throw new Error("_ fields come first: _ * * * *, _ _ * * *, _ _ _ * *") }
	if ( once > 4 ) { throw new Error("weekday can't be _") }
	if ( once > 2 && parts[4] !== "*" ) { throw new Error("With day as _ (once a month or a year), weekday is *") }
	const fields = [];
	const any = [];
	parts.forEach((part, i) => {
		const { name, min, max } = cronFields[i];
		const values = new Set();
		any.push(part === "*" || part === "_");
		for ( const item of (part === "_" ? "*" : part).split(",") ) {
			const match = item.match(/^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/);
			if ( !match ) { throw new Error(`${name}: "${item}" isn't *, a number, a range or a step`) }
			const from = match[1] === "*" ? min : Number(match[2]);
			const to = match[1] === "*" ? max : match[3] !== undefined ? Number(match[3]) : match[4] !== undefined ? max : from;
			const step = match[4] !== undefined ? Number(match[4]) : 1;
			if ( from < min || to > max || from > to ) { throw new Error(`${name}: ${item} is out of ${min}-${max}`) }
			if ( step < 1 ) { throw new Error(`${name}: the step of ${item} is 0`) }
			for ( let v = from; v <= to; v += step ) { values.add(i === 4 && v === 7 ? 0 : v) }
		}
		fields.push(values);
	});
	return { fields, any, once, period: cronPeriods[once] };
}

function cronProblem(text){
	try { parseCron(text); return null } catch ( err ) { return err.message }
}

function cronDayMatches(spec, date){
	// like cron: with both day and weekday given either one is enough, else the one given
	const day = spec.fields[2].has(date.getDate());
	const weekday = spec.fields[4].has(date.getDay());
	if ( !spec.any[2] && !spec.any[4] ) { return day || weekday }
	return day && weekday;
}

function nextCronTime(spec, after){
	// the first minute after the one of `after` (ms) that the cron matches, null when there is none soon
	const t = new Date(after);
	t.setSeconds(0, 0);
	t.setMinutes(t.getMinutes() + 1);
	const limit = after + cronSearchLimit;
	while ( t.getTime() <= limit ) {
		if ( !spec.fields[3].has(t.getMonth() + 1) ) { t.setMonth(t.getMonth() + 1, 1); t.setHours(0, 0, 0, 0); continue }
		if ( !cronDayMatches(spec, t) ) { t.setDate(t.getDate() + 1); t.setHours(0, 0, 0, 0); continue }
		if ( !spec.fields[1].has(t.getHours()) ) { t.setHours(t.getHours() + 1, 0, 0, 0); continue }
		if ( !spec.fields[0].has(t.getMinutes()) ) { t.setMinutes(t.getMinutes() + 1, 0, 0); continue }
		return t.getTime();
	}
	return null;
}

function cronPeriodStart(time, period){
	const t = new Date(time);
	t.setSeconds(0, 0);
	if ( period !== "hour" ) { t.setHours(0) }
	t.setMinutes(0);
	if ( period === "month" || period === "year" ) { t.setDate(1) }
	if ( period === "year" ) { t.setMonth(0) }
	return t.getTime();
}

function nextCronPeriod(start, period){
	const t = new Date(start);
	if ( period === "hour" ) { t.setHours(t.getHours() + 1) }
	if ( period === "day" ) { t.setDate(t.getDate() + 1) }
	if ( period === "month" ) { t.setMonth(t.getMonth() + 1) }
	if ( period === "year" ) { t.setFullYear(t.getFullYear() + 1) }
	return cronPeriodStart(t.getTime(), period);
}

function cronPeriodMatches(spec, start){
	// the fields that aren't _ match the period that starts at start
	const t = new Date(start);
	if ( spec.once < 2 && !spec.fields[1].has(t.getHours()) ) { return false }
	if ( spec.once < 3 && !cronDayMatches(spec, t) ) { return false }
	return spec.once > 3 || spec.fields[3].has(t.getMonth() + 1);
}

function ranInPeriod(job, start, period){
	return job.last_run != null && job.last_run >= start && job.last_run < nextCronPeriod(start, period);
}

function nextJobRun(job, now=Date.now()){
	// when the job runs next: a time, now for a _ job that is due, null for none
	let spec;
	try { spec = parseCron(job.cron) } catch ( err ) { return null }
	if ( !spec.once ) { return nextCronTime(spec, Math.max(now, job.enabled_at || 0)) }
	let start = cronPeriodStart(now, spec.period);
	if ( cronPeriodMatches(spec, start) && !ranInPeriod(job, start, spec.period) ) { return now }
	for ( const limit = now + cronSearchLimit; start <= limit; ) {
		start = nextCronPeriod(start, spec.period);
		if ( cronPeriodMatches(spec, start) ) { return start }
	}
	return null;
}

function jobDue(job, from, now){
	// {run, missed}: whether the job runs now, and whether it should have run between from and now and didn't
	const spec = parseCron(job.cron);
	from = Math.max(from, job.enabled_at || 0);
	if ( !spec.once ) {
		// the minute of from was looked at by the tick at from
		const first = nextCronTime(spec, from);
		if ( first === null || first > now ) { return { run: false, missed: false } }
		const recent = nextCronTime(spec, Math.max(from, now - cronLateRun));
		return { run: recent !== null && recent <= now, missed: first < now - cronLateRun };
	}
	const current = cronPeriodStart(now, spec.period);
	const run = cronPeriodMatches(spec, current) && !ranInPeriod(job, current, spec.period);
	// the periods before this one, since from: a matching one it didn't run in was missed
	let missed = false;
	let start = cronPeriodStart(from, spec.period);
	for ( let i = 0; start < current && i < 5000 && !missed; i++, start = nextCronPeriod(start, spec.period) ) {
		missed = cronPeriodMatches(spec, start) && !ranInPeriod(job, start, spec.period);
	}
	return { run, missed };
}


// the scheduler: in one tab of the executor
function startCronScheduler(){
	if ( isDocWindow ) { return }
	loadCronJobs().catch((err) => informError("Could not load the cron jobs!", err));
	if ( cronSchedulerTimer ) { return }
	cronSchedulerTimer = setInterval(() => cronTick(), cronTickInterval);
	if ( cronLeader ) { cronTick(); return }
	if ( !navigator.locks ) { cronLeader = true; cronTick(); return }
	// held until the tab closes; another tab of this browser takes it then
	navigator.locks.request(cronLockName, () => {
		cronLeader = true;
		cronTick();
		return new Promise(() => {});
	});
}

let cronTicking = null;

function cronTick(reload=false){
	if ( !cronSchedulerTimer ) { return }
	if ( !cronTicking ) { cronTicking = runCronTick(reload).finally(() => { cronTicking = null }) }
	return cronTicking;
}

async function runCronTick(reload){
	try {
		await loadCronJobs(reload || Date.now() - cronLastLoad > cronReloadInterval);
	} catch ( err ) {
		console.error("Could not load the cron jobs", err);
		return;
	}
	renderCronRows();
	if ( !cronLeader || !cronEnabled() ) { return }
	const now = Date.now();
	const lastTick = Number(notebookStorage.getItem(cronLastTickKey)) || now;
	notebookStorage.setItem(cronLastTickKey, String(now));
	const missed = [];
	for ( const job of cronJobs ) {
		if ( !job.enabled || !isCronExecutor(job) || cronRunning.has(job.cron_id) || cronProblem(job.cron) ) { continue }
		const due = jobDue(job, lastTick, now);
		if ( due.missed && !job.missed ) { missed.push(job) }
		if ( due.run ) { runCronJob(job) }
	}
	for ( const job of missed ) {
		addCronLog(job, false, `${cronJobLabel(job)} missed: it should have run while the app was closed`);
		await saveCronJob(job, { missed: true }).catch((err) => console.error("Could not save the cron job", err));
	}
	renderCronRows();
	if ( !cronMissedNotified && cronJobs.some((job) => job.missed && isCronExecutor(job)) ) {
		cronMissedNotified = true;
		notifyMissedCronJobs();
	}
}

function notifyMissedCronJobs(){
	// one notification, it stays until closed or followed
	const notification = createNotification(`<a href="#" class="cron-missed-link">You have missed some cron jobs</a>`, "warning", 0, true);
	notification?.querySelector(".cron-missed-link").addEventListener("click", (e) => {
		e.preventDefault();
		closeNotification(notification);
		openCronModal();
	});
}


// running a job
function cronJobLabel(job){
	return `'${job.script}' in '${documentNameById(job.doc_id) ?? "a removed document"}'`;
}

async function runCronJob(job, manual=false){
	// runs in this browser; the outcome goes to the log, a failure is shown too
	if ( cronRunning.has(job.cron_id) ) { return false }
	cronRunning.add(job.cron_id);
	renderCronRows();
	let outcome;
	try {
		outcome = await executeCronJob(job);
	} catch ( err ) {
		outcome = { ok: false, message: err?.message ?? String(err) };
	}
	cronRunning.delete(job.cron_id);
	const label = cronJobLabel(job);
	const message = `${manual ? "Run manually: " : ""}${label} ${outcome.ok ? "executed" : "failed"}${outcome.message ? `: ${outcome.message}` : ""}`;
	await addCronLog(job, outcome.ok, message);
	try {
		await saveCronJob(job, { last_run: Date.now(), missed: false });
	} catch ( err ) {
		console.error("Could not save the cron job", err);
	}
	renderCronRows();
	if ( !outcome.ok ) {
		const notification = createNotification(`Cron job ${escapeHtmlText(label)} failed: ${escapeHtmlText(outcome.message)} <a href="#" class="cron-open-link">Notebook Cron</a>`, "error", notificationTimeoutLong, true);
		notification?.querySelector(".cron-open-link").addEventListener("click", (e) => { e.preventDefault(); openCronModal() });
	}
	return outcome.ok;
}

async function executeCronJob(job){
	// {ok, message}: the script runs in the document's editor when it is shown, else in one that isn't
	const name = documentNameById(job.doc_id);
	if ( !name ) { return { ok: false, message: "the document doesn't exist" } }
	if ( !storedDocumentMeta(name).scripts ) { return { ok: false, message: `scripts are disabled in '${name}', enable them from the document's menu` } }
	const pane = panes.find((p) => tabById(p.tabId)?.name === name);
	let editor = pane?.editor;
	if ( !editor ) {
		editor = document.createElement("div");
		editor.className = "editor";
		editor.dataset.docId = job.doc_id;
		editor.dataset.docName = name;
		editor.innerHTML = unsavedDocumentHtml(name) ?? splitDocumentId(notebookStorage.getItem(docPrefix + name)).html;
	}
	const activators = [...editor.querySelectorAll(".script-activator")].filter((a) => a.textContent.trim() === job.script);
	if ( activators.length !== 1 ) { return { ok: false, message: activators.length ? `${activators.length} scripts are named '${job.script}'` : `there is no script '${job.script}'` } }
	const code = activators[0].dataset.script || "";
	const problem = checkScriptCode(code);
	if ( problem ) { return { ok: false, message: problem } }
	const before = editor.innerHTML;
	const beforeKey = scriptHistoryKey(editor);
	const activatorIndex = [...editor.querySelectorAll(".script-activator")].indexOf(activators[0]);
	const run = await executeScript(editor, code);
	if ( !run ) { return { ok: false, message: "a script of the document is still running" } }
	if ( !run.ok ) { console.error(`Cron job ${cronJobLabel(job)} failed`, run.error) }
	let changed;
	if ( editor.isConnected ) {
		changed = afterScriptRun(editor, before, beforeKey, activatorIndex);
	} else {
		const html = editor.innerHTML;
		changed = html !== before && Boolean(changeDocument(name, (root) => { root.innerHTML = html; return 1 }));
	}
	const parts = [];
	if ( !run.ok ) { parts.push(run.error?.message ?? String(run.error)) }
	if ( changed ) { parts.push("it changed the document") }
	if ( run.result !== null ) { parts.push(`returned ${run.result}`) }
	return { ok: run.ok, message: parts.join("; ") };
}


// the modal
function openCronModal(){
	if ( !cronEnabled() ) {
		createNotification("Notebook cron is off, turn it on in Settings > Notebook cron", "warning", notificationTimeoutLong);
		return;
	}
	closeAllModals();
	createModal("Notebook Cron", `
	<p class="muted small">This browser: <strong class="cron-this-browser"></strong>. A job runs only in the browser set as its executor, while the app is open there.</p>
	<datalist id="cron-documents"></datalist>
	<div class="cron-table" role="table" aria-label="Cron jobs">
		<div class="cron-row cron-head" role="row">
			<span role="columnheader"><span class="sr-only">Missed</span></span>
			<span role="columnheader">Document</span>
			<span role="columnheader">Script</span>
			<span role="columnheader">Cron</span>
			<span role="columnheader">Executor</span>
			<span role="columnheader">Next execution</span>
			<span role="columnheader">Enabled</span>
			<span role="columnheader"><span class="sr-only">Actions</span></span>
		</div>
		<div class="cron-rows" role="rowgroup"></div>
	</div>
	<div class="row"><button class="btn" id="cron-add" type="button">Add</button></div>
	<details class="cron-help muted small">
		<summary>Cron</summary>
		<p><code>minute hour day month weekday</code>, each <code>*</code> (any), a number, a range <code>1-5</code>, a list <code>1,3</code> or a step <code>*/15</code>; weekday 0 or 7 is Sunday. E.g. <code>30 7 * * 1-5</code> at 7:30 on weekdays.</p>
		<p><code>_</code> runs once in the period, if not yet executed, whenever the app is open: <code>_ * * * *</code> every hour, <code>_ _ * * *</code> every day, <code>_ _ * * 2</code> on Tuesdays, <code>_ _ _ * *</code> every month.</p>
		<p>A job that should have run while the app was closed shows <span class="cron-missed">!</span> until it runs again.</p>
	</details>
	<h3>Log</h3>
	<ol class="cron-log small" aria-label="Cron log"></ol>`);
	const modal = document.getElementById("modal");
	modal.classList.add("cron-modal");
	modal.querySelector(".cron-this-browser").textContent = cronExecutor().name;
	modal.querySelector("#cron-add").addEventListener("click", addCronDraft);
	renderCronModal();
	loadCronJobs(true).catch((err) => informError("Could not load the cron jobs!", err));
}

function addCronDraft(){
	// a new job, of the focused document and its first script; stored once it is complete
	const name = getActiveTab()?.savedName || "";
	const id = newDocumentId();
	cronDrafts.set(id, {
		cron_id: id, doc_id: name ? documentIdOf(name) : null, script: cronScriptNames(name)[0] ?? "", cron: cronDefault,
		executor: cronExecutor().id, executor_name: cronExecutor().name, enabled: true, enabled_at: Date.now(), last_run: null, missed: false, draft: true,
	});
	renderCronModal();
	document.querySelector(`.cron-row[data-cron-id="${id}"] .cron-doc`)?.focus();
}

function cronScriptNames(name){
	// the display names of the document's scripts, as it is stored (or edited in its tab)
	if ( !name || !documentExists(name) ) { return [] }
	const root = document.createElement("div");
	root.innerHTML = unsavedDocumentHtml(name) ?? splitDocumentId(notebookStorage.getItem(docPrefix + name)).html;
	return [...new Set([...root.querySelectorAll(".script-activator")].map((a) => a.textContent.trim()).filter(Boolean))];
}

function renderCronModal(){
	const modal = document.querySelector(".cron-modal");
	if ( !modal ) { return }
	const datalist = modal.querySelector("#cron-documents");
	datalist.replaceChildren(...(getDocumentNamesFromLocalStorage() || []).sort((a, b) => a.localeCompare(b)).map((name) => new Option(name)));
	const rows = modal.querySelector(".cron-rows");
	const focused = document.activeElement?.closest?.(".cron-row")?.dataset.cronId;
	const all = [...cronJobs, ...cronDrafts.values()];
	// a row being edited stays as it is
	for ( const row of [...rows.children] ) {
		if ( !all.some((job) => job.cron_id === row.dataset.cronId) ) { row.remove() }
	}
	for ( const job of all ) {
		let row = rows.querySelector(`.cron-row[data-cron-id="${job.cron_id}"]`);
		if ( !row ) {
			row = cronRow(job);
			rows.append(row);
		} else if ( job.cron_id !== focused ) {
			fillCronRow(row, job);
		}
	}
	if ( !all.length ) {
		const empty = document.createElement("p");
		empty.className = "muted small cron-empty";
		empty.textContent = "No cron jobs yet. Add one to run a script of a document on a schedule.";
		rows.append(empty);
	}
	renderCronRows();
	renderCronLog();
}

function cronJobById(id){
	return cronJobs.find((job) => job.cron_id === id) || cronDrafts.get(id);
}

function cronRow(job){
	const row = document.createElement("div");
	row.className = "cron-row";
	row.setAttribute("role", "row");
	row.dataset.cronId = job.cron_id;
	row.innerHTML = `
		<span role="cell"><span class="cron-missed" title="Missed: it should have run while the app was closed" aria-label="Missed" hidden>!</span></span>
		<span role="cell"><input type="text" class="cron-doc" list="cron-documents" aria-label="Document" placeholder="Document" autocomplete="off"></span>
		<span role="cell"><input type="text" class="cron-script" aria-label="Script" placeholder="Script" autocomplete="off"><datalist></datalist></span>
		<span role="cell"><input type="text" class="cron-cron" aria-label="Cron" placeholder="${cronDefault}" autocomplete="off" spellcheck="false"></span>
		<span role="cell" class="cron-executor-cell"><span class="cron-executor small"></span><button type="button" class="small-btn cron-set-executor">Set this browser</button></span>
		<span role="cell" class="cron-next small" title="Next execution"></span>
		<span role="cell"><label class="cron-enabled-label"><input type="checkbox" class="cron-enabled" aria-label="Enabled"><span class="cron-mobile-label small">Enabled</span></label></span>
		<span role="cell" class="cron-actions"><button type="button" class="small-btn cron-run">Run</button><button type="button" class="small-btn cron-remove" aria-label="Remove" title="Remove">✕</button></span>
		<span class="cron-problem small" role="alert" hidden></span>`;
	const scripts = row.querySelector("datalist");
	scripts.id = `cron-scripts-${job.cron_id}`;
	row.querySelector(".cron-script").setAttribute("list", scripts.id);
	fillCronRow(row, job);
	row.querySelector(".cron-doc").addEventListener("change", (e) => {
		const name = e.target.value.trim();
		const id = documentExists(name) ? documentIdOf(name) : null;
		if ( !id ) { showCronProblem(row, name ? `There is no document '${name}'` : "Pick a document"); return }
		const names = cronScriptNames(name);
		const script = row.querySelector(".cron-script");
		if ( !names.includes(script.value.trim()) ) { script.value = names[0] ?? "" }
		fillCronScripts(row, name);
		changeCronJob(row, { doc_id: id, script: script.value.trim() });
	});
	row.querySelector(".cron-script").addEventListener("change", (e) => changeCronJob(row, { script: e.target.value.trim() }));
	row.querySelector(".cron-cron").addEventListener("change", (e) => {
		const cron = e.target.value.trim().replace(/\s+/g, " ");
		const problem = cronProblem(cron);
		if ( problem ) { showCronProblem(row, problem); return }
		changeCronJob(row, { cron });
	});
	row.querySelector(".cron-enabled").addEventListener("change", (e) => {
		changeCronJob(row, e.target.checked ? { enabled: true, enabled_at: Date.now() } : { enabled: false });
	});
	row.querySelector(".cron-set-executor").addEventListener("click", () => {
		const { id, name } = cronExecutor();
		changeCronJob(row, { executor: id, executor_name: name, enabled_at: Date.now() });
	});
	row.querySelector(".cron-run").addEventListener("click", () => {
		const job = cronJobById(row.dataset.cronId);
		if ( !job || job.draft ) { showCronProblem(row, "Complete the job first: a document and its script"); return }
		runCronJob(job, true);
	});
	row.querySelector(".cron-remove").addEventListener("click", async () => {
		const job = cronJobById(row.dataset.cronId);
		if ( !job ) { return }
		if ( job.draft ) { cronDrafts.delete(job.cron_id); renderCronModal(); return }
		if ( !showConfirm(`Remove the cron job ${cronJobLabel(job)}?`) ) { return }
		try {
			await deleteCronJob(job);
		} catch ( err ) {
			informError("Could not remove the cron job!", err);
		}
		renderCronModal();
	});
	return row;
}

function fillCronRow(row, job){
	const name = documentNameById(job.doc_id) ?? "";
	row.querySelector(".cron-doc").value = name;
	row.querySelector(".cron-script").value = job.script;
	row.querySelector(".cron-cron").value = job.cron;
	row.querySelector(".cron-enabled").checked = job.enabled;
	fillCronScripts(row, name);
}

function fillCronScripts(row, name){
	row.querySelector("datalist").replaceChildren(...cronScriptNames(name).map((n) => new Option(n)));
}

function showCronProblem(row, text){
	const problem = row.querySelector(".cron-problem");
	problem.textContent = text || "";
	problem.hidden = !text;
}

async function changeCronJob(row, fields){
	// a draft is stored once it has a document, a script and a valid cron
	const job = cronJobById(row.dataset.cronId);
	if ( !job ) { return }
	showCronProblem(row, null);
	if ( job.draft ) {
		Object.assign(job, fields);
		if ( !job.doc_id || !job.script ) { showCronProblem(row, !job.doc_id ? "Pick a document" : "Pick a script of the document, scripts are added with its Script tool"); return }
		const { draft, ...complete } = job;
		try {
			await saveCronJob({ cron_id: job.cron_id }, complete);
			cronDrafts.delete(job.cron_id);
		} catch ( err ) {
			showCronProblem(row, `Could not save the job: ${err.body?.detail ?? err.message}`);
		}
	} else {
		if ( "script" in fields && !fields.script ) { showCronProblem(row, "Pick a script of the document"); return }
		try {
			await saveCronJob(job, fields);
		} catch ( err ) {
			showCronProblem(row, `Could not save the job: ${err.body?.detail ?? err.message}`);
		}
	}
	renderCronRows();
}

function renderCronRows(){
	// what changes by itself: missed, executor, next execution, running
	const modal = document.querySelector(".cron-modal");
	if ( !modal ) { return }
	const me = cronExecutor().id;
	for ( const row of modal.querySelectorAll(".cron-row[data-cron-id]") ) {
		const job = cronJobById(row.dataset.cronId);
		if ( !job ) { continue }
		row.querySelector(".cron-missed").hidden = !job.missed;
		row.classList.toggle("cron-row-missed", Boolean(job.missed));
		row.querySelector(".cron-executor").textContent = !job.executor ? "None" : job.executor === me ? "This browser" : job.executor_name || "Another browser";
		row.querySelector(".cron-set-executor").hidden = job.executor === me;
		const running = cronRunning.has(job.cron_id);
		row.querySelector(".cron-run").disabled = running;
		row.querySelector(".cron-run").textContent = running ? "Running…" : "Run";
		row.querySelector(".cron-next").textContent = cronNextText(job);
	}
}

function cronNextText(job){
	if ( job.draft ) { return "Not saved yet" }
	if ( !job.enabled ) { return "Disabled" }
	if ( cronProblem(job.cron) ) { return "Invalid cron" }
	const next = nextJobRun(job);
	if ( next === null ) { return "Never" }
	const due = next <= Date.now();
	const when = due ? "Now" : formatTimestamp(new Date(next), false);
	return job.executor ? when : `${when} (no executor)`;
}

function renderCronLog(){
	const list = document.querySelector(".cron-modal .cron-log");
	if ( !list ) { return }
	list.replaceChildren(...cronLog.map((entry) => {
		const li = document.createElement("li");
		li.className = entry.ok ? "cron-log-ok" : "cron-log-error";
		const time = document.createElement("span");
		time.className = "cron-log-time muted";
		time.textContent = formatTimestamp(new Date(entry.at));
		const text = document.createElement("span");
		text.textContent = entry.message + (entry.executor_name ? ` (${entry.executor_name})` : "");
		li.append(time, text);
		return li;
	}));
	if ( !cronLog.length ) {
		const li = document.createElement("li");
		li.className = "muted";
		li.textContent = "Nothing has run yet.";
		list.append(li);
	}
}
