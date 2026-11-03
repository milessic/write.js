"""
Vi mode: dc deletes the list item of the cursor's line together with its nested items, in bulleted, numbered and
checklists, whether the nested list is inside the item or right after it.
"""
import pytest

pytest.importorskip("playwright")

from tests.e2e.test_vi_repeat import vi  # noqa: F401
from tests.e2e.test_vi_delete_nested_checklist import NESTED, SIBLINGS
from tests.e2e.test_vi_yank_checklist import items


def test_dc_on_a_checklist_item_with_nested_items(vi):
	vi.load(html=NESTED, at=(2, 0)).keys("d", "c")
	assert items(vi) == [["agenda", 0, "false"], ["uat", 1, "true"], ["text"]]


def test_dc_on_an_item_without_nested_items(vi):
	vi.load(html=NESTED, at=(1, 2)).keys("d", "c")
	assert items(vi) == [["agenda", 0, "false"], ["automation", 1, "false"], ["test case", 2, "true"],
		["generate", 2, "false"], ["calendar", 3, "true"], ["fix minutes", 3, "false"], ["text"]]


def test_dc_on_the_top_item_takes_the_whole_list(vi):
	vi.load(html=NESTED).keys("d", "c")
	assert vi.lines == ["text"]


def test_dc_with_a_nested_sibling_list(vi):
	vi.load(html=SIBLINGS).keys("d", "c")
	assert items(vi) == [["next", 0, "false"], ["text"]]


def test_dc_in_a_bulleted_list(vi):
	vi.load(html="<div>a</div><ul><li>one<ul><li>one.one</li><li>one.two</li></ul></li><li>two</li></ul><div>b</div>", at=(1, 0)).keys("d", "c")
	assert vi.lines == ["a", "two", "b"]


def test_dc_in_a_numbered_list(vi):
	vi.load(html="<div>a</div><ol><li>one</li><li>two</li><ol><li>two.one</li></ol><li>three</li></ol>", at=(2, 0)).keys("d", "c")
	assert vi.lines == ["a", "one", "three"]


def test_dc_can_be_pasted_and_repeated(vi):
	vi.load(html="<ul><li>one</li><ul><li>one.one</li></ul><li>two</li><ul><li>two.one</li></ul><li>three</li></ul>").keys("d", "c")
	assert vi.lines == ["two", "two.one", "three"]
	vi.keys(".")
	assert vi.lines == ["three"]
	vi.keys("p")
	assert vi.lines == ["three", "two", "two.one"]


def test_dc_outside_a_list_leaves_the_line(vi):
	vi.load(["plain", "text"]).keys("d", "c")
	assert vi.lines == ["plain", "text"]
	assert "dc" in vi.page.text_content(".vi-message")


def test_dc_is_undone_by_u(vi):
	vi.load(html="<ul><li>one</li><ul><li>one.one</li></ul><li>two</li></ul><div>b</div>").keys("d", "c")
	assert vi.lines == ["two", "b"]
	vi.keys("u")
	assert vi.lines == ["one", "one.one", "two", "b"]
	vi.keys("Control+r")
	assert vi.lines == ["two", "b"]
