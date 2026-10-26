"""
Settings > Editor: autosave and the spell check (moved there from the menu); the spell check is stored, so a browser
dropping its own default (iOS Safari) doesn't turn it off, and goes to every editor.
"""
import pytest

pytest.importorskip("playwright")


@pytest.fixture
def app(browser, server):
	context = browser.new_context(viewport={"width": 1400, "height": 900})
	page = context.new_page()
	page.errors = []
	page.on("pageerror", lambda e: page.errors.append(str(e)))
	page.goto(server)
	page.evaluate("""() => {
		localStorage.clear();
		localStorage.setItem("__userConsent__", "1");
		localStorage.setItem("__doc__notes", "<div>text</div>");
		localStorage.setItem("__lastOpened__", "notes");
	}""")
	page.reload()
	page.wait_for_function("getActiveTab()?.name === 'notes'")
	yield page
	assert page.errors == []
	context.close()


SPELLCHECK = "[...document.querySelectorAll('#editor-grid .editor')].map((e) => e.spellcheck)"


def test_menu_has_no_toggles(app):
	assert app.locator("#spellcheck-btn, #toggle-autosave-btn").count() == 0


def test_spellcheck_is_on_until_turned_off_and_stays_off(app):
	assert app.evaluate(SPELLCHECK) == [True]
	app.evaluate("createSettingsModal()")
	assert app.locator("#setting-spellcheck").is_checked()
	app.uncheck("#setting-spellcheck")
	assert app.evaluate("localStorage.getItem(spellcheckKey)") == "0"
	assert app.evaluate("Object.keys(getAllLocalStorageItems()).includes(spellcheckKey)")
	assert app.evaluate(SPELLCHECK) == [False]
	app.reload()
	app.wait_for_function("getActiveTab()?.name === 'notes'")
	app.evaluate("splitEditor()")
	assert app.evaluate(SPELLCHECK) == [False, False]


def test_autosave_setting(app):
	app.evaluate("createSettingsModal()")
	assert not app.locator("#setting-autosave").is_checked()
	app.check("#setting-autosave")
	assert app.evaluate("[autosaveEnabled, localStorage.getItem(autosaveKey)]") == [1, "1"]
	app.reload()
	app.wait_for_function("getActiveTab()?.name === 'notes'")
	assert app.evaluate("autosaveEnabled") == 1
	app.evaluate("createSettingsModal()")
	assert app.locator("#setting-autosave").is_checked()
	app.uncheck("#setting-autosave")
	assert app.evaluate("[autosaveEnabled, localStorage.getItem(autosaveKey)]") == [0, "0"]
