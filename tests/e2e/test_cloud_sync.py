"""
Cloud sync (cloudsync.js): two devices of one user sync the notebook document by document.
"""
import json
import random
import string
import time

import pytest

pytest.importorskip("playwright")

from utils.zlib_util.zlib_util import compress

PASSWORD = "ValidPass123!"


def register(server):
	import httpx
	name = "sync" + "".join(random.choice(string.ascii_lowercase) for _ in range(8))
	httpx.post(server + "api/auth/register", json={"username": name, "password": PASSWORD, "email": name + "@test.com"})
	return name


@pytest.fixture(scope="module")
def user(server):
	return register(server)


def open_device(browser, server, user, notebook_before=None):
	# notebook_before: {key: value} kept as a whole in the cloud before, as the app did (routers/temp_notebooks.py)
	# a logged in browser, like after the login form
	context = browser.new_context(viewport={"width": 1400, "height": 900})
	# tokens of one user made in the same second are the same, and the server refuses a token it already has
	time.sleep(1.1)
	context.request.post(server + "api/auth/login/submit", form={"username": user, "password": PASSWORD}, max_redirects=0)
	if notebook_before is not None:
		context.request.post(server + "api/notebooks/notebook", data={"json_content": compress(json.dumps(notebook_before))})
	# storage consent before the app starts: a reload could drop the cookies of the refresh started on load
	context.add_init_script("""if ( !localStorage.getItem("__userConsent__") ) { localStorage.setItem("__userConsent__", "1") }""")
	page = context.new_page()
	page.errors = []
	page.on("pageerror", lambda e: page.errors.append(str(e)))
	# the tokens are refreshed on load
	with page.expect_response(lambda r: "/api/auth/token/refresh" in r.url):
		page.goto(server)
	page.wait_for_function("typeof syncCloud === 'function' && !tokenRefresh")
	sync(page)
	page.evaluate("closeAllModals()") # the welcome
	return page


def sync(page):
	page.evaluate("syncCloud({ manual: true })")
	page.wait_for_function("!cloudSyncRunning")


def save(page, name, html):
	# a document saved on this device, like autosave does
	page.evaluate("""([name, html]) => {
		localStorage.setItem(docPrefix + name, html);
		ensureDocumentIds(false);
		refreshFileTree();
	}""", [name, html])


def stored(page, name):
	return page.evaluate("(name) => { const html = localStorage.getItem(docPrefix + name); return html === null ? null : splitDocumentId(html).html }", name)


@pytest.fixture(scope="module")
def devices(browser, server, user):
	a = open_device(browser, server, user)
	b = open_device(browser, server, user)
	yield a, b
	assert a.errors == [] and b.errors == []
	a.context.close()
	b.context.close()


def test_document_goes_to_the_other_device(devices):
	a, b = devices
	save(a, "shared", "<div>hello</div>")
	sync(a)
	sync(b)
	assert stored(b, "shared") == "<div>hello</div>"


def test_change_goes_back(devices):
	a, b = devices
	save(b, "shared", b.evaluate("withDocumentId('<div>edited on b</div>', documentIdOf('shared'))"))
	sync(b)
	sync(a)
	assert stored(a, "shared") == "<div>edited on b</div>"


def test_rename_keeps_the_document(devices):
	a, b = devices
	a.evaluate("""() => {
		const html = localStorage.getItem(docPrefix + "shared");
		localStorage.removeItem(docPrefix + "shared");
		localStorage.setItem(docPrefix + "renamed", html);
	}""")
	sync(a)
	sync(b)
	assert stored(b, "shared") is None
	assert stored(b, "renamed") == "<div>edited on b</div>"


def test_folders_go_with_the_notebook(devices):
	a, b = devices
	a.evaluate("""() => { const store = readFolders(); store.folders.push("work"); writeFolders(store); moveDocumentsToFolder(["renamed"], "work") }""")
	sync(a)
	sync(b)
	assert b.evaluate("folderOfDocument('renamed')") == "work"


def test_both_changed_shows_the_conflict_resolver(devices):
	a, b = devices
	save(a, "renamed", a.evaluate("withDocumentId('<div>from a</div>', documentIdOf('renamed'))"))
	save(b, "renamed", b.evaluate("withDocumentId('<div>from b</div>', documentIdOf('renamed'))"))
	sync(a)
	sync(b)
	b.wait_for_selector(".sync-compare-modal")
	assert b.text_content(".sync-review-count") == "You have 1 document(s) to review"
	assert b.evaluate("documentCloudStatus(readCloudState(), documentIdOf('renamed'), localDocumentsById().get(documentIdOf('renamed')))") == "pending"
	b.click('.sync-compare-modal [data-pick="remote"]')
	assert stored(b, "renamed") == "<div>from a</div>"
	sync(b)
	assert b.evaluate("documentCloudStatus(readCloudState(), documentIdOf('renamed'), localDocumentsById().get(documentIdOf('renamed')))") == "synced"


