"""
Notebook Cron (cron.js): jobs that run a document's script on a schedule, in the browser set as their executor. Not
logged in, the jobs and the log are kept in this browser (__crons__). Also the script API's duplicateDocument and the
timestamp of createNotification (scriptapi.js).
"""
import html
import json

import pytest

pytest.importorskip("playwright")

DOC_ID = "11111111-2222-4333-8444-555555555555"
EXECUTOR = {"id": "e1e1e1e1-0000-4000-8000-000000000001", "name": "Test browser"}
CODE = "const line = editor.querySelector('div'); line.textContent = 'count: ' + (Number(line.textContent.split(': ')[1]) + 1); return 'counted';"
META = html.escape(json.dumps({"scripts": True}))
DOC = (
	f'<div style="display:none;" data-id="{DOC_ID}"></div><div style="display:none;" data-meta="{META}"></div>'
	f'<div>count: 0</div><div><span class="script-activator" contenteditable="false" data-script="{html.escape(CODE)}" data-script-border="dashed">Inc</span></div>'
)
NOTES = "#notifications-container"


def open_app(browser, server, storage):
	context = browser.new_context(viewport={"width": 1400, "height": 900})
	page = context.new_page()
	page.errors = []
	page.on("pageerror", lambda e: page.errors.append(str(e)))
	page.goto(server)
	page.evaluate("""(storage) => {
		localStorage.clear();
		localStorage.setItem("__userConsent__", "1");
		localStorage.setItem("__autosave__", "0");
		localStorage.setItem("__doc__other", "<div>other</div>");
		localStorage.setItem("__lastOpened__", "other");
		for ( const [key, value] of Object.entries(storage) ) { localStorage.setItem(key, value) }
	}""", storage)
	page.reload()
	page.wait_for_function("getActiveTab()?.name === 'other'")
	return context, page


@pytest.fixture
def app(browser, server):
	opened = []

	def start(storage=None, cron=True, crons=None):
		storage = {"__doc__counter": DOC, "__cronExecutor__": json.dumps(EXECUTOR), **(storage or {})}
		if cron:
			storage["__cron__"] = "1"
		if crons is not None:
			storage["__crons__"] = json.dumps({"crons": crons, "log": []})
		context, page = open_app(browser, server, storage)
		opened.append((context, page))
		return page

	yield start
	for context, page in opened:
		assert page.errors == []
		context.close()


def job(**fields):
	return {
		"cron_id": "c0000000-0000-4000-8000-000000000001", "doc_id": DOC_ID, "script": "Inc", "cron": "_ _ * * *",
		"executor": EXECUTOR["id"], "executor_name": EXECUTOR["name"], "enabled": True, "enabled_at": 0, "last_run": None,
		"missed": False, **fields,
	}


def stored_counter(page):
	return page.evaluate("splitDocumentId(localStorage.getItem('__doc__counter')).html")


def stored_crons(page):
	return page.evaluate("JSON.parse(localStorage.getItem('__crons__'))")


def test_parse_cron(app):
	page = app(cron=False)
	assert page.evaluate("cronProblem('*/15 9-17 * * 1-5')") is None
	assert page.evaluate("cronProblem('_ _ * * 2')") is None
	assert page.evaluate("cronProblem('_ * * * *')") is None
	assert page.evaluate("cronProblem('_ _ _ * *')") is None
	assert "5 fields" in page.evaluate("cronProblem('* * *')")
	assert "come first" in page.evaluate("cronProblem('* _ * * *')")
	assert "out of" in page.evaluate("cronProblem('61 * * * *')")
	assert "weekday" in page.evaluate("cronProblem('_ _ _ * 1')")
	assert page.evaluate("[...parseCron('0 0 * * 7').fields[4]]") == [0]
	assert page.evaluate("parseCron('_ _ * * 2').period") == "day"


