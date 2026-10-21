"""
Table of contents (toc.js): Settings > Table of contents can list the top-level checklist items too, as headings of a
level under all the others, each under the heading of its section.
"""
import pytest

pytest.importorskip("playwright")

from tests.e2e.test_vi_repeat import vi  # noqa: F401

DOC = ('<h1>Plan</h1><ul><li data-checked="false">before</li></ul><h2>Week</h2>'
	+ '<ul><li data-checked="true">done</li><ul><li data-checked="false">nested</li></ul><li data-checked="false">todo</li></ul>'
	+ '<ul><li>bullet</li></ul>')

ROWS_JS = """() => [...document.querySelector('#toc-panel .toc-list').querySelectorAll('.toc-row')]
	.map((r) => [r.querySelector('.tree-label').textContent, r.dataset.level, r.style.getPropertyValue('--depth'), r.classList.contains('checked')])"""


@pytest.fixture
def toc(vi):
	vi.load(html=DOC)
	vi.page.evaluate("openTableOfContents()")
	yield vi
	vi.page.evaluate("""() => {
		localStorage.removeItem("__tocHeadings__");
		Object.assign(layout, {tocSide: "right", tocHidden: true, treeTab: "documents", treeHidden: false});
		saveLayout();
	}""")


def rows(vi):
	vi.page.wait_for_timeout(50)
	return vi.page.evaluate(ROWS_JS)


def test_off_by_default(toc):
	assert [r[0] for r in rows(toc)] == ["Plan", "Week"]


def test_top_level_items_under_their_heading(toc):
	toc.page.evaluate("""() => { localStorage.setItem("__tocHeadings__", "[1, 2, 3, 4, 10]"); renderToc() }""")
	assert rows(toc) == [
		["Plan", "1", "0", False],
		["before", "10", "1", False],
		["Week", "2", "1", False],
		["done", "10", "2", True],
		["todo", "10", "2", False],
	]


def test_follows_checking(toc):
	toc.page.evaluate("""() => { localStorage.setItem("__tocHeadings__", "[10]"); renderToc() }""")
	assert [r[0] for r in rows(toc)] == ["before", "done", "todo"]
	toc.page.evaluate("""() => { document.querySelectorAll('#editor li[data-checked]')[3].dataset.checked = "true" }""")
	assert [r[3] for r in rows(toc)] == [False, True, True]


def test_click_goes_to_the_item(toc):
	toc.page.evaluate("""() => { localStorage.setItem("__tocHeadings__", "[1, 2, 10]"); renderToc() }""")
	rows(toc)
	toc.page.click("#toc-panel .toc-row[data-level='10'] >> text=todo")
	assert toc.page.evaluate("getSelection().focusNode.textContent") == "todo"


def test_setting(toc):
	toc.page.evaluate("createSettingsModal()")
	toc.page.check("input[name='setting-toc-level'][value='10']")
	assert toc.page.evaluate("JSON.parse(localStorage.getItem('__tocHeadings__'))") == [1, 2, 3, 4, 10]
	toc.page.evaluate("closeAllModals()")
	assert "todo" in [r[0] for r in rows(toc)]
