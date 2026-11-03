"""
Vi mode: scrolled out of sight (the wheel, the scrollbar), the cursor goes to the top / bottom line in sight, like Vim;
G and gg scroll to the very end / start of the document.
"""
import pytest

pytest.importorskip("playwright")

from tests.e2e.test_vi_repeat import vi  # noqa: F401

LINES = [f"line {n}" for n in range(200)]

LINE_JS = """() => {
	const selection = getSelection();
	return selection.focusNode.parentElement.closest("#editor > *").textContent;
}"""

# the first / last line in sight
SHOWN_JS = """(last) => {
	const scroller = document.querySelector(".editor-pane.focused .pane-scroll");
	const box = scroller.getBoundingClientRect();
	const top = box.top + (parseFloat(getComputedStyle(scroller).scrollPaddingTop) || 0);
	const shown = [...document.getElementById("editor").children].filter(el => {
		const r = el.getBoundingClientRect();
		return r.top >= top - 1 && r.bottom <= box.bottom + 1;
	});
	return (last ? shown.at(-1) : shown[0]).textContent;
}"""


def line(vi):
	return vi.page.evaluate(LINE_JS)


def scroll(vi, top):
	# as the wheel does: a wheel event, then the scroll
	vi.page.evaluate("""(top) => {
		const scroller = document.querySelector('.editor-pane.focused .pane-scroll');
		scroller.dispatchEvent(new WheelEvent("wheel", {bubbles: true, deltaY: top - scroller.scrollTop}));
		scroller.scrollTop = top;
	}""", top)
	vi.page.wait_for_timeout(100)


def scroll_top(vi):
	return vi.page.evaluate("document.querySelector('.editor-pane.focused .pane-scroll').scrollTop")


def test_scrolling_down_takes_the_cursor(vi):
	vi.load(LINES)
	scroll(vi, 2000)
	assert line(vi) == vi.page.evaluate(SHOWN_JS, False)


def test_scrolling_up_takes_the_cursor(vi):
	vi.load(LINES).keys("G")
	scroll(vi, 1000)
	assert line(vi) == vi.page.evaluate(SHOWN_JS, True)


def test_scrolling_with_the_cursor_in_sight_leaves_it(vi):
	vi.load(LINES, at=(10, 2))
	scroll(vi, 20)
	assert line(vi) == "line 10"


def test_insert_mode_is_left_alone(vi):
	vi.load(LINES).keys("i")
	scroll(vi, 2000)
	assert line(vi) == "line 0"
	vi.keys("Escape")


def test_scrolls_of_the_app_leave_the_cursor(vi):
	# not the user's (a heading of the table of contents, a search match): the cursor is where the app put it
	vi.load(LINES)
	vi.page.wait_for_timeout(700)
	vi.page.evaluate("document.querySelector('.editor-pane.focused .pane-scroll').scrollTop = 2000")
	vi.page.wait_for_timeout(100)
	assert line(vi) == "line 0"


def test_mouse_wheel(vi):
	vi.load(LINES)
	box = vi.page.locator(".editor-pane.focused .pane-scroll").bounding_box()
	vi.page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
	vi.page.mouse.wheel(0, 1500)
	vi.page.wait_for_timeout(300)
	assert line(vi) == vi.page.evaluate(SHOWN_JS, False)


def test_G_scrolls_to_the_bottom(vi):
	vi.load(LINES + [""] * 0).keys("G")
	vi.page.wait_for_timeout(50)
	assert vi.page.evaluate("""() => {
		const s = document.querySelector('.editor-pane.focused .pane-scroll');
		return s.scrollHeight - s.clientHeight - s.scrollTop;
	}""") <= 1
	assert line(vi) == "line 199"
	vi.keys("g", "g")
	vi.page.wait_for_timeout(50)
	assert scroll_top(vi) == 0
	assert line(vi) == "line 0"
