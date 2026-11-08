"""
Folders hidden in search (workspace.js): a folder's right-click menu has "Hide in Search"; the documents of that folder and
of its sub-folders are left out of the document search tray (the v of the name field) and vi's :e.
"""
import pytest

pytest.importorskip("playwright")

FOLDERS = '{"folders": ["work", "work/projects", "home"], "documents": {"plan": "work/projects", "notes": "work", "list": "home"}}'


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
		for ( const name of ["plan", "notes", "list", "loose"] ) { localStorage.setItem("__doc__" + name, `<div>${name}</div>`) }
		localStorage.setItem("__folders__", folders);
		localStorage.setItem("__lastOpened__", "loose");
	}""", FOLDERS)
	page.reload()
	page.wait_for_function("getActiveTab()?.name === 'loose'")
	yield page
	assert page.errors == []
	context.close()


def folder_row(page, path):
	return page.locator(f'#file-tree-list li[data-folder="{path}"] > .tree-folder')


def menu_labels(page, path):
	folder_row(page, path).click(button="right")
	labels = page.locator("#context-menu button[role=menuitem]").all_text_contents()
	page.keyboard.press("Escape")
	return labels


def searched(page, query=""):
	page.click("#doc-search-btn")
	page.fill("#doc-search-input", query)
	names = page.locator("#doc-search-list .tree-document").all_text_contents()
	folders = page.evaluate("[...document.querySelectorAll('#doc-search-list li[data-folder]')].map(li => li.dataset.folder)")
	page.keyboard.press("Escape")
	page.mouse.click(700, 500)
	return sorted(names), folders


def hide(page, path):
	folder_row(page, path).click(button="right")
	page.locator("#context-menu button", has_text="Hide in Search").click()


def test_hidden_folder_and_its_subfolders_leave_the_search(app):
	assert searched(app, "")[0] == ["list", "loose", "notes", "plan"]
	hide(app, "work")
	names, folders = searched(app, "")
	assert names == ["list", "loose"]
	assert folders == ["home"]
	assert searched(app, "p")[0] == []
	assert searched(app, "l")[0] == ["list", "loose"]
	# the tree still has them
	assert app.locator("#file-tree-list .tree-document").count() == 4
	assert "hidden in search" in folder_row(app, "work/projects").get_attribute("title")


def test_menu_shows_it_and_takes_it_back(app):
	assert "Hide in Search" in menu_labels(app, "work")
	hide(app, "work")
	assert "Show in Search" in menu_labels(app, "work")
	assert "Hidden in Search (by its folder)" in menu_labels(app, "work/projects")
	folder_row(app, "work").click(button="right")
	app.locator("#context-menu button", has_text="Show in Search").click()
	assert searched(app, "")[0] == ["list", "loose", "notes", "plan"]


def test_it_follows_a_renamed_folder(app):
	hide(app, "work")
	app.evaluate("relocateFolder('work', 'job')")
	assert app.evaluate("readFolders().searchHidden") == {"job": True}
	assert searched(app, "")[0] == ["list", "loose"]


def test_vi_open_leaves_them_out(app):
	hide(app, "work")
	assert app.evaluate("isHiddenInSearch('plan') && isHiddenInSearch('notes') && !isHiddenInSearch('list') && !isHiddenInSearch('loose')")


def test_folder_metadata_controls_search_and_persists(app):
	folder_row(app, "work").click(button="right")
	app.locator("#context-menu button", has_text="Folder metadata").click()
	app.locator('.metadata-widget [data-meta="searchHidden"]').check()
	app.locator('.metadata-widget .metadata-save').click()
	assert searched(app, "")[0] == ["list", "loose"]
	app.reload()
	app.wait_for_function("typeof readFolders === 'function'")
	folder_row(app, "work/projects").click(button="right")
	app.locator("#context-menu button", has_text="Folder metadata").click()
	assert "parent folder" in app.locator('.metadata-widget').text_content()
	app.locator('.metadata-widget .metadata-cancel').click()
	folder_row(app, "work").click(button="right")
	app.locator("#context-menu button", has_text="Folder metadata").click()
	app.locator('.metadata-widget [data-meta="searchHidden"]').uncheck()
	app.locator('.metadata-widget .metadata-save').click()
	assert searched(app, "")[0] == ["list", "loose", "notes", "plan"]
