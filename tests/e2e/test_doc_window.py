"""
The document window (docwindow.js): a document on its own in a browser tab of its own, focus mode that stays on; its x
closes the window, its menu has the table of contents, search, inserting, copying and exporting. It never changes the
app's opened tabs, editors, layout or last opened document.
"""
import pytest

pytest.importorskip("playwright")


@pytest.fixture
def window(page):
	page.evaluate("""() => localStorage.setItem("__doc__windowed", withDocumentId("<h1>Heading</h1><div>window text</div>", newDocumentId()))""")
	with page.context.expect_page() as opened:
		page.evaluate("openDocumentWindow('windowed')")
	win = opened.value
	win.errors = []
	win.on("pageerror", lambda e: win.errors.append(str(e)))
	win.wait_for_function("typeof docWindowTab !== 'undefined' && Boolean(docWindowTab)")
	yield win
	assert win.is_closed() or win.errors == []
	if not win.is_closed():
		win.close()
	page.evaluate("""() => { tabs.filter(t => t.name === "windowed").forEach(t => { t.dirty = false; closeTab(t.id) }); localStorage.removeItem("__doc__windowed") }""")


def test_opens_the_document_in_focus_mode(window):
	assert window.evaluate("document.body.classList.contains('focus-mode') && document.body.classList.contains('doc-window')")
	assert window.evaluate("document.getElementById('editor').textContent") == "Headingwindow text"
	assert window.title() == "windowed - Write.JS"
	assert window.is_hidden(".topbar")
	assert float(window.evaluate("getComputedStyle(document.getElementById('focus-exit-btn')).opacity")) > .5


def test_no_other_document_opens(window):
	window.evaluate("openDocumentInTab('test')")
	assert window.evaluate("tabs.map(t => t.name)") == ["windowed"]
	window.keyboard.press("Escape")
	assert window.evaluate("document.body.classList.contains('focus-mode')")


def test_menu_and_table_of_contents(window):
	window.click("#doc-window-menu-btn")
	labels = window.evaluate("[...document.querySelectorAll('#doc-window-menu-list button')].map(b => b.textContent)")
	assert labels == ["Show Table of Contents", "Search in Document", "Insert or Append HTML", "Insert or Append Markdown",
		"Copy as Markdown", "Export", "Export as Markdown"]
	window.click("#doc-window-menu-list [data-action='toc']")
	assert window.is_visible("#doc-window-toc")
	assert window.evaluate("[...document.querySelectorAll('#doc-window-toc .toc-row')].map(r => r.textContent)") == ["Heading"]
	window.click("#doc-window-toc-hide")
	assert window.is_hidden("#doc-window-toc")


def test_saves_reach_the_app(window, page):
	page.evaluate("openDocumentInTab('windowed')")
	window.evaluate("""() => { document.getElementById("editor").insertAdjacentHTML("beforeend", "<div>added</div>"); saveDocumentToLocalStorage() }""")
	page.wait_for_function("document.getElementById('editor').textContent.includes('added')")


def test_x_closes_the_window(window):
	with window.expect_event("close"):
		window.click("#focus-exit-btn")
	assert window.is_closed()


APP_STATE_JS = "[localStorage.getItem('__openedTabs__'), localStorage.getItem('__lastOpened__'), localStorage.getItem('__layout__'), localStorage.getItem('__openedEditors__')]"


def test_app_state_is_left_as_it_is(page):
	page.evaluate("""() => localStorage.setItem("__doc__windowed", withDocumentId("<h1>Heading</h1>", newDocumentId()))""")
	before = page.evaluate(APP_STATE_JS)
	with page.context.expect_page() as opened:
		page.evaluate("openDocumentWindow('windowed')")
	win = opened.value
	win.wait_for_function("typeof docWindowTab !== 'undefined' && Boolean(docWindowTab)")
	win.evaluate("openTableOfContents(); saveDocumentToLocalStorage()")
	assert page.evaluate(APP_STATE_JS) == before
	win.close()
	page.evaluate("localStorage.removeItem('__doc__windowed')")
