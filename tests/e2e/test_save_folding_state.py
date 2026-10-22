"""
Settings > Save folding state: Contents remembers what is collapsed in the table of contents for each document on this
device (toc.js), Document saves the collapsed headings and list items with the document (folding.js). Both are on until
turned off.
"""
import pytest

pytest.importorskip("playwright")

DOC = "<h1>Notes</h1><div>intro</div><h2>Chapter 1</h2><div>one</div><h2>Chapter 2</h2><div>two</div>"
SHOWN_JS = """() => [...document.querySelectorAll("#toc-panel .toc-row")].filter((r) => !r.parentElement.hidden).map((r) => r.textContent)"""


@pytest.fixture
def app(browser, server):
	context = browser.new_context(viewport={"width": 1400, "height": 900})
	page = context.new_page()
	page.errors = []
	page.on("pageerror", lambda e: page.errors.append(str(e)))
	page.goto(server)
	page.evaluate("""(doc) => {
		localStorage.clear();
		localStorage.setItem("__userConsent__", "1");
		localStorage.setItem("__autosave__", "0");
		localStorage.setItem("__doc__notes", doc);
		localStorage.setItem("__doc__other", "<h1>Other</h1><div>x</div>");
		localStorage.setItem("__lastOpened__", "notes");
		localStorage.setItem("__layout__", JSON.stringify({tocHidden: false, tocSide: "right"}));
	}""", DOC)
	page.reload()
	page.wait_for_function("getActiveTab()?.name === 'notes'")
	yield page
	assert page.errors == []
	context.close()


def shown(page, length):
	page.wait_for_function(f"({SHOWN_JS})().length === {length}")
	return page.evaluate(SHOWN_JS)


def collapse_notes(page):
	shown(page, 3)
	page.locator("#toc-panel .toc-row", has_text="Notes").locator(".toc-fold").click()
	return shown(page, 1)


def reopen(page):
	page.reload()
	page.wait_for_function("getActiveTab()?.name === 'notes'")


def open_settings(page):
	page.click("#hamburger-button")
	page.click("#settings-btn")


def test_settings_section(app):
	open_settings(app)
	modal = app.locator("#modal")
	assert modal.locator("h3", has_text="Save folding state").count() == 1
	assert app.is_checked("#setting-save-contents-folds")
	assert app.is_checked("#setting-save-document-folds")


def test_contents_folds_are_remembered(app):
	assert collapse_notes(app) == ["Notes"]
	# another document has its own; back to this one, still collapsed
	app.evaluate("loadDocumentFromLocalStorage('other')")
	assert shown(app, 1) == ["Other"]
	app.evaluate("loadDocumentFromLocalStorage('notes')")
	app.wait_for_function(f"({SHOWN_JS})()[0] === 'Notes'")
	assert shown(app, 1) == ["Notes"]
	reopen(app)
	assert shown(app, 1) == ["Notes"]
	# the document itself isn't folded
	assert "data-collapsed" not in app.evaluate("localStorage.getItem('__doc__notes')")


def test_contents_folds_not_remembered_when_off(app):
	collapse_notes(app)
	open_settings(app)
	app.uncheck("#setting-save-contents-folds")
	app.evaluate("closeAllModals()")
	assert app.evaluate("localStorage.getItem('__tocFolds__')") is None
	reopen(app)
	shown(app, 3)
	collapse_notes(app)
	assert app.evaluate("localStorage.getItem('__tocFolds__')") is None


def test_document_folds_not_saved_when_off(app):
	open_settings(app)
	app.uncheck("#setting-save-document-folds")
	app.evaluate("closeAllModals()")
	app.evaluate("toggleHeadingFold(document.querySelector('#editor > h2'))")
	# folding doesn't change the document
	assert not app.evaluate("getActiveTab().dirty")
	assert app.evaluate("document.querySelector('#editor > h2').dataset.collapsed") == "true"
	app.click("#editor")
	app.keyboard.press("Control+End")
	app.keyboard.type(" more")
	app.click("#save-btn")
	stored = app.evaluate("localStorage.getItem('__doc__notes')")
	assert "more" in stored
	assert "data-collapsed" not in stored and "fold-hidden" not in stored


def test_document_folds_saved_by_default(app):
	app.evaluate("toggleHeadingFold(document.querySelector('#editor > h2'))")
	assert app.evaluate("getActiveTab().dirty")
	app.click("#save-btn")
	assert 'data-collapsed="true"' in app.evaluate("localStorage.getItem('__doc__notes')")
