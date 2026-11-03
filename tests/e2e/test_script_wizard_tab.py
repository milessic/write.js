"""
The Script wizard belongs to its document's tab (scripting.js): another tab shown in its editor hides it, back on its tab
it shows again where it was, with what was typed; it adds the button to its own document. Its tab closed, it goes.
"""
import pytest

pytest.importorskip("playwright")

from tests.e2e.test_scripting import app, toggle_scripts  # noqa: F401


@pytest.fixture
def two_tabs(app):
	app.evaluate("localStorage.setItem('__doc__other', '<div>other text</div>')")
	toggle_scripts(app)
	app.click("#save-btn")
	app.locator("#editor").get_by_text("intro", exact=True).click()
	app.keyboard.press("End")
	app.click("#tb-btn-script")
	return app


def wizard(page):
	return page.locator(".script-wizard")


def test_hidden_on_another_tab_and_back_where_it_was(two_tabs):
	app = two_tabs
	app.fill(".script-wizard .script-name", "Hello")
	app.evaluate("placeScriptWindow(document.querySelector('.script-wizard'), 100, 120)")
	place = wizard(app).bounding_box()
	app.evaluate("openDocumentFromTree('other')")
	assert app.evaluate("getActiveTab().name") == "other"
	assert not wizard(app).is_visible()
	# Esc there doesn't close it
	app.locator("#editor").click()
	app.keyboard.press("Escape")
	assert wizard(app).count() == 1
	app.locator("#tabs .tab", has_text="plan").click()
	assert wizard(app).is_visible()
	assert wizard(app).bounding_box() == place
	assert app.input_value(".script-wizard .script-name") == "Hello"


def test_adds_to_its_own_document_after_going_away(two_tabs):
	app = two_tabs
	app.fill(".script-wizard .script-name", "Hello")
	app.fill(".script-wizard .script-code", "return 1")
	app.evaluate("openDocumentFromTree('other')")
	app.locator("#tabs .tab", has_text="plan").click()
	app.click(".script-wizard .script-save")
	assert wizard(app).count() == 0
	assert app.evaluate("document.querySelector('#editor .script-activator')?.textContent") == "Hello"
	# after intro, where the caret was
	assert app.evaluate("document.querySelector('#editor .script-activator').parentElement.textContent").startswith("intro")
	app.evaluate("openDocumentFromTree('other')")
	assert app.evaluate("document.querySelector('#editor .script-activator')") is None


def test_closing_its_tab_closes_it(two_tabs):
	app = two_tabs
	app.evaluate("openDocumentFromTree('other')")
	app.evaluate("closeTab(tabs.find((t) => t.name === 'plan').id)")
	assert wizard(app).count() == 0


def test_split_view_keeps_it_while_its_tab_is_shown(two_tabs):
	app = two_tabs
	app.evaluate("splitEditor()")
	app.evaluate("openDocumentFromTree('other')")
	# plan is still shown, in the other editor
	assert wizard(app).is_visible()
