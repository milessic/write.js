"""
The document's title (workspace.js): with showTitle in the document's metadata (doclinks.js) its name shows above the
text as a big <h1 role="title">, line 0. It isn't part of the text; editing it renames the document, and renaming it
changes the title. The document's menus show or hide it.
"""
import json
import re

import pytest

pytest.importorskip("playwright")

META = re.compile(r'^<div style="display:none;" data-id="[0-9a-f-]{36}"></div><div style="display:none;" data-meta="([^"]*)"></div>')
TITLE = ".editor-pane.focused .doc-title"


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
		localStorage.setItem("__autosave__", "0");
		localStorage.setItem("__doc__plan", "<h1>Heading</h1><div>plan text</div>");
		localStorage.setItem("__lastOpened__", "plan");
	}""")
	page.reload()
	page.wait_for_function("getActiveTab()?.name === 'plan'")
	yield page
	assert page.errors == []
	context.close()


def stored(page, name):
	return page.evaluate("(name) => localStorage.getItem('__doc__' + name)", name)


def stored_meta(page, name):
	match = META.match(stored(page, name) or "")
	return json.loads(match.group(1).replace("&quot;", '"')) if match else {}


def show_title(page, label="Show title"):
	page.locator("#tabs .tab.active").click(button="right")
	page.locator("#context-menu button", has_text=label).click()


def test_hidden_until_shown_from_the_menu(app):
	assert not app.locator(TITLE).is_visible()
	show_title(app)
	assert app.locator(TITLE).is_visible()
	assert app.locator(TITLE).text_content() == "plan"
	assert app.locator(TITLE).get_attribute("role") == "title"
	# not in the text, nor in the table of contents
	assert "plan</h1>" not in app.evaluate("document.getElementById('editor').innerHTML")
	app.evaluate("openTableOfContents()")
	app.wait_for_timeout(50)
	assert app.evaluate("[...document.querySelectorAll('#toc-panel .toc-row')].map((r) => r.textContent)") == ["Heading"]
	# the metadata is saved with the document
	app.click("#save-btn")
	assert stored_meta(app, "plan") == {"showTitle": True}
	assert stored(app, "plan").endswith("<h1>Heading</h1><div>plan text</div>")


def test_kept_across_visits_and_hidden_again(app):
	show_title(app)
	app.click("#save-btn")
	app.reload()
	app.wait_for_function("getActiveTab()?.name === 'plan'")
	assert app.locator(TITLE).is_visible()
	show_title(app, "Hide title")
	assert not app.locator(TITLE).is_visible()
	app.click("#save-btn")
	assert stored_meta(app, "plan") == {}


def test_editing_the_title_renames_the_document(app):
	show_title(app)
	app.click(TITLE)
	app.keyboard.press("End")
	app.keyboard.type(" B")
	assert app.input_value("#doc-name") == "plan B"
	assert app.locator("#tabs .tab.active").text_content() == "plan B"
	assert app.evaluate("getActiveTab().dirty")
	assert app.evaluate("document.title") == "plan B - Write.JS"
	# no autosave letter by letter: only saving renames it
	assert stored(app, "plan B") is None
	app.click("#save-btn")
	assert stored(app, "plan") is None
	assert stored_meta(app, "plan B") == {"showTitle": True}


def test_renaming_changes_the_title(app):
	show_title(app)
	app.fill("#doc-name", "renamed")
	assert app.locator(TITLE).text_content() == "renamed"


def test_title_keys(app):
	show_title(app)
	app.click(TITLE)
	# Enter goes to the text, the title stays one line
	app.keyboard.press("Enter")
	assert app.evaluate("document.activeElement.id") == "editor"
	assert app.locator(TITLE).text_content() == "plan"
	# the arrow up from the first line goes back
	app.keyboard.press("ArrowUp")
	assert app.evaluate("document.activeElement.classList.contains('doc-title')")


def test_line_zero(app):
	show_title(app)
	app.evaluate("setLineNumbers(true)")
	app.wait_for_timeout(100)
	numbers = app.evaluate("[...document.querySelectorAll('.editor-pane.focused .line-numbers > span')].map((s) => s.textContent)")
	assert numbers[:3] == ["0", "1", "2"]
	app.evaluate("setLineNumbers(false)")


def test_duplicate_keeps_the_metadata(app):
	show_title(app)
	app.click("#save-btn")
	app.locator('#file-tree-list .tree-document[data-name="plan"]').click(button="right")
	app.locator("#context-menu button", has_text="Duplicate").click()
	assert stored_meta(app, "plan (copy)") == {"showTitle": True}


def test_vi_mode_leaves_the_title_to_typing(app):
	app.evaluate("localStorage.setItem('__viMode__', '1')")
	app.reload()
	app.wait_for_function("window.WriteVi")
	show_title(app)
	app.click(TITLE)
	app.keyboard.press("End")
	app.keyboard.type("jk")
	assert app.input_value("#doc-name") == "planjk"
	app.keyboard.press("Escape")
	assert app.evaluate("document.activeElement.id") == "editor"
