"""
The desktop app (tauri_app/): its local server (without the window, the writejs-server binary) renders the page, passes
/api to the Write.JS server and opens folders of the computer as notebooks (static/localnotebooks.js).
Build it first: cargo build --manifest-path tauri_app/src-tauri/Cargo.toml --features test-server --bin writejs-server
"""
import json
import os
import struct
import zlib
import socket
import subprocess
import time
from pathlib import Path

import pytest

pytest.importorskip("playwright")

from tests.e2e.test_cloud_sync import PASSWORD, register
from utils.zlib_util.zlib_util import decompress

ROOT = Path(__file__).resolve().parents[2]
SERVER_BIN = ROOT / "tauri_app/src-tauri/target/debug/writejs-server"


def png(width=4, height=3):
	# a real picture, red
	row = b"\x00" + b"\xff\x00\x00" * width
	chunk = lambda kind, data: struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
	return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)) \
		+ chunk(b"IDAT", zlib.compress(row * height)) + chunk(b"IEND", b"")


def pdf(pages=2):
	# the smallest PDF with pages of text
	objects = ["<< /Type /Catalog /Pages 2 0 R >>",
		f"<< /Type /Pages /Kids [{' '.join(f'{3 + i * 2} 0 R' for i in range(pages))}] /Count {pages} >>"]
	for i in range(pages):
		text = f"BT /F1 24 Tf 72 720 Td (Page {i + 1}) Tj ET"
		objects.append(f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents {4 + i * 2} 0 R /Resources << /Font << /F1 {3 + pages * 2} 0 R >> >> >>")
		objects.append(f"<< /Length {len(text)} >>\nstream\n{text}\nendstream")
	objects.append("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
	out, offsets = "%PDF-1.4\n", []
	for n, obj in enumerate(objects, 1):
		offsets.append(len(out))
		out += f"{n} 0 obj\n{obj}\nendobj\n"
	xref = len(out)
	out += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n" + "".join(f"{o:010d} 00000 n \n" for o in offsets)
	out += f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n"
	return out.encode()


def wait_until(check, timeout=5):
	end = time.monotonic() + timeout
	while not check():
		if time.monotonic() > end:
			raise AssertionError("timed out")
		time.sleep(.05)


@pytest.fixture(scope="module")
def folders(tmp_path_factory):
	base = tmp_path_factory.mktemp("desktop")
	notes = base / "notes"
	(notes / "Work/Daily").mkdir(parents=True)
	(notes / "Plan.md").write_text("# Plan\n\n- [ ] one\n")
	(notes / "Work/Report.html").write_text("<div>report</div>")
	(notes / "Work/Daily/log.txt").write_text("line 1\nline 2\n")
	(notes / "photo.png").write_bytes(png())
	(notes / "manual.pdf").write_bytes(pdf())
	(notes / "data.csv").write_text("name,count\napples,3\n")
	(notes / "config.yaml").write_text("key: value\nlist:\n  - one\n")
	(notes / "release.nfo").write_text("plain text, unknown kind\n")
	(notes / "Media").mkdir()
	(notes / "Media/clip.mp4").write_bytes(b"\x00\x00\x00\x18ftyp")
	(base / "saved").mkdir()
	return base


@pytest.fixture(scope="module")
def desktop(server, folders):
	if not SERVER_BIN.exists():
		pytest.skip("build tauri_app first: cargo build --features test-server --bin writejs-server")
	with socket.socket() as s:
		s.bind(("127.0.0.1", 0))
		port = s.getsockname()[1]
	env = {
		**os.environ,
		"WRITEJS_PORT": str(port),
		"WRITEJS_CONFIG_DIR": str(folders / "config"),
		"WRITEJS_SERVER": server.rstrip("/"),
		"WRITEJS_STATIC": str(ROOT / "static"),
		# the dialogs' answers, and a trash of the test's own
		"WRITEJS_PICK_FOLDER": str(folders / "notes"),
		"WRITEJS_SAVE_DIR": str(folders / "saved"),
		"WRITEJS_OPEN_LOG": str(folders / "opened.log"),
		"XDG_DATA_HOME": str(folders / "data"),
	}
	process = subprocess.Popen([SERVER_BIN], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
	for _ in range(100):
		try:
			socket.create_connection(("127.0.0.1", port), timeout=.1).close()
			break
		except OSError:
			time.sleep(.1)
	yield f"http://127.0.0.1:{port}/"
	process.terminate()
	process.wait()


def open_app(browser, desktop, user=None):
	context = browser.new_context(viewport={"width": 1400, "height": 900})
	if user:
		time.sleep(1.1) # tokens of one user made in the same second are the same
		context.request.post(desktop + "api/auth/login/submit", form={"username": user, "password": PASSWORD}, max_redirects=0)
	context.add_init_script("""if ( !localStorage.getItem("__userConsent__") ) {
		localStorage.setItem("__userConsent__", "1");
		localStorage.setItem("__doc__browser doc", "<div>in the browser</div>");
	}""")
	page = context.new_page()
	page.errors = []
	page.on("pageerror", lambda e: page.errors.append(str(e)))
	page.on("dialog", lambda d: d.accept())
	page.goto(desktop)
	page.wait_for_function("typeof createNotebooksModal === 'function' && document.readyState === 'complete'")
	page.evaluate("closeAllModals()") # the first start's welcome
	return page


def open_folder(page):
	# Menu > Notebooks > Open a folder as a notebook: the "picked" folder (WRITEJS_PICK_FOLDER)
	with page.expect_navigation():
		page.evaluate("addLocalNotebook()")
	page.wait_for_function("window.localNotebook && document.readyState === 'complete'")


def names(page):
	return page.evaluate("getDocumentNamesFromLocalStorage().sort()")


@pytest.fixture(scope="module")
def app(browser, desktop):
	page = open_app(browser, desktop)
	yield page
	assert page.errors == []
	page.context.close()


def test_the_page_is_the_desktop_apps(app):
	assert app.evaluate("desktopApp.token.length") > 20
	assert app.is_hidden("#offline-btn")
	assert app.evaluate("navigator.serviceWorker.controller") is None
	# the app's API answers only its pages
	assert app.evaluate("fetch('/__writejs_app__/settings').then(r => r.status)") == 403
	assert app.evaluate("desktopRequest('/settings').then(s => s.serverUrl)").startswith("http://127.0.0.1")


def test_a_folder_opens_as_the_notebook(app, folders):
	open_folder(app)
	assert names(app) == ["Plan", "Report", "config.yaml", "data.csv", "log"]
	assert app.evaluate("readFolders().folders") == ["Media", "Work", "Work/Daily"]
	assert app.evaluate("folderOfDocument('log')") == "Work/Daily"
	assert app.text_content("#documents-tab") == "notes"
	# the browser's notebook stays where it is, apart
	assert app.evaluate("localStorage.getItem('__doc__browser doc')").endswith("<div>in the browser</div>")
	assert app.evaluate("localStorage.getItem('__doc__Plan')") is None
	# Markdown and text are converted
	app.evaluate("openDocumentInTab('Plan')")
	assert app.inner_text("#editor h1") == "Plan"
	assert app.locator("#editor li[data-checked=false]").count() == 1
	app.evaluate("openDocumentInTab('log')")
	assert app.evaluate("[...document.querySelectorAll('#editor > div')].map(d => d.textContent)") == ["line 1", "line 2"]


def test_every_file_shows_with_its_kind(app):
	kind = lambda selector: app.get_attribute(f"#file-tree-list {selector} .file-icon", "data-kind")
	assert kind('.tree-document[data-name="Plan"]') == "markdown"
	assert kind('.tree-document[data-name="data.csv"]') == "table"
	assert kind('.tree-document[data-name="config.yaml"]') == "data"
	assert kind('.tree-file[data-path="photo.png"]') == "image"
	assert kind('.tree-file[data-path="release.nfo"]') == "other"
	app.evaluate("expandFolder('Media'); refreshFileTree(true)")
	assert kind('.tree-file[data-path="Media/clip.mp4"]') == "video"


def test_text_files_open_and_save_as_they_are(app, folders):
	app.evaluate("openDocumentInTab('data.csv')")
	assert app.evaluate("[...document.querySelectorAll('#editor > div')].map(d => d.textContent)") == ["name,count", "apples,3"]
	app.click("#editor > div:last-child")
	app.keyboard.press("End")
	app.keyboard.press("Enter")
	app.keyboard.type("pears,5")
	app.click("#save-btn")
	wait_until(lambda: (folders / "notes/data.csv").read_text() == "name,count\napples,3\npears,5\n")
	# a new document named as a text file is that file
	app.evaluate("createNewDocument()")
	app.fill("#doc-name", "todo.yaml")
	app.click("#editor")
	app.keyboard.type("done: false")
	app.click("#save-btn")
	wait_until(lambda: (folders / "notes/todo.yaml").is_file())
	assert (folders / "notes/todo.yaml").read_text() == "done: false\n"


def file_menu(app, path):
	app.click(f'#file-tree-list .tree-file[data-path="{path}"]')
	return app.locator("#context-menu button").all_inner_texts()


def test_other_files_open_with_the_system(app, folders):
	assert file_menu(app, "release.nfo")[:3] == ["Try to open anyway", "Open with system default", "Show in file manager"]
	app.click("#context-menu button:text('Open with system default')")
	wait_until(lambda: (folders / "opened.log").is_file())
	assert (folders / "opened.log").read_text().splitlines()[-1] == f"open {folders / 'notes/release.nfo'}"


def test_files_documents_and_folders_show_in_the_file_manager(app, folders):
	log = folders / "opened.log"
	def shown(click):
		lines = len(log.read_text().splitlines()) if log.exists() else 0
		click()
		app.click("#context-menu button:text('Show in file manager')")
		wait_until(lambda: log.exists() and len(log.read_text().splitlines()) > lines)
		return log.read_text().splitlines()[-1]
	assert shown(lambda: app.click('#file-tree-list .tree-document[data-name="data.csv"]', button="right")) == f"show {folders / 'notes/data.csv'}"
	assert shown(lambda: app.click('#file-tree-list .tree-folder:has-text("Work")', button="right")) == f"show {folders / 'notes/Work'}"
	assert shown(lambda: app.click('#file-tree-list .tree-file[data-path="photo.png"]', button="right")) == f"show {folders / 'notes/photo.png'}"


def test_pictures_and_pdfs_open_in_a_preview(app, folders):
	app.click('#file-tree-list .tree-file[data-path="photo.png"]')
	app.wait_for_function("document.querySelector('.preview-modal .file-preview img')?.naturalWidth === 4")
	assert app.locator(".preview-modal [contenteditable]").count() == 0
	app.evaluate("closeAllModals()")
	app.click('#file-tree-list .tree-file[data-path="manual.pdf"]')
	app.wait_for_function("document.querySelectorAll('.preview-modal canvas.pdf-page').length === 2", timeout=10000)
	assert "2 pages" in app.inner_text(".preview-modal .preview-info")
	# drawn: not a blank canvas
	assert app.evaluate("""() => {
		const canvas = document.querySelector('.preview-modal canvas.pdf-page');
		const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
		return data.some((v, i) => i % 4 !== 3 && v < 128);
	}""")
	app.evaluate("closeAllModals()")
	# a file is served only to the app's pages, as it is, sandboxed
	assert app.evaluate("fetch(rawFileUrl('photo.png').replace(/token=[^&]*/, 'token=x')).then(r => r.status)") == 403
	headers = app.evaluate("fetch(rawFileUrl('manual.pdf')).then(r => [r.headers.get('content-type'), r.headers.get('content-security-policy')])")
	assert headers[0] == "application/pdf" and headers[1].startswith("sandbox")
	assert app.evaluate("fetch(rawFileUrl('../outside.txt')).then(r => r.status)") == 404


def test_other_files_can_be_tried_as_text(app, folders):
	# text: a document from then on
	file_menu(app, "release.nfo")
	app.click("#context-menu button:text('Try to open anyway')")
	app.wait_for_function("getActiveTab()?.name === 'release.nfo'")
	assert app.inner_text("#editor") .strip() == "plain text, unknown kind"
	assert app.locator('#file-tree-list .tree-document[data-name="release.nfo"]').count() == 1
	assert app.locator('#file-tree-list .tree-file[data-path="release.nfo"]').count() == 0
	# not text: shown in a new document, the file stays as it is
	(folders / "notes/blob.bin").write_bytes(b"\x00\xff\xfe binary")
	app.wait_for_selector('#file-tree-list .tree-file[data-path="blob.bin"]')
	file_menu(app, "blob.bin")
	app.click("#context-menu button:text('Try to open anyway')")
	app.wait_for_function("getActiveTab()?.name === 'blob.bin (as text)'")
	assert (folders / "notes/blob.bin").read_bytes() == b"\x00\xff\xfe binary"
	app.evaluate("closeTab(getActiveTab().id)")


def test_a_folder_goes_with_its_other_files(app, folders):
	app.evaluate("deleteFolder('Media')")
	wait_until(lambda: not (folders / "notes/Media").exists())
	assert list((folders / "data/Trash/files").glob("Media*"))
	assert app.locator('#file-tree-list .tree-file[data-path="Media/clip.mp4"]').count() == 0


def test_saving_writes_the_file(app, folders):
	plan = folders / "notes/Plan.md"
	app.evaluate("openDocumentInTab('Plan')")
	app.click("#editor h1")
	app.keyboard.press("End")
	app.keyboard.type(" for May")
	app.click("#save-btn")
	wait_until(lambda: "# Plan for May" in plan.read_text())
	# still Markdown, its id kept beside it
	assert "data-id" not in plan.read_text()
	sidecar = json.loads((folders / "notes/.writejs/notebook.json").read_text())
	assert sidecar["documents"]["Plan.md"]["id"] == app.evaluate("documentIdOf('Plan')")


def test_new_documents_moves_renames_and_deletes(app, folders):
	notes = folders / "notes"
	app.evaluate("createNewDocumentInFolder('Work')")
	app.fill("#doc-name", "Ideas")
	app.click("#editor")
	app.keyboard.type("an idea")
	app.click("#save-btn")
	wait_until(lambda: (notes / "Work/Ideas.html").is_file())
	assert "an idea" in (notes / "Work/Ideas.html").read_text()

	app.evaluate("moveDocumentsToFolder(['Ideas'], '')")
	wait_until(lambda: (notes / "Ideas.html").is_file() and not (notes / "Work/Ideas.html").exists())

	app.evaluate("relocateFolder('Work', 'Jobs')")
	wait_until(lambda: (notes / "Jobs/Daily/log.txt").is_file() and (notes / "Jobs/Report.html").is_file())
	assert not (notes / "Work").exists()
	assert app.evaluate("folderOfDocument('Report')") == "Jobs"

	app.evaluate("deleteDocumentInLocalStorage('Ideas')")
	wait_until(lambda: not (notes / "Ideas.html").exists())
	# into the trash, not gone
	assert list((folders / "data/Trash/files").glob("Ideas*.html"))
	assert (notes / "photo.png").is_file()


def test_changes_outside_of_the_app_show(app, folders):
	notes = folders / "notes"
	(notes / "External.md").write_text("from *another* editor\n")
	app.wait_for_function("getDocumentNamesFromLocalStorage().includes('External')", timeout=5000)
	assert app.locator("#file-tree-list", has_text="External").count() == 1
	# an opened document without unsaved edits shows the new text
	app.evaluate("openDocumentInTab('Plan')")
	app.wait_for_function("!localNotebookStorage.pending()")
	(notes / "Plan.md").write_text("# Plan for June\n")
	app.wait_for_function("document.querySelector('#editor h1')?.textContent === 'Plan for June'", timeout=5000)


def test_opened_documents_come_back_converted(app, folders):
	# a Markdown document opened on load is read before checklist.js: converted again once the page is loaded
	(folders / "notes/Todo.md").write_text("- [x] done\n- [ ] next\n")
	app.wait_for_function("getDocumentNamesFromLocalStorage().includes('Todo')", timeout=5000)
	app.evaluate("openDocumentInTab('Todo')")
	app.wait_for_function("!localNotebookStorage.pending()")
	app.reload()
	app.wait_for_function("window.localNotebook && document.readyState === 'complete'")
	assert app.evaluate("getActiveTab().name") == "Todo"
	app.wait_for_function("document.querySelectorAll('#editor li[data-checked]').length === 2")
	assert app.evaluate("getActiveTab().dirty") is False
	# nothing was written back on load
	assert (folders / "notes/Todo.md").read_text() == "- [x] done\n- [ ] next\n"


def test_exports_are_saved_where_picked(app, folders):
	app.evaluate("openDocumentInTab('Plan')")
	app.evaluate("exportMarkdown()")
	wait_until(lambda: (folders / "saved/Plan.markdown").is_file())
	assert "Plan for June" in (folders / "saved/Plan.markdown").read_text()


def test_the_apps_notebook_opens_again(app):
	with app.expect_navigation():
		app.evaluate("openNotebook(null)")
	app.wait_for_function("document.readyState === 'complete'")
	assert app.evaluate("window.localNotebook") is None
	assert names(app) == ["browser doc"]


def test_only_the_settings_sync_with_the_cloud(browser, desktop, server):
	user = register(server)
	page = open_app(browser, desktop, user)
	assert page.evaluate("typeof syncCloud") == "function" # logged in, through the local server
	page.evaluate("localStorage.setItem('__folders__', JSON.stringify({folders: ['Browser folder'], documents: {}, colors: {}}))")
	open_folder(page)
	page.wait_for_function("!cloudSyncRunning")
	page.evaluate("""() => {
		notebookStorage.setItem(docPrefix + "Local only", "<div>stays here</div>");
		notebookStorage.setItem("__spellcheck__", "0");
		notebookStorage.setItem(foldersKey, JSON.stringify({folders: ["Local folder"], documents: {}, colors: {}}));
	}""")
	page.evaluate("syncCloud({ manual: true })")
	page.wait_for_function("!cloudSyncRunning")
	api = page.context.request
	notebook_id = api.get(desktop + "api/notebooks").json()["notebooks"][0]["notebook_id"]
	documents = api.get(desktop + f"api/notebooks/{notebook_id}/documents").json()["documents"]
	assert [d["name"] for d in documents] == ["browser doc"]
	meta = json.loads(decompress(api.get(desktop + f"api/notebooks/{notebook_id}/meta").json()["content"]))
	assert meta["__spellcheck__"] == "0"
	# the cloud keeps the browser notebook's folders
	assert "Browser folder" in meta["__folders__"] and "Local folder" not in meta["__folders__"]
	assert not any(key.startswith("__notebook:") or key == "__localNotebook__" for key in meta)
	assert page.errors == []
	page.context.close()
