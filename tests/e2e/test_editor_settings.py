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


def test_vi_mode_persists_on_this_device_and_is_excluded_from_backup(app):
	app.evaluate("createSettingsModal()")
	assert not app.locator('#setting-vi-mode').is_checked()
	assert 'this device only' in app.locator('label', has=app.locator('#setting-vi-mode')).inner_text()
	app.check('#setting-vi-mode')
	app.wait_for_function('window.WriteVi && viModeEnabled()')
	assert app.evaluate('Object.hasOwn(getAllLocalStorageItems(), viModeKey)') is False
	app.reload()
	app.wait_for_function('window.WriteVi && viModeEnabled()')
	app.evaluate('createSettingsModal()')
	assert app.locator('#setting-vi-mode').is_checked()
	app.uncheck('#setting-vi-mode')
	app.reload()
	app.wait_for_function("getActiveTab()?.name === 'notes'")
	assert app.evaluate('localStorage.getItem(viModeKey)') == '0'
	assert app.evaluate('viModeEnabled()') is False


@pytest.mark.parametrize('local_value', [None, '0', '1'])
@pytest.mark.parametrize('source', ['backup', 'legacy_cloud'])
def test_imported_vi_mode_does_not_change_device_preference(app, local_value, source):
	app.evaluate("""([value, source]) => {
		if (value === null) { localStorage.removeItem(viModeKey) }
		else { localStorage.setItem(viModeKey, value) }
		const json = JSON.stringify({[viModeKey]: value === '1' ? '0' : '1'});
		loadDataFromLocalStorageJson(json, false, false, source === 'legacy_cloud');
	}""", [local_value, source])
	assert app.evaluate('localStorage.getItem(viModeKey)') == local_value


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


HEADINGS = '<h1>One</h1><h2>Two</h2><h3>Three</h3><h4>Four</h4>'


def imported_breaks(app):
	return app.evaluate("""html => {
		const root = document.createElement('div');
		root.innerHTML = sanitizeStyles(html);
		return [...root.querySelectorAll('hr')].map(hr => hr.previousElementSibling.tagName);
	}""", HEADINGS)


def test_heading_breaks_default_to_h1_and_can_be_disabled(app):
	assert imported_breaks(app) == ['H1']
	app.evaluate('createSettingsModal()')
	assert app.locator('#setting-heading-breaks').is_checked()
	assert app.locator('#setting-heading-break-h1').is_checked()
	assert not app.locator('#setting-heading-break-h2').is_checked()
	app.uncheck('#setting-heading-breaks')
	assert imported_breaks(app) == []
	app.reload()
	app.wait_for_function("getActiveTab()?.name === 'notes'")
	assert imported_breaks(app) == []
	app.evaluate('createSettingsModal()')
	app.check('#setting-heading-breaks')
	assert imported_breaks(app) == ['H1']


def test_heading_break_levels_persist_and_do_not_duplicate_manual_rules(app):
	app.evaluate('createSettingsModal()')
	app.check('#setting-heading-break-h2')
	app.uncheck('#setting-heading-break-h1')
	assert imported_breaks(app) == ['H2']
	app.reload()
	app.wait_for_function("getActiveTab()?.name === 'notes'")
	assert imported_breaks(app) == ['H2']
	assert app.evaluate("sanitizeStyles('<h2>Two</h2><hr>')") == '<h2>Two</h2><hr>'


@pytest.mark.parametrize('enabled, expected', [('0', []), ('1', ['H1', 'H2', 'H3', 'H4'])])
def test_existing_heading_break_preference_is_preserved(app, enabled, expected):
	app.evaluate('(value) => localStorage.setItem(headingBreaksKey, value)', enabled)
	assert imported_breaks(app) == expected


@pytest.mark.parametrize('tag, rules', [('h1', 1), ('h2', 0)])
def test_formatting_heading_adds_rule_only_for_selected_level(app, tag, rules):
	app.evaluate("""tag => {
		const editor = document.getElementById('editor');
		editor.focus();
		const range = document.createRange();
		range.selectNodeContents(editor.firstElementChild);
		getSelection().removeAllRanges();
		getSelection().addRange(range);
		formatText(tag);
	}""", tag)
	assert app.locator(f'#editor {tag}').count() == 1
	assert app.locator('#editor hr.heading-break').count() == rules
	app.evaluate("formatText('div')")
	assert app.locator('#editor hr.heading-break').count() == 0


def test_typed_h1_enter_keeps_rule_above_new_text(app):
	app.evaluate("""() => {
		const editor = document.getElementById('editor');
		editor.innerHTML = '<div><br></div>';
		editor.focus();
		getSelection().collapse(editor.firstChild, 0);
	}""")
	app.keyboard.type('# Title')
	app.keyboard.press('Enter')
	app.keyboard.type('Body')
	assert app.locator('#editor').inner_html() == '<h1>Title</h1><hr class="heading-break"><div>Body</div>'
