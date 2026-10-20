"""
Vi mode: a horizontal rule is a line of its own. j / k stop on it, dd deletes it, yy / p copy it, and o / O open the
new line on the cursor's side of it.
"""
import pytest

pytest.importorskip("playwright")

from tests.e2e.test_vi_repeat import vi  # noqa: F401

# the editor's children in order: "hr" for a rule, else the text of the block
BLOCKS_JS = """() => [...document.getElementById("editor").children].map(b => b.tagName === "HR" ? "hr" : b.textContent)"""

HTML = "<h2>heading</h2><hr><div>text</div>"


def blocks(vi):
	return vi.page.evaluate(BLOCKS_JS)


def test_O_under_a_rule_opens_between_the_rule_and_the_line(vi):
	vi.load(html=HTML).keys("G", "O").type("new").keys("Escape")
	assert blocks(vi) == ["heading", "hr", "new", "text"]


def test_o_over_a_rule_opens_between_the_line_and_the_rule(vi):
	vi.load(html=HTML).keys("o").type("new").keys("Escape")
	assert blocks(vi) == ["heading", "new", "hr", "text"]


def test_o_and_O_on_a_rule(vi):
	vi.load(html=HTML).keys("j", "o").type("below").keys("Escape")
	assert blocks(vi) == ["heading", "hr", "below", "text"]
	vi.load(html=HTML).keys("j", "O").type("above").keys("Escape")
	assert blocks(vi) == ["heading", "above", "hr", "text"]


def test_j_and_k_stop_on_a_rule(vi):
	vi.load(html=HTML).keys("j", "j", "i").type("X").keys("Escape")
	assert blocks(vi) == ["heading", "hr", "Xtext"]
	vi.load(html=HTML).keys("G", "k", "k", "i").type("X").keys("Escape")
	assert blocks(vi) == ["Xheading", "hr", "text"]


def test_dd_deletes_a_rule(vi):
	vi.load(html=HTML).keys("j", "d", "d")
	assert blocks(vi) == ["heading", "text"]
	vi.load(html=HTML).keys("G", "k", "d", "d")
	assert blocks(vi) == ["heading", "text"]


def test_dd_deletes_a_rule_first_or_last(vi):
	vi.load(html="<hr><div>text</div>").keys("g", "g", "d", "d")
	assert blocks(vi) == ["text"]
	vi.load(html="<div>text</div><hr>").keys("G", "d", "d")
	assert blocks(vi) == ["text"]


def test_dd_next_to_a_rule_keeps_it(vi):
	vi.load(html=HTML).keys("G", "d", "d")
	assert blocks(vi) == ["heading", "hr"]
	vi.load(html=HTML).keys("g", "g", "d", "d")
	assert blocks(vi) == ["hr", "text"]


def test_dj_deletes_the_line_and_the_rule(vi):
	vi.load(html=HTML).keys("g", "g", "d", "j")
	assert blocks(vi) == ["text"]


def test_yy_p_copies_a_rule(vi):
	vi.load(html=HTML).keys("j", "y", "y", "p")
	assert blocks(vi) == ["heading", "hr", "hr", "text"]
	vi.load(html=HTML).keys("j", "d", "d", "G", "p")
	assert blocks(vi) == ["heading", "text", "hr"]


def test_cursor_is_drawn_on_a_rule(vi):
	vi.load(html=HTML).keys("j")
	rects = vi.page.evaluate("""() => {
		const cursor = document.querySelector(".vi-cursor")?.getBoundingClientRect();
		const hr = document.querySelector("#editor hr").getBoundingClientRect();
		return cursor && [cursor.top, hr.top, cursor.height, hr.height];
	}""")
	assert rects is not None
	assert rects[0] == pytest.approx(rects[1], abs=1)
	assert rects[2] == pytest.approx(rects[3], abs=1)


CHECKLIST = '<h2>heading</h2><hr><div><br></div><ul><li data-checked="false">checkbox</li><li data-checked="false">list</li></ul>'


def test_dd_and_J_on_the_empty_line_under_a_rule_keep_the_next_line(vi):
	# a delete next to a rule used to merge the empty line's <br> into the checklist item after it
	for keys in [("j", "j", "d", "d"), ("j", "j", "J")]:
		vi.load(html=CHECKLIST).keys(*keys)
		assert vi.page.evaluate("document.getElementById('editor').innerHTML") == \
			'<h2>heading</h2><hr><ul><li data-checked="false">checkbox</li><li data-checked="false">list</li></ul>'
	vi.load(html="<h2>heading</h2><hr><div><br></div><h3>next</h3>").keys("j", "j", "d", "d")
	assert vi.page.evaluate("document.getElementById('editor').innerHTML") == "<h2>heading</h2><hr><h3>next</h3>"


@pytest.mark.parametrize("keys", [("i", "Z"), ("a", "Z"), ("A", "Z"), ("I", "Z"), ("r", "Z"), ("s", "Z"), ("c", "c", "Z"), ("S", "Z"), ("C", "Z"), ("~",), ("J",)])
def test_a_rule_cant_be_edited(vi, keys):
	vi.load(html=HTML).keys("j", *keys, "Escape")
	assert blocks(vi) == ["heading", "hr", "text"]


@pytest.mark.parametrize("keys", [("x",), ("d", "w"), ("d", "e"), ("d", "$")])
def test_x_and_d_with_a_motion_delete_only_the_rule(vi, keys):
	vi.load(html=HTML).keys("j", *keys)
	assert vi.page.evaluate("document.getElementById('editor').innerHTML") == "<h2>heading</h2><div>text</div>"


def test_j_onto_a_rule_doesnt_scroll_to_the_top(vi):
	lines = "".join(f"<div>line {i}</div>" for i in range(80))
	vi.load(html=lines + "<hr><div>after</div>").keys("G", "k", "k")
	scroller = "document.getElementById('editor').closest('.pane-scroll').scrollTop"
	before = vi.page.evaluate(scroller)
	assert before > 0
	vi.keys("j")
	assert vi.page.evaluate(scroller) == pytest.approx(before, abs=50)