def test_cloud_sync_modal_shows_the_statuses(devices):
	a, b = devices
	save(a, "local only", "<div>not synced yet</div>")
	a.evaluate("createSettingsModal()")
	# the first section of the settings
	assert a.text_content("#modal .modal-content h3") == "Cloud sync"
	a.click("#cloud-sync-btn")
	statuses = a.evaluate("""() => Object.fromEntries([...document.querySelectorAll(".cloud-sync-tree .tree-document")]
		.map((row) => [row.querySelector(".tree-label").textContent, row.dataset.status]))""")
	assert statuses == {"renamed": "synced", "local only": "queued"}
	counts = a.evaluate("""() => Object.fromEntries([...document.querySelectorAll(".cloud-sync-filter")]
		.map((btn) => [btn.dataset.status, btn.querySelector(".sync-count").textContent]))""")
	assert counts == {"synced": "1", "queued": "1", "progress": "0", "error": "0", "pending": "0"}
	# a status in the legend filters the list, several can be picked
	size = a.evaluate("[document.getElementById('modal').offsetWidth, document.getElementById('modal').offsetHeight]")
	a.click('.cloud-sync-filter[data-status="queued"]')
	# filtering doesn't resize the modal
	assert a.evaluate("[document.getElementById('modal').offsetWidth, document.getElementById('modal').offsetHeight]") == size
	assert a.evaluate("""[...document.querySelectorAll(".cloud-sync-tree .tree-label")].map((l) => l.textContent)""") == ["local only"]
	a.click('.cloud-sync-filter[data-status="synced"]')
	assert a.evaluate("""[...document.querySelectorAll(".cloud-sync-tree .tree-label")].map((l) => l.textContent)""") == ["work", "renamed", "local only"]
	a.click('.cloud-sync-filter[data-status="queued"]')
	a.click('.cloud-sync-filter[data-status="synced"]')
	folders = a.evaluate("""[...document.querySelectorAll(".cloud-sync-tree .tree-folder .tree-label")].map((l) => l.textContent)""")
	assert folders == ["work"]
	a.click("#cloud-resync-btn")
	a.wait_for_function("!cloudSyncRunning")
	assert a.evaluate("""document.querySelector('.cloud-sync-tree [data-status]:not([data-status="synced"])')""") is None
	a.evaluate("closeAllModals()")


def test_delete_goes_to_the_other_device(devices):
	a, b = devices
	sync(b)
	assert stored(b, "local only") == "<div>not synced yet</div>"
	b.evaluate("""() => { localStorage.removeItem(docPrefix + "local only"); refreshFileTree() }""")
	sync(b)
	sync(a)
	assert stored(a, "local only") is None


def test_auto_sync_waits_for_a_minute_after_the_last_sync(devices):
	a, _ = devices
	wait = a.evaluate("""() => {
		lastCloudSyncAt = Date.now();
		let delay;
		const original = window.setTimeout;
		window.setTimeout = (fn, ms) => { delay = ms; return 0 };
		try { handleRemoteAutosave() } finally { window.setTimeout = original }
		return delay;
	}""")
	assert 55000 < wait <= 60000
	wait = a.evaluate("""() => {
		lastCloudSyncAt = Date.now() - 120000;
		let delay;
		const original = window.setTimeout;
		window.setTimeout = (fn, ms) => { delay = ms; return 0 };
		try { handleRemoteAutosave() } finally { window.setTimeout = original }
		return delay;
	}""")
	assert wait == 5000


def test_notebook_from_before_is_moved_to_documents(browser, server):
	# a notebook kept as a whole comes to a new device and goes to the cloud document by document
	device = open_device(browser, server, register(server), {"__doc__old": "<div>from before</div>", "__viMode__": "1"})
	assert stored(device, "old") == "<div>from before</div>"
	assert device.evaluate("localStorage.getItem('__viMode__')") == "1"
	listed = device.evaluate("async () => (await cloudRequest(`/${cloudNotebookId}/documents`))")
	assert [d["name"] for d in listed["documents"]] == ["old"]
	assert listed["legacy"] is False
	assert device.errors == []
	device.context.close()
