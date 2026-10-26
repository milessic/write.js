"""
A double click on a tab while the documents tree is shown opens the folders the document is in and scrolls the tree to it
(workspace.js revealDocumentInTree).
"""
import pytest

pytest.importorskip("playwright")

# the folder of the fillers comes first in the tree, the document is far below them
FOLDERS = {"folders": ["aaa", "work", "work/deep"], "documents": {"plan": "work/deep", **{f"filler {i:02}": "aaa" for i in range(40)}}}


@pytest.fixture
def app(browser, server):
	context = browser.new_context(viewport={"width": 1400, "height": 500})
	page = context.new_page()
	page.errors = []
	page.on("pageerror", lambda e: page.errors.append(str(e)))
	page.goto(server)
	page.evaluate("""(folders) => {
		localStorage.clear();
		localStorage.setItem("__userConsent__", "1");
		localStorage.setItem("__autosave__", "0");
		for ( let i = 0; i < 40; i++ ) { localStorage.setItem("__doc__filler " + String(i).padStart(2, "0"), "<div>x</div>") }
		localStorage.setItem("__doc__plan", "<div>plan text</div>");
		localStorage.setItem("__folders__", JSON.stringify(folders));
		localStorage.setItem("__layout__", JSON.stringify({collapsedFolders: ["work", "work/deep"]}));
		localStorage.setItem("__lastOpened__", "plan");
	}""", FOLDERS)
	page.reload()
	page.wait_for_function("getActiveTab()?.name === 'plan'")
	yield page
	assert page.errors == []
	context.close()


def plan_row(page):
	return page.locator('#file-tree-list .tree-document[data-name="plan"]')


def test_double_click_opens_the_folders_and_scrolls_to_the_document(app):
	# the tab isn't the active one: its first click renders the tabs anew
	app.evaluate("loadDocumentFromLocalStorage('filler 00')")
	app.evaluate("document.getElementById('file-tree-list').scrollTop = 0")
	assert plan_row(app).count() == 0
	app.locator("#tabs .tab").filter(has_text="plan").dblclick()
	assert plan_row(app).count() == 1
	assert plan_row(app).is_visible()
	assert app.evaluate("""() => {
		const list = document.getElementById("file-tree").getBoundingClientRect();
		const row = document.querySelector('#file-tree-list .tree-document[data-name="plan"]').getBoundingClientRect();
		return row.top >= list.top && row.bottom <= list.bottom;
	}""")


def test_a_filter_hiding_it_is_cleared(app):
	app.fill("#file-tree-search", "filler")
	app.locator("#tabs .tab").filter(has_text="plan").dblclick()
	assert app.input_value("#file-tree-search") == ""
	assert plan_row(app).count() == 1


def test_nothing_happens_with_the_tree_hidden(app):
	app.click("#file-tree-hide")
	app.locator("#tabs .tab").filter(has_text="plan").dblclick()
	assert app.evaluate("layout.treeHidden")
	assert app.evaluate("layout.collapsedFolders") == ["work", "work/deep"]
