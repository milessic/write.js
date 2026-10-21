"""
Line numbers (linenumbers.js): a click on a number selects its line, Shift+click or a drag the lines in between;
in vi mode that is V-LINE.
"""
import pytest

pytest.importorskip("playwright")

from tests.e2e.test_vi_repeat import vi  # noqa: F401
from tests.e2e.test_line_numbers import numbered  # noqa: F401


def number(vi, n):
	return f".editor-pane.focused .line-numbers > span:nth-child({n})"


def test_click_selects_the_line_in_v_line(numbered):
	numbered.load(["one", "two", "three"])
	numbered.page.wait_for_timeout(50)
	numbered.page.click(number(numbered, 2))
	assert numbered.mode == "vline"
	numbered.keys("d")
	assert numbered.lines == ["one", "three"]


def test_shift_click_selects_the_lines_between(numbered):
	numbered.load(["one", "two", "three", "four"])
	numbered.page.wait_for_timeout(50)
	numbered.page.click(number(numbered, 2))
	numbered.page.click(number(numbered, 3), modifiers=["Shift"])
	numbered.keys("d")
	assert numbered.lines == ["one", "four"]


def test_drag_selects_the_lines(numbered):
	numbered.load(["one", "two", "three", "four"])
	numbered.page.wait_for_timeout(50)
	start = numbered.page.locator(number(numbered, 1)).bounding_box()
	end = numbered.page.locator(number(numbered, 3)).bounding_box()
	numbered.page.mouse.move(start["x"] + 2, start["y"] + 2)
	numbered.page.mouse.down()
	numbered.page.mouse.move(end["x"] + 2, end["y"] + 2, steps=5)
	numbered.page.mouse.up()
	numbered.keys("d")
	assert numbered.lines == ["four"]


def test_without_vi_it_is_the_selection(numbered):
	numbered.load(["one", "two", "three"])
	numbered.page.evaluate("WriteVi.disable()")
	try:
		numbered.page.wait_for_timeout(50)
		numbered.page.click(number(numbered, 2))
		assert numbered.page.evaluate("getSelection().toString()") == "two\n"
	finally:
		numbered.page.evaluate("WriteVi.enable()")
