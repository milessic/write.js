"""
Vi mode: ]m / [m go through the headings; j / k go through the wrapped lines, or through the lines of the text like Vim
with "Word-wrap navigation" off in Settings (gj / gk still through the wrapped ones).
"""
import pytest

pytest.importorskip("playwright")

from tests.e2e.test_vi_repeat import vi  # noqa: F401

# the text of the cursor's block and the cursor's offset in it
CARET_JS = """() => {
	const selection = getSelection();
	const block = selection.focusNode.parentElement.closest("#editor > *");
	const range = document.createRange();
	range.setStart(block, 0);
	range.setEnd(selection.focusNode, selection.focusOffset);
	return [block.textContent, range.toString().length];
}"""

HEADINGS = ("<h1>A</h1><div>a text</div><h2>A1</h2><div>a1 text</div><h2>A2</h2><div>a2 text</div>"
	"<h1>B</h1><div>b text</div><h2>B1</h2><div>b1 text</div>")

LONG = "word " * 200


def caret(vi):
	return vi.page.evaluate(CARET_JS)


@pytest.fixture
def no_wrap(vi):
	vi.page.evaluate("localStorage.setItem('__viWrapNavigation__', '0')")
	yield vi
	vi.page.evaluate("localStorage.removeItem('__viWrapNavigation__')")


def test_next_heading_of_the_same_level(vi):
	vi.load(html=HEADINGS)
	vi.keys("]", "m")
	assert caret(vi) == ["B", 0]
	vi.load(html=HEADINGS, at=(2, 0)).keys("]", "m")
	assert caret(vi) == ["A2", 0]


def test_next_heading_goes_to_the_higher_level_when_its_section_ends(vi):
	vi.load(html=HEADINGS, at=(4, 0)).keys("]", "m")
	assert caret(vi) == ["B", 0]


def test_next_heading_from_the_text_of_a_section(vi):
	vi.load(html=HEADINGS, at=(3, 2)).keys("]", "m")
	assert caret(vi) == ["A2", 0]
	vi.load(html=HEADINGS, at=(1, 2)).keys("]", "m")
	assert caret(vi) == ["B", 0]


def test_next_heading_with_a_count(vi):
	vi.load(html=HEADINGS, at=(2, 0)).keys("2", "]", "m")
	assert caret(vi) == ["B", 0]


def test_previous_heading_goes_to_the_section_start_first(vi):
	vi.load(html=HEADINGS, at=(5, 3)).keys("[", "m")
	assert caret(vi) == ["A2", 0]
	vi.keys("[", "m")
	assert caret(vi) == ["A1", 0]
	vi.keys("[", "m")
	assert caret(vi) == ["A", 0]


def test_previous_heading_of_the_same_level(vi):
	vi.load(html=HEADINGS, at=(6, 0)).keys("[", "m")
	assert caret(vi) == ["A", 0]


def test_no_heading_further_stays(vi):
	vi.load(html=HEADINGS, at=(9, 2)).keys("]", "m")
	assert caret(vi) == ["b1 text", 2]


def test_delete_to_the_next_heading(vi):
	vi.load(html=HEADINGS, at=(2, 0)).keys("d", "]", "m")
	assert vi.lines[:4] == ["A", "a text", "A2", "a2 text"]


def test_j_follows_the_wrapped_lines(vi):
	vi.load([LONG, "next"]).keys("j")
	text, offset = caret(vi)
	assert text == LONG and offset > 0


def test_j_goes_through_the_lines_of_the_text(no_wrap):
	no_wrap.load([LONG, "next"]).keys("j")
	assert caret(no_wrap) == ["next", 0]


def test_j_and_k_keep_the_column(no_wrap):
	no_wrap.load(["abcdef", "ab", "abcdef"], at=(0, 4)).keys("j")
	assert caret(no_wrap) == ["ab", 1]
	no_wrap.keys("j")
	assert caret(no_wrap) == ["abcdef", 4]
	no_wrap.keys("k", "k")
	assert caret(no_wrap) == ["abcdef", 4]


def test_gj_follows_the_wrapped_lines_without_wrap_navigation(no_wrap):
	no_wrap.load([LONG, "next"]).keys("g", "j")
	text, offset = caret(no_wrap)
	assert text == LONG and offset > 0


def test_j_skips_a_folded_section(no_wrap):
	no_wrap.load(html="<h2>A</h2><div>hidden</div><h2>B</h2>").keys(" ", "j")
	assert caret(no_wrap) == ["B", 0]
	no_wrap.keys("g", "g", " ")


# the top of the first X in the editor and of the start of its block's text, in pixels
X_TOP_JS = """() => {
	const editor = document.getElementById("editor");
	const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
	while ( walker.nextNode() ) {
		const at = walker.currentNode.data.indexOf("X");
		if ( at === -1 ) { continue }
		const range = document.createRange();
		range.setStart(walker.currentNode, at);
		range.setEnd(walker.currentNode, at + 1);
		const first = document.createRange();
		first.setStart(walker.currentNode, 0);
		first.setEnd(walker.currentNode, 1);
		return [range.getBoundingClientRect().top, first.getBoundingClientRect().top];
	}
}"""


def test_a_appends_at_the_end_of_the_wrapped_line(vi):
	vi.load([LONG, "next"]).keys("j", "A").type("X").keys("Escape")
	text = vi.lines[0]
	at = text.index("X")
	assert text[:at].endswith("word") and text[at + 1] == " "
	x_top, line_top = vi.page.evaluate(X_TOP_JS)
	assert x_top > line_top   # on the second wrapped line, not the first
	vi.load([LONG, "next"]).keys("A").type("X").keys("Escape")
	x_top, line_top = vi.page.evaluate(X_TOP_JS)
	assert x_top == line_top and vi.lines[0].index("X") < len(LONG) - 1


def test_i_inserts_at_the_start_of_the_wrapped_line(vi):
	vi.load([LONG, "next"]).keys("j", "l", "l", "I").type("X").keys("Escape")
	text = vi.lines[0]
	at = text.index("X")
	assert at > 0 and text[at - 1] == " " and text[at + 1:].startswith("word")
	vi.load(["  " + LONG, "next"], at=(0, 5)).keys("I").type("X").keys("Escape")
	assert vi.lines[0].startswith("  Xword")


def test_i_and_a_use_the_lines_of_the_text_without_wrap_navigation(no_wrap):
	no_wrap.load([LONG, "next"]).keys("g", "j", "A").type("X").keys("Escape")
	assert no_wrap.lines[0] == LONG + "X"
	no_wrap.load([LONG, "next"]).keys("g", "j", "I").type("X").keys("Escape")
	assert no_wrap.lines[0] == "X" + LONG
