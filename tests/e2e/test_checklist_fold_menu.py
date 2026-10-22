"""
A document's menus (its tab, its editor's head, the documents tree) unfold all its checklist items or fold the completed
ones with nested items (folding.js, workspace.js): in its editor when it is shown, else in the stored document.
"""
import pytest

pytest.importorskip("playwright")

DOC = ('<ul><li data-checked="true" data-collapsed="true">done</li><ul><li data-checked="true">done sub</li></ul>'
	'<li data-checked="false">open</li><ul><li data-checked="false">open sub</li></ul>'
	'<li data-checked="true">done too</li><ul><li data-checked="false">its sub</li></ul>'
	'<li data-checked="true">done alone</li></ul>')
STATE = """(root) => [...root.querySelectorAll("li[data-checked]")].filter((li) => li.dataset.collapsed).map((li) => li.firstChild.textContent)"""


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
		localStorage.setItem("__doc__tasks", doc);
		localStorage.setItem("__doc__other", "<div>other</div>");
		localStorage.setItem("__lastOpened__", "tasks");
	}""", DOC)
	page.reload()
	page.wait_for_function("getActiveTab()?.name === 'tasks'")
	yield page
	assert page.errors == []
	context.close()


def collapsed_in_editor(page):
	return page.evaluate(f"({STATE})(document.getElementById('editor'))")


def collapsed_stored(page, name):
	return page.evaluate(f"""(name) => {{
		const root = document.createElement("div");
		root.innerHTML = localStorage.getItem("__doc__" + name);
		return ({STATE})(root);
	}}""", name)


def tab_menu(page, label, name="tasks"):
	page.locator("#tabs .tab").filter(has_text=name).click(button="right")
	page.locator("#context-menu button", has_text=label).click()


def test_tab_menu_folds_completed_and_unfolds_all(app):
	tab_menu(app, "Fold all completed checkboxes")
	assert collapsed_in_editor(app) == ["done", "done too"]
	# the item without nested items has nothing to fold; the tab has unsaved changes now
	assert app.evaluate("getActiveTab().dirty")
	tab_menu(app, "Unfold all checkboxes")
	assert collapsed_in_editor(app) == []


def test_editor_head_menu_changes_its_editor(app):
	# the heads show in split view; the second editor is focused
	app.evaluate("splitEditor()")
	app.locator(".editor-pane .pane-head").first.click(button="right")
	app.locator("#context-menu button", has_text="Unfold all checkboxes").click()
	assert app.evaluate(f"({STATE})(document.querySelector('.editor-pane .editor'))") == []


def test_tree_menu_changes_a_document_that_isnt_open(app):
	app.evaluate("""() => localStorage.setItem("__doc__other", localStorage.getItem("__doc__tasks").replace(/^<div[^>]*data-id[^>]*><\\/div>/, ""))""")
	app.evaluate("refreshFileTree(true)")
	app.locator('#file-tree-list .tree-document[data-name="other"]').click(button="right")
	app.locator("#context-menu button", has_text="Fold all completed checkboxes").click()
	assert collapsed_stored(app, "other") == ["done", "done too"]
	# the open document is left as it was
	assert collapsed_in_editor(app) == ["done"]
	assert app.locator(".notification-container", has_text="1 checklist item folded").count() == 1


def test_nothing_to_change_says_so(app):
	tab_menu(app, "Unfold all checkboxes")
	tab_menu(app, "Unfold all checkboxes")
	assert app.locator(".notification-container", has_text="No folded checkboxes").count() == 1


def test_folds_not_saved_leave_documents_that_arent_open(app):
	# Settings > Save folding state > Document off: folding only changes what is shown
	app.evaluate("localStorage.setItem(saveDocumentFoldsKey, '0')")
	app.evaluate("""() => localStorage.setItem("__doc__other", localStorage.getItem("__doc__tasks").replace(/^<div[^>]*data-id[^>]*><\\/div>/, ""))""")
	before = app.evaluate("localStorage.getItem('__doc__other')")
	app.evaluate("refreshFileTree(true)")
	app.locator('#file-tree-list .tree-document[data-name="other"]').click(button="right")
	app.locator("#context-menu button", has_text="Fold all completed checkboxes").click()
	assert app.evaluate("localStorage.getItem('__doc__other')") == before
	assert app.locator(".notification-container", has_text="folds aren't saved with documents").count() == 1
	# the open one is folded, without unsaved changes
	tab_menu(app, "Fold all completed checkboxes")
	assert collapsed_in_editor(app) == ["done", "done too"]
	assert not app.evaluate("getActiveTab().dirty")
