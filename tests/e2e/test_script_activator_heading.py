"""
A script's button (scripting.js) stays in a line of text: the toolbar's text style, vi's :h1 and a typed "# " don't make
its line a heading; the other lines still can be.
"""
import pytest

pytest.importorskip("playwright")

from tests.e2e.test_scripting import app  # noqa: F401

DOC = ('<div>intro <span class="script-activator" contenteditable="false" data-script="return 1" data-script-border="dashed">Run</span></div>'
	'<div>plain</div>')


@pytest.fixture
def doc(app):
	app.evaluate("""(html) => {
		const editor = document.getElementById("editor");
		editor.innerHTML = html;
		editor.focus();
		getSelection().collapse(editor.firstElementChild.firstChild, 2);
	}""", DOC)
	return app


def blocks(page):
	return page.evaluate("[...document.getElementById('editor').children].map((el) => el.nodeName)")


def test_toolbar_heading_keeps_the_line_text(doc):
	doc.evaluate("formatText('h1')")
	assert blocks(doc) == ["DIV", "DIV"]
	assert doc.locator(".notification-container", has_text="script's button stays text").count() == 1
	# the other line can be a heading
	doc.evaluate("getSelection().collapse(document.getElementById('editor').children[1].firstChild, 1); formatText('h2')")
	assert blocks(doc) == ["DIV", "H2"]


def test_selection_over_both_lines_keeps_them(doc):
	doc.evaluate("""() => {
		const editor = document.getElementById("editor");
		getSelection().setBaseAndExtent(editor.children[0].firstChild, 0, editor.children[1].firstChild, 2);
		formatText("h1");
	}""")
	assert blocks(doc) == ["DIV", "DIV"]


def test_typed_hash_stays_text(doc):
	doc.evaluate("getSelection().collapse(document.getElementById('editor').firstElementChild.firstChild, 0)")
	doc.keyboard.type("# ")
	assert blocks(doc) == ["DIV", "DIV"]
	assert doc.evaluate("document.getElementById('editor').firstElementChild.textContent").startswith("# intro")
	# on a line without a button it still does
	doc.evaluate("getSelection().collapse(document.getElementById('editor').children[1].firstChild, 0)")
	doc.keyboard.type("# ")
	assert blocks(doc) == ["DIV", "H1"]
