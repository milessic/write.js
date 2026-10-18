"""
Vi mode: a horizontal rule isn't a line. o / O open the new line on the cursor's side of a rule,
and j / k step over it.
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


def test_j_steps_over_a_rule(vi):
	vi.load(html=HTML).keys("j", "i").type("X").keys("Escape")
	assert blocks(vi) == ["heading", "hr", "Xtext"]


def test_k_steps_over_a_rule(vi):
	vi.load(html=HTML).keys("G", "k", "i").type("X").keys("Escape")
	assert blocks(vi) == ["Xheading", "hr", "text"]
