"""
Vi mode: deleting in a nested checklist takes only what it should: dd only its line (the next sibling item stays),
d$ only the item's text (the checkbox stays). They failed in WebKit (Safari) only, with the items position: relative.
"""
import pytest

pytest.importorskip("playwright")

from tests.e2e.test_vi_repeat import vi  # noqa: F401
from tests.e2e.test_vi_yank_checklist import items

NESTED = ('<ul><li data-checked="false">agenda<ul>'
	'<li data-checked="true">uat</li>'
	'<li data-checked="false">automation<ul>'
	'<li data-checked="true">test case</li>'
	'<li data-checked="false">generate<ul>'
	'<li data-checked="true">calendar</li>'
	'<li data-checked="false">fix minutes</li>'
	'</ul></li></ul></li></ul></li></ul><div>text</div>')


def test_dd_on_a_nested_item_keeps_its_next_sibling(vi):
	vi.load(html=NESTED, at=(5, 0)).keys("d", "d")
	assert items(vi) == [["agenda", 0, "false"], ["uat", 1, "true"], ["automation", 1, "false"],
		["test case", 2, "true"], ["generate", 2, "false"], ["fix minutes", 3, "false"], ["text"]]


def test_dd_on_the_last_nested_item(vi):
	vi.load(html=NESTED, at=(6, 0)).keys("d", "d")
	assert items(vi) == [["agenda", 0, "false"], ["uat", 1, "true"], ["automation", 1, "false"],
		["test case", 2, "true"], ["generate", 2, "false"], ["calendar", 3, "true"], ["text"]]


def test_d_dollar_keeps_the_checkbox(vi):
	vi.load(html=NESTED, at=(5, 0)).keys("d", "$")
	assert items(vi) == [["agenda", 0, "false"], ["uat", 1, "true"], ["automation", 1, "false"],
		["test case", 2, "true"], ["generate", 2, "false"], ["", 3, "true"], [""], ["fix minutes", 3, "false"], ["text"]]


def test_d_dollar_on_a_top_item_keeps_the_checkbox(vi):
	vi.load(html='<ul><li data-checked="false">one</li><li data-checked="true">two</li></ul>', at=(1, 0)).keys("d", "$")
	assert vi.page.evaluate("document.getElementById('editor').innerHTML") == (
		'<ul><li data-checked="false">one</li><li data-checked="true"><br></li></ul>')



# as typed or imported: a nested list is the sibling of its parent item
SIBLINGS = ('<ul><li data-checked="false">generate</li><ul>'
	'<li data-checked="true">calendar</li>'
	'<li data-checked="false">fix minutes</li>'
	'</ul><li data-checked="false">next</li></ul><div>text</div>')


def test_dd_on_a_nested_sibling_list_item(vi):
	vi.load(html=SIBLINGS, at=(1, 0)).keys("d", "d")
	assert items(vi) == [["generate", 0, "false"], ["fix minutes", 1, "false"], ["next", 0, "false"], ["text"]]