def test_next_run_and_due(app):
	page = app(cron=False)
	result = page.evaluate("""() => {
		const at = (s) => new Date(s).getTime();
		const show = (t) => t === null ? null : formatTimestamp(new Date(t), false);
		// Tuesday 2026-10-20, Wednesday 2026-10-21
		const tuesday = { cron: "_ _ * * 2", enabled: true, last_run: null };
		return {
			next: show(nextCronTime(parseCron("30 7 * * 1-5"), at("2026-10-23T08:00:00"))),
			dayOrWeekday: show(nextCronTime(parseCron("0 0 13 * 5"), at("2026-10-01T00:00:00"))),
			tuesdayAt11: jobDue(tuesday, at("2026-10-20T10:00:00"), at("2026-10-20T11:00:00")),
			tuesdayDone: jobDue({ ...tuesday, last_run: at("2026-10-20T07:00:00") }, at("2026-10-20T10:00:00"), at("2026-10-20T11:00:00")),
			wednesday: jobDue(tuesday, at("2026-10-21T08:00:00"), at("2026-10-21T09:00:00")),
			// closed from Monday to Wednesday: Tuesday was missed
			missedTuesday: jobDue(tuesday, at("2026-10-19T20:00:00"), at("2026-10-21T09:00:00")),
			nextTuesday: show(nextJobRun({ ...tuesday, last_run: at("2026-10-20T07:00:00") }, at("2026-10-20T11:00:00"))),
			hourly: jobDue({ cron: "_ * * * *", last_run: at("2026-10-20T10:59:00") }, at("2026-10-20T11:00:00"), at("2026-10-20T11:00:30")),
			// a time within the last 2 minutes runs, an older one was missed
			onTime: jobDue({ cron: "0 7 * * *" }, at("2026-10-20T06:59:50"), at("2026-10-20T07:00:10")),
			late: jobDue({ cron: "0 7 * * *" }, at("2026-10-19T22:00:00"), at("2026-10-20T09:00:00")),
			notYet: jobDue({ cron: "0 7 * * *" }, at("2026-10-20T06:00:00"), at("2026-10-20T06:30:00")),
		};
	}""")
	assert result["next"] == "07:30 26-10-2026"
	assert result["dayOrWeekday"] == "00:00 02-10-2026"  # Friday the 2nd, before the 13th
	assert result["tuesdayAt11"] == {"run": True, "missed": False}
	assert result["tuesdayDone"] == {"run": False, "missed": False}
	assert result["wednesday"] == {"run": False, "missed": False}
	assert result["missedTuesday"] == {"run": False, "missed": True}
	assert result["nextTuesday"] == "00:00 27-10-2026"
	assert result["hourly"] == {"run": True, "missed": False}
	assert result["onTime"] == {"run": True, "missed": False}
	assert result["late"] == {"run": False, "missed": True}
	assert result["notYet"] == {"run": False, "missed": False}


def test_menu_item_follows_the_setting(app):
	page = app(cron=False)
	page.click("#hamburger-button")
	assert not page.locator("#cron-btn").is_visible()
	page.click("#settings-btn")
	page.check("#setting-cron")
	assert page.evaluate("localStorage.getItem('__cron__')") == "1"
	page.click("#modal .section-head .small-btn")
	page.click("#hamburger-button")
	assert page.locator("#cron-btn").is_visible()


def test_add_a_job_and_run_it(app):
	page = app(crons=[])
	page.evaluate("openCronModal()")
	page.click("#cron-add")
	row = page.locator(".cron-rows .cron-row").first
	row.locator(".cron-doc").fill("counter")
	row.locator(".cron-doc").press("Tab")
	assert row.locator(".cron-script").input_value() == "Inc"
	row.locator(".cron-cron").fill("0 7 * * 1")
	row.locator(".cron-cron").press("Tab")
	page.wait_for_function("JSON.parse(localStorage.getItem('__crons__'))?.crons[0]?.cron === '0 7 * * 1'")
	saved = stored_crons(page)["crons"][0]
	assert (saved["doc_id"], saved["script"], saved["executor"], saved["enabled"]) == (DOC_ID, "Inc", EXECUTOR["id"], True)
	assert row.locator(".cron-executor").text_content() == "This browser"
	assert row.locator(".cron-next").text_content().startswith("07:00 ")
	# an invalid cron isn't saved
	row.locator(".cron-cron").fill("every day")
	row.locator(".cron-cron").press("Tab")
	assert "5 fields" in row.locator(".cron-problem").text_content()
	assert stored_crons(page)["crons"][0]["cron"] == "0 7 * * 1"
	# Run: the script runs on the stored document, which isn't opened
	row.locator(".cron-run").click()
	page.wait_for_function("JSON.parse(localStorage.getItem('__crons__')).log.length === 1")
	assert stored_counter(page).startswith("<div>count: 1</div>")
	log = page.locator(".cron-log li").first.text_content()
	assert "Run manually: 'Inc' in 'counter' executed" in log and "returned counted" in log
	assert stored_crons(page)["crons"][0]["last_run"] is not None
	# disabled, it doesn't run on its own
	row.locator(".cron-enabled").uncheck()
	page.wait_for_function("JSON.parse(localStorage.getItem('__crons__')).crons[0].enabled === false")
	assert row.locator(".cron-next").text_content() == "Disabled"


