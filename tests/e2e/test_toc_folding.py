"""
Folding in the table of contents (toc.js): an entry with entries under it has an arrow that collapses or expands them in
the list only; the document's heading folds (folding.js) are independent of it. Left / right do it from the keys.
"""
import pytest

pytest.importorskip("playwright")

from tests.e2e.test_toc import toc, rows  # noqa: F401
from tests.e2e.test_vi_repeat import vi  # noqa: F401

ALL = ["Notes", "Chapter 1", "Part 1.1", "Chapter 2", "Part 2.1", "Chapter 3", "Part 3.1"]
SHOWN_JS = """() => [...document.querySelectorAll("#toc-panel .toc-row")].filter((r) => !r.parentElement.hidden).map((r) => r.textContent)"""
COLLAPSED_JS = "[...document.querySelectorAll('#editor [data-collapsed]')].length"


@pytest.fixture
def opened(toc):
	toc.page.evaluate("openTableOfContents()")
	toc.page.wait_for_function(f"({SHOWN_JS})().length === 7")
	return toc


def shown(vi, length=None):
	if length is not None:
		vi.page.wait_for_function(f"({SHOWN_JS})().length === {length}")
	return vi.page.evaluate(SHOWN_JS)


def arrow(vi, text):
	return vi.page.locator("#toc-panel .toc-row", has_text=text).locator(".toc-fold")


def test_arrow_collapses_the_entries_in_the_list_only(opened):
	arrow(opened, "Chapter 2").click()
	assert shown(opened, 6) == ["Notes", "Chapter 1", "Part 1.1", "Chapter 2", "Chapter 3", "Part 3.1"]
	assert opened.page.locator("#toc-panel .toc-row", has_text="Chapter 2").get_attribute("aria-expanded") == "false"
	# the document isn't folded
	assert opened.page.evaluate(COLLAPSED_JS) == 0
	# the arrow doesn't go to the heading: the focus stays in the list
	assert opened.page.evaluate("document.activeElement.textContent") == "Chapter 2"
	arrow(opened, "Notes").click()
	assert shown(opened, 1) == ["Notes"]
	assert opened.page.evaluate(COLLAPSED_JS) == 0
	arrow(opened, "Notes").click()
	arrow(opened, "Chapter 2").click()
	assert shown(opened, 7) == ALL


def test_only_entries_with_entries_under_them_have_an_arrow(opened):
	expandable = opened.page.evaluate("[...document.querySelectorAll('#toc-panel .toc-row[aria-expanded]')].map((r) => r.textContent)")
	assert expandable == ["Notes", "Chapter 1", "Chapter 2", "Chapter 3"]


def test_document_folds_dont_fold_the_list(opened):
	opened.page.evaluate("toggleHeadingFold(document.querySelector('#editor > h1'))")
	opened.page.wait_for_function("document.querySelectorAll('#toc-panel .toc-row.folded').length === 6")
	assert shown(opened) == ALL
	assert opened.page.locator("#toc-panel .toc-row", has_text="Notes").get_attribute("aria-expanded") == "true"
	opened.page.evaluate("toggleHeadingFold(document.querySelector('#editor > h1'))")


def test_keys_collapse_and_expand(opened):
	opened.page.locator("#toc-panel .toc-row", has_text="Chapter 1").focus()
	opened.page.keyboard.press("ArrowLeft")
	assert shown(opened, 6) == ["Notes", "Chapter 1", "Chapter 2", "Part 2.1", "Chapter 3", "Part 3.1"]
	assert opened.page.evaluate(COLLAPSED_JS) == 0
	# the hidden rows are skipped
	opened.page.keyboard.press("ArrowDown")
	assert opened.page.evaluate("document.activeElement.textContent") == "Chapter 2"
	opened.page.keyboard.press("ArrowUp")
	opened.page.keyboard.press("ArrowRight")
	assert shown(opened, 7) == ALL


def test_arrows_without_heading_folding_too(opened):
	opened.page.evaluate("localStorage.setItem(headingFoldingKey, '0'); applyFoldingSettings()")
	try:
		arrow(opened, "Chapter 3").click()
		assert shown(opened, 6)[-1] == "Chapter 3"
	finally:
		opened.page.evaluate("localStorage.removeItem(headingFoldingKey); applyFoldingSettings()")
