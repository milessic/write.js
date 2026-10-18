"""
Table of contents (toc.js): the headings of the focused document, on its own left or right of the editors or as a tab
next to the documents; a click scrolls the document to the heading. Settings pick the heading levels listed.
"""
import pytest

pytest.importorskip("playwright")

from tests.e2e.test_vi_repeat import vi  # noqa: F401

DOC = ("<h1>Notes</h1><div>intro</div>"
	+ "".join(f"<h2>Chapter {i}</h2>" + "<div>text</div>" * 15 + f"<h3>Part {i}.1</h3>" + "<div>more</div>" * 5 for i in range(1, 4)))

# the rows of the table of contents that is shown
ROWS_JS = """() => [...document.querySelectorAll(".toc-list")].filter((l) => l.offsetParent)
	.flatMap((l) => [...l.querySelectorAll(".toc-row")].map((r) => r.textContent))"""


@pytest.fixture
def toc(vi):
	vi.load(html=DOC)
	yield vi
	vi.page.evaluate("""() => {
		localStorage.removeItem("__tocHeadings__");
		Object.assign(layout, {tocSide: "right", tocHidden: true, treeTab: "documents", treeHidden: false});
		saveLayout();
	}""")
	vi.page.set_viewport_size({"width": 1400, "height": 900})


def rows(vi):
	vi.page.wait_for_timeout(50)
	return vi.page.evaluate(ROWS_JS)


def visible(vi, selector):
	return vi.page.evaluate(f"Boolean(document.querySelector('{selector}')?.offsetParent)")


def test_menu_opens_it_beside_the_editor(toc):
	toc.page.click("#hamburger-button")
	toc.page.click("#toc-btn")
	assert visible(toc, "#toc-panel")
	assert rows(toc) == ["Notes", "Chapter 1", "Part 1.1", "Chapter 2", "Part 2.1", "Chapter 3", "Part 3.1"]
	# the documents stay where they were
	assert visible(toc, "#file-tree-list")


def test_click_scrolls_to_the_heading_and_puts_the_caret_there(toc):
	toc.page.evaluate("openTableOfContents()")
	toc.page.click("#toc-panel .toc-row >> text=Chapter 3")
	# a smooth scroll: it gets there
	toc.page.wait_for_function("""() => {
		const heading = [...document.querySelectorAll("#editor h2")].find((h) => h.textContent === "Chapter 3");
		const offset = heading.getBoundingClientRect().top - heading.closest(".pane-scroll").getBoundingClientRect().top;
		return offset >= 0 && offset < 40;
	}""", timeout=3000)
	assert toc.page.evaluate("getSelection().anchorNode.parentElement.textContent") == "Chapter 3"
	assert toc.page.evaluate("document.querySelector('#toc-panel .toc-row.active').textContent") == "Chapter 3"


def test_it_can_be_closed(toc):
	toc.page.evaluate("openTableOfContents()")
	toc.page.click("#toc-hide")
	assert not visible(toc, "#toc-panel")


def test_settings_pick_the_heading_levels(toc):
	toc.page.evaluate("openTableOfContents()")
	toc.page.evaluate("createSettingsModal()")
	toc.page.uncheck('input[name="setting-toc-level"][value="3"]')
	toc.page.uncheck('input[name="setting-toc-level"][value="1"]')
	toc.page.evaluate("closeAllModals()")
	assert rows(toc) == ["Chapter 1", "Chapter 2", "Chapter 3"]


def test_follows_edits(toc):
	toc.page.evaluate("openTableOfContents()")
	toc.keys("g", "g", "c", "c").type("Renamed").keys("Escape")
	assert rows(toc)[0] == "Renamed"


def test_as_a_tab_next_to_the_documents(toc):
	toc.page.evaluate("openTableOfContents(); setTocSide('tree')")
	assert not visible(toc, "#toc-panel")
	assert visible(toc, "#toc-tab")
	assert not visible(toc, "#file-tree-list")
	assert rows(toc)[:2] == ["Notes", "Chapter 1"]
	toc.page.click("#documents-tab")
	assert visible(toc, "#file-tree-list")
	assert rows(toc) == []
	toc.page.click("#toc-tab")
	assert rows(toc)[:2] == ["Notes", "Chapter 1"]
	toc.page.click("#toc-tab-close")
	assert not visible(toc, "#toc-tab")
	assert visible(toc, "#file-tree-list")


def test_vi_command_opens_it_and_keys_go_to_a_heading(toc):
	toc.command("TableOfContents")
	assert toc.page.evaluate("document.activeElement.textContent") == "Notes"
	toc.keys("j", "j", "j", "Enter")
	toc.page.wait_for_timeout(100)
	assert toc.page.evaluate("document.activeElement.id") == "editor"
	assert toc.page.evaluate("getSelection().anchorNode.parentElement.textContent") == "Chapter 2"
	toc.keys("i").type("X").keys("Escape")
	assert rows(toc)[3] == "XChapter 2"


def test_escape_goes_back_to_the_editor(toc):
	toc.command("toc").keys("j", "Escape")
	assert toc.page.evaluate("document.activeElement.id") == "editor"


def test_tree_command_shows_the_documents(toc):
	toc.page.evaluate("setTocSide('tree')")
	toc.command("tree")
	assert visible(toc, "#file-tree-list")


def test_phones_show_it_in_the_drawer(toc):
	toc.page.set_viewport_size({"width": 500, "height": 800})
	toc.page.evaluate("openTableOfContents()")
	assert not visible(toc, "#toc-panel")
	assert rows(toc)[:1] == ["Notes"]
	toc.page.click(".file-tree .toc-row >> text=Chapter 2")
	toc.page.wait_for_timeout(100)
	assert not visible(toc, "#file-tree")