def test_a_due_job_runs_when_the_app_opens(app):
	page = app(crons=[job()])
	page.wait_for_function("JSON.parse(localStorage.getItem('__crons__')).log.length === 1")
	assert stored_counter(page).startswith("<div>count: 1</div>")
	# once a day: not again
	page.evaluate("cronTick()")
	page.wait_for_timeout(300)
	assert stored_counter(page).startswith("<div>count: 1</div>")


def test_runs_in_the_opened_document(app):
	page = app(crons=[job(cron="0 3 1 1 *")])
	page.evaluate("openDocumentInTab('counter')")
	page.evaluate("openCronModal()")
	page.locator(".cron-rows .cron-row .cron-run").click()
	page.wait_for_function("document.querySelector('#editor').textContent.startsWith('count: 1')")
	# like an edit: the tab has unsaved changes
	assert page.evaluate("getActiveTab().dirty") is True


def test_only_the_executor_runs_it(app):
	page = app(crons=[job(executor="another", executor_name="Firefox on Linux")])
	page.wait_for_timeout(500)
	assert stored_counter(page).startswith("<div>count: 0</div>")
	page.evaluate("openCronModal()")
	row = page.locator(".cron-rows .cron-row").first
	assert row.locator(".cron-executor").text_content() == "Firefox on Linux"
	row.locator(".cron-set-executor").click()
	page.wait_for_function("JSON.parse(localStorage.getItem('__crons__')).crons[0].executor === '%s'" % EXECUTOR["id"])
	page.evaluate("cronTick()")
	page.wait_for_function("localStorage.getItem('__doc__counter').includes('count: 1')")


def test_missed_jobs_are_notified_once(app):
	two_days_ago = "Date.now() - 2 * 24 * 60 * 60 * 1000"
	page = app(crons=[job(cron="0 7 * * *"), job(cron_id="c0000000-0000-4000-8000-000000000002", cron="30 7 * * *")])
	page.evaluate(f"localStorage.setItem('__cronLastTick__', String({two_days_ago})); cronTick()")
	link = page.locator(f"{NOTES} .cron-missed-link")
	link.wait_for()
	assert link.count() == 1 and link.text_content() == "You have missed some cron jobs"
	assert all(c["missed"] for c in stored_crons(page)["crons"])
	# missed jobs don't run by themselves
	assert stored_counter(page).startswith("<div>count: 0</div>")
	link.click()
	assert page.locator(".cron-modal").is_visible()
	assert page.locator(".cron-rows .cron-missed:not([hidden])").count() == 2
	# Run clears it
	page.locator(".cron-rows .cron-row").first.locator(".cron-run").click()
	page.wait_for_function("!JSON.parse(localStorage.getItem('__crons__')).crons[0].missed")
	assert page.locator(".cron-rows .cron-missed:not([hidden])").count() == 1
	# still one notification
	page.evaluate("cronTick()")
	page.wait_for_timeout(300)
	assert page.locator(f"{NOTES} .notification-container:not(.hidden) .cron-missed-link").count() == 0


