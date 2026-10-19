"""
Duplicate (workspace.js): a document's right-click menu in the tree and its tab's menu copy the document into the same
folder as "name (copy)", with its own id, the unsaved edits included.
"""
import re

import pytest

pytest.importorskip("playwright")

ID_DIV = re.compile(r'^<div style="display:none;" data-id="([0-9a-f-]{36})"></div>')
FOLDERS = '{"folders": ["work"], "documents": {"plan": "work"}}'


@pytest.fixture
def app(browser, server):
	context = browser.new_context(viewport={"width": 1400, "height": 900})
	page = context.new_page()
	page.errors = []
	page.on("pageerror", lambda e: page.errors.append(str(e)))
	page.goto(server)
	page.evaluate("""(folders) => {
		localStorage.clear();
		localStorage.setItem("__userConsent__", "1");
		localStorage.setItem("__autosave__", "0");
		localStorage.setItem("__doc__plan", "<div>plan text</div>");
		localStorage.setItem("__doc__list", "<div>list text</div>");
		localStorage.setItem("__folders__", folders);
		localStorage.setItem("__lastOpened__", "plan");
	}""", FOLDERS)
	page.reload()
	page.wait_for_function("getActiveTab()?.name === 'plan'")
	yield page
	assert page.errors == []
	context.close()


def stored(page, name):
	return page.evaluate("(name) => localStorage.getItem('__doc__' + name)", name)


def content(page, name):
	return ID_DIV.sub("", stored(page, name))


def stored_id(page, name):
	return ID_DIV.match(stored(page, name)).group(1)


def duplicate_in_tree(page, name):
	page.locator(f'#file-tree-list .tree-document[data-name="{name}"]').click(button="right")
	page.locator("#context-menu button", has_text="Duplicate").click()


def test_tree_duplicates_into_the_same_folder(app):
	duplicate_in_tree(app, "plan")
	assert content(app, "plan (copy)") == content(app, "plan")
	assert stored_id(app, "plan (copy)") != stored_id(app, "plan")
	assert app.evaluate("folderOfDocument('plan (copy)')") == "work"
	assert app.locator('#file-tree-list .tree-document[data-name="plan (copy)"]').count() == 1
	duplicate_in_tree(app, "list")
	assert content(app, "list (copy)") == "<div>list text</div>"
	assert app.evaluate("folderOfDocument('list (copy)')") == ""


def test_taken_copy_name_gets_a_number(app):
	duplicate_in_tree(app, "list")
	duplicate_in_tree(app, "list")
	assert stored(app, "list (copy)") is not None
	assert content(app, "list (copy 2)") == "<div>list text</div>"


def test_tab_duplicates_with_unsaved_edits(app):
	app.click("#editor")
	app.keyboard.press("End")
	app.keyboard.type(" more")
	assert app.evaluate("getActiveTab().dirty")
	app.locator("#tabs .tab").filter(has_text="plan").click(button="right")
	app.locator("#context-menu button", has_text="Duplicate").click()
	assert "plan text more" in content(app, "plan (copy)")
	assert app.evaluate("folderOfDocument('plan (copy)')") == "work"
	# the original stays as it was saved
	assert content(app, "plan") == "<div>plan text</div>"


def test_untitled_tab_cant_be_duplicated(app):
	app.evaluate("openNewTab()")
	app.locator("#tabs .tab.active").click(button="right")
	assert app.locator("#context-menu button", has_text="Duplicate").is_disabled()
