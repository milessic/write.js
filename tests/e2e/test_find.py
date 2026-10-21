"""
Search in the document (search.js): Ctrl+F (Cmd+F on Apple devices) or the menu open a bar over the focused editor;
the matches are highlighted, Enter / Shift+Enter go through them, Esc puts the cursor on the current one.
"""
import pytest

pytest.importorskip("playwright")

from tests.e2e.test_vi_repeat import vi  # noqa: F401


@pytest.fixture
def find(vi):
	yield vi
	vi.page.evaluate("closeFind(false); document.getElementById('find-input').value = ''")


def count(vi):
	vi.page.wait_for_timeout(50)
	return vi.page.text_content("#find-count")


def test_ctrl_f_counts_the_matches(find):
	find.load(["apple pie", "banana", "Apple tart"])
	find.page.keyboard.press("Control+f")
	assert find.page.evaluate("document.activeElement.id") == "find-input"
	find.page.keyboard.type("apple")
	assert count(find) == "1/2"
	assert find.page.evaluate("CSS.highlights.get('find-match').size + CSS.highlights.get('find-current').size") == 2


def test_enter_goes_through_the_matches(find):
	find.load(["one x", "two x", "three x"])
	find.page.keyboard.press("Control+f")
	find.page.keyboard.type("x")
	assert count(find) == "1/3"
	find.page.keyboard.press("Enter")
	assert count(find) == "2/3"
	find.page.keyboard.press("Shift+Enter")
	find.page.keyboard.press("Shift+Enter")
	assert count(find) == "3/3"


def test_match_case(find):
	find.load(["Word word WORD"])
	find.page.keyboard.press("Control+f")
	find.page.keyboard.type("word")
	assert count(find) == "1/3"
	find.page.click("#find-case")
	assert count(find) == "1/1"
	find.page.click("#find-case")


def test_no_match_across_lines(find):
	find.load(["ab", "cd"])
	find.page.keyboard.press("Control+f")
	find.page.keyboard.type("bc")
	assert count(find) == "No results"


def test_escape_puts_the_cursor_on_the_match(find):
	find.load(["first", "second target", "third"])
	find.page.keyboard.press("Control+f")
	find.page.keyboard.type("target")
	find.page.keyboard.press("Escape")
	assert find.page.is_hidden("#find-bar")
	assert find.page.evaluate("document.activeElement.id") == "editor"
	assert find.mode == "normal"
	# vi: the cursor on the match's start
	find.keys("x")
	assert find.lines == ["first", "second arget", "third"]


def test_matches_follow_edits(find):
	find.load(["x"])
	find.page.keyboard.press("Control+f")
	find.page.keyboard.type("x")
	assert count(find) == "1/1"
	find.page.evaluate("document.getElementById('editor').insertAdjacentHTML('beforeend', '<div>x x</div>')")
	assert count(find) == "1/3"


def test_from_the_menu(find):
	find.load(["menu"])
	find.page.evaluate("document.getElementById('find-btn').click()")
	assert find.page.is_visible("#find-bar")