def test_turned_off_nothing_runs_and_jobs_stay(app):
	page = app(cron=False, crons=[job()])
	page.wait_for_timeout(500)
	assert stored_counter(page).startswith("<div>count: 0</div>")
	assert len(stored_crons(page)["crons"]) == 1
	page.evaluate("openCronModal()")
	assert not page.locator(".cron-modal").count()


def test_notification_timestamp(app):
	page = app(cron=False)
	page.evaluate("scriptApi(document.getElementById('editor')).createNotification('hi', 'info', 0, true)")
	head = page.locator(f"{NOTES} .script-notification-head").last.text_content()
	assert head.startswith("Script execution ")
	import re
	assert re.fullmatch(r"Script execution \d\d:\d\d:\d\d \d\d-\d\d-\d{4}", head)
	page.evaluate("scriptApi(document.getElementById('editor')).createNotification('plain')")
	assert page.locator(f"{NOTES} .script-notification-head").last.text_content() == "Script execution"


def test_duplicate_document(app):
	page = app(cron=False, storage={
		"__doc__daily 1": "<div>1</div>", "__doc__daily 2": "<div>2</div>", "__doc__notes": "<div>n</div>",
		"__folders__": json.dumps({"folders": ["Work", "Work/Daily", "Home"], "documents": {"daily 1": "Work/Daily", "daily 2": "Work/Daily", "notes": "Home"}}),
	})
	dup = lambda query: page.evaluate("(q) => { try { return scriptApi(editorObject).duplicateDocument(q) } catch ( e ) { return 'Error: ' + e.message } }", query)
	assert dup({"directory": "Daily", "index": -1}) == "daily 2 (copy)"
	assert page.evaluate("folderOfDocument('daily 2 (copy)')") == "Work/Daily"
	assert dup({"directory": "Work/Daily", "index": 0}) == "daily 1 (copy)"
	assert dup({"doc": "notes"}) == "notes (copy)"
	assert dup({"doc": DOC_ID}) == "counter (copy)"
	assert dup({"directory": "", "doc": "other"}) == "other (copy)"
	assert "needs doc or index" in dup({"directory": "Daily"})
	# several folders named "Daily": its path is needed
	page.evaluate("createFolder ? (() => { const s = readFolders(); s.folders.push('Home/Daily'); writeFolders(s) })() : null")
	assert "2 folders are named" in dup({"directory": "Daily", "index": 0})
	assert "no document" in dup({"directory": "Home", "doc": "daily 1"})
	assert "no folder" in dup({"directory": "Nope", "index": 0})
	assert "at index 9" in dup({"directory": "Home", "index": 9})
	assert "object" in dup("notes")


def test_logged_in_jobs_are_kept_in_the_cloud(browser, server):
	# two browsers of one user: the job made in one is in the cloud, runs only in its executor, and both see the log
	from tests.e2e.test_cloud_sync import open_device, register, save
	user = register(server)
	a = open_device(browser, server, user)
	b = open_device(browser, server, user)
	try:
		for page in (a, b):
			save(page, "counter", DOC)
			page.evaluate("localStorage.setItem('__cron__', '1'); applyCronSetting()")
		a.evaluate(f"saveCronJob({{ cron_id: '{job()['cron_id']}' }}, {{ ...{json.dumps(job())}, executor: cronExecutor().id, executor_name: cronExecutor().name, enabled_at: Date.now() }})")
		assert a.evaluate("localStorage.getItem('__crons__')") is None
		a.evaluate("cronTick(true)")
		a.wait_for_function("localStorage.getItem('__doc__counter').includes('count: 1')")
		b.evaluate("cronTick(true)")
		b.wait_for_function("cronLog.length === 1")
		# b isn't the executor
		assert "count: 0" in b.evaluate("localStorage.getItem('__doc__counter')")
		b.evaluate("openCronModal()")
		row = b.locator(".cron-rows .cron-row").first
		row.wait_for()
		assert row.locator(".cron-executor").text_content() != "This browser"
		assert "'Inc' in 'counter' executed" in b.locator(".cron-log li").first.text_content()
		assert a.errors == [] and b.errors == []
	finally:
		a.context.close()
		b.context.close()
