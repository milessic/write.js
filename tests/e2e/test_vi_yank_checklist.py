"""
Vi mode: yanked (or deleted) whole lines of a checklist paste back as checklist items, with their state and level.
"""
import pytest

pytest.importorskip("playwright")

from tests.e2e.test_vi_repeat import vi  # noqa: F401

# every line of the editor: [text, nesting level, state] for a list item ("true" / "false", None for a bullet),
# [text] for any other block
ITEMS_JS = """() => {
	const editor = document.getElementById("editor");
	const lines = [];
	const walk = (parent) => {
		for ( const el of parent.children ) {
			// a list can be in a line's <div> (insertUnorderedList)
			if ( el.matches("ul, ol") || el.matches("div:has(> ul, > ol)") ) { walk(el); continue }
			if ( el.tagName !== "LI" ) { lines.push([el.textContent]); continue }
			let depth = -1;
			for ( let p = el.parentElement; p !== editor; p = p.parentElement ) { if ( p.matches("ul, ol") ) { depth++ } }
			const own = [...el.childNodes].filter(n => !(n.nodeType === 1 && n.matches("ul, ol"))).map(n => n.textContent).join("");
			lines.push([own, depth, el.getAttribute("data-checked")]);
			walk(el);
		}
	};
	walk(editor);
	return lines;
}"""

CHECKLIST = ('<ul><li data-checked="true">done<ul><li data-checked="false">sub</li></ul></li>'
	'<li data-checked="false">todo</li></ul><div>text</div>')


def items(vi):
	return vi.page.evaluate(ITEMS_JS)


def test_yy_p_pastes_a_checked_item(vi):
	vi.load(html=CHECKLIST).keys("y", "y", "G", "p")
	assert items(vi) == [["done", 0, "true"], ["sub", 1, "false"], ["todo", 0, "false"], ["text"], ["done", 0, "true"]]


def test_yy_p_keeps_the_level(vi):
	vi.load(html=CHECKLIST).keys("j", "y", "y", "p")
	assert items(vi) == [["done", 0, "true"], ["sub", 1, "false"], ["sub", 1, "false"], ["todo", 0, "false"], ["text"]]


def test_yanked_tree_pastes_as_a_tree(vi):
	vi.load(html=CHECKLIST).keys("y", "j", "G", "p")
	assert items(vi) == [["done", 0, "true"], ["sub", 1, "false"], ["todo", 0, "false"], ["text"],
		["done", 0, "true"], ["sub", 1, "false"]]


def test_dd_p_moves_a_checked_item(vi):
	vi.load(html=CHECKLIST).keys("j", "j", "d", "d", "k", "k", "P")
	assert items(vi) == [["todo", 0, "false"], ["done", 0, "true"], ["sub", 1, "false"], ["text"]]


def test_P_into_the_first_line(vi):
	vi.load(html='<div>text</div><ul><li data-checked="true">done</li></ul>').keys("j", "y", "y", "g", "g", "P")
	assert items(vi) == [["done", 0, "true"], ["text"], ["done", 0, "true"]]


def test_charwise_yank_is_text_only(vi):
	vi.load(html=CHECKLIST).keys("j", "j", "y", "w", "G", "p")
	assert items(vi)[-1] == ["ttodoext"]
