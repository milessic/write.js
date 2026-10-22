"""
Folder colors (workspace.js): a folder's right-click menu picks one of 10 pastel colors or "No color"; the color tints
the folder, its sub-folders without a color of their own and the tabs of the documents in them.
"""
import re

import pytest

pytest.importorskip("playwright")

FOLDERS = '{"folders": ["work", "work/projects", "work/archive", "home"], "documents": {"plan": "work/projects", "list": "home"}}'


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
		localStorage.setItem("__doc__plan", "<div>plan</div>");
		localStorage.setItem("__doc__list", "<div>list</div>");
		localStorage.setItem("__folders__", folders);
		localStorage.setItem("__lastOpened__", "plan");
	}""", FOLDERS)
	page.reload()
	page.wait_for_function("getActiveTab()?.name === 'plan'")
	page.evaluate("openDocumentFromTree('list')")
	yield page
	assert page.errors == []
	context.close()


def folder(page, path):
	return page.locator(f'#file-tree-list li[data-folder="{path}"]')


def tab(page, name):
	return page.locator("#tabs .tab").filter(has_text=name)


def bg(locator):
	return locator.evaluate("el => getComputedStyle(el).backgroundColor")


def pick_color(page, path, label):
	folder(page, path).locator(":scope > .tree-folder").click(button="right")
	page.locator(f'#context-menu .menu-swatch[aria-label="{label}"]').click()


def test_menu_offers_ten_colors_and_no_color(app):
	folder(app, "work").locator(":scope > .tree-folder").click(button="right")
	swatches = app.locator("#context-menu .menu-swatch")
	assert swatches.count() == 11
	assert swatches.first.get_attribute("aria-label") == "No color"
	assert swatches.first.get_attribute("aria-checked") == "true"


def test_color_tints_folder_subfolders_and_tabs(app):
	plain = bg(folder(app, "work"))
	pick_color(app, "work", "Mint")
	assert app.evaluate("readFolders().colors") == {"work": "mint"}
	tinted = bg(folder(app, "work"))
	assert tinted != plain
	# sub-folders without a color show the parent's tint through, and the document's tab gets it too
	assert "colored" not in (folder(app, "work/projects").get_attribute("class") or "")
	assert "colored" in tab(app, "plan").get_attribute("class")
	assert tab(app, "plan").evaluate("el => el.style.getPropertyValue('--folder-color')") == "#c3ead4"
	assert "striped" not in tab(app, "plan").get_attribute("class")
	assert "colored" not in (tab(app, "list").get_attribute("class") or "")

	# a sub-folder's own color wins, for it and its documents
	pick_color(app, "work/projects", "Rose")
	assert "colored" in folder(app, "work/projects").get_attribute("class")
	assert bg(folder(app, "work/projects")) != tinted
	assert tab(app, "plan").evaluate("el => el.style.getPropertyValue('--folder-color')") == "#f6c6cc"

	# colored inside a folder of another color: striped with both, in the tree and on the tab
	assert "striped" in folder(app, "work/projects").get_attribute("class")
	assert "striped" in tab(app, "plan").get_attribute("class")
	assert stripe_colors(tab(app, "plan")) == ["#c3ead4", "#f6c6cc"]
	assert "gradient" in folder(app, "work/projects").evaluate("el => getComputedStyle(el).backgroundImage")

	# "No color" falls back to the parent's color
	pick_color(app, "work/projects", "No color")
	assert app.evaluate("readFolders().colors") == {"work": "mint"}
	assert tab(app, "plan").evaluate("el => el.style.getPropertyValue('--folder-color')") == "#c3ead4"


def test_color_follows_rename_and_goes_with_delete(app):
	app.evaluate("setFolderColor('work/archive', 'sky'); relocateFolder('work', 'job')")
	assert app.evaluate("readFolders().colors") == {"job/archive": "sky"}
	app.evaluate("window.confirm = () => true; showConfirm = () => true; deleteFolder('job')")
	assert app.evaluate("readFolders().colors") == {}


def test_colors_merge_from_cloud(app):
	app.evaluate("""mergeFolders(JSON.stringify({folders: ["home"], documents: {}, colors: {home: "butter"}}))""")
	assert app.evaluate("readFolders().colors") == {"home": "butter"}
	assert "colored" in tab(app, "list").get_attribute("class")


def stripe_colors(locator):
	# the pastel of each stripe, in order
	stripes = locator.evaluate("el => el.style.getPropertyValue('--folder-stripes')")
	return re.findall(r"light-dark\(color-mix\(in srgb, (#[0-9a-f]{6})", stripes)


def test_stripes_reach_subfolders(app):
	app.evaluate("setFolderColor('work', 'mint'); setFolderColor('work/projects', 'sky')")
	app.evaluate("relocateFolder('work/archive', 'work/projects/archive')")
	app.evaluate("moveDocumentsToFolder(['plan'], 'work/projects/archive')")
	# a sub-folder without a color shows its parent's stripes, its documents' tabs are striped too
	assert "colored" not in (folder(app, "work/projects/archive").get_attribute("class") or "")
	assert "striped" in tab(app, "plan").get_attribute("class")
	assert stripe_colors(tab(app, "plan")) == ["#c3ead4", "#c6dcf4"]


def test_stripes_have_every_color_of_the_chain(app):
	# red > green > blue: all three, outermost first; a repeated color stays a stripe of its own
	app.evaluate("relocateFolder('work/archive', 'work/projects/archive')")
	app.evaluate("setFolderColor('work', 'rose'); setFolderColor('work/projects', 'lime'); setFolderColor('work/projects/archive', 'sky')")
	assert stripe_colors(folder(app, "work/projects/archive")) == ["#f6c6cc", "#ddeeb8", "#c6dcf4"]
	app.evaluate("setFolderColor('work/projects/archive', 'rose')")
	assert stripe_colors(folder(app, "work/projects/archive")) == ["#f6c6cc", "#ddeeb8", "#f6c6cc"]
	app.evaluate("setFolderColor('work/projects', 'rose')")
	assert "striped" in folder(app, "work/projects").get_attribute("class")
	assert stripe_colors(folder(app, "work/projects")) == ["#f6c6cc", "#f6c6cc"]
	# a folder in between without a color adds no stripe
	app.evaluate("setFolderColor('work/projects', null)")
	assert stripe_colors(folder(app, "work/projects/archive")) == ["#f6c6cc", "#f6c6cc"]


def test_search_matches_have_their_folders_colors(app):
	pick_color(app, "work", "Mint")
	pick_color(app, "work/projects", "Rose")
	app.fill("#file-tree-search", "pl")
	match = app.locator("#file-tree-list li").filter(has=app.locator('.tree-document[data-name="plan"]'))
	assert "colored" in match.get_attribute("class")
	assert "striped" in match.get_attribute("class")
	assert "gradient" in match.evaluate("el => getComputedStyle(el).backgroundImage")
	app.fill("#file-tree-search", "li")
	plain = app.locator("#file-tree-list li").filter(has=app.locator('.tree-document[data-name="list"]'))
	assert "colored" not in (plain.get_attribute("class") or "")
	app.fill("#file-tree-search", "")
	pick_color(app, "home", "Sky")
	app.fill("#file-tree-search", "li")
	assert bg(plain) != "rgba(0, 0, 0, 0)"
