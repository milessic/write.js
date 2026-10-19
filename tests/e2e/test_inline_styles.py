"""
Text moved between a heading and a line keeps the size of where it goes: Chrome's <span style="font-size: ..."> go away.
"""
import pytest

pytest.importorskip("playwright")


@pytest.fixture
def editor(page):
	# vi's INSERT, so keys type into the document
	page.click("#editor")
	page.keyboard.press("Escape")
	page.keyboard.press("i")
	yield page
	page.keyboard.press("Escape")


def load(page, html, selector, at_start):
	page.evaluate("""([html, selector, atStart]) => {
		const editor = document.getElementById("editor");
		editor.innerHTML = html;
		editor.dispatchEvent(new Event("input", { bubbles: true }));
		editor.focus();
		const range = document.createRange();
		range.selectNodeContents(editor.querySelector(selector));
		range.collapse(atStart);
		getSelection().removeAllRanges();
		getSelection().addRange(range);
	}""", [html, selector, at_start])


def html(page):
	return page.evaluate("document.getElementById('editor').innerHTML")


def test_backspace_joining_a_line_into_a_heading(editor):
	load(editor, "<h3>Title</h3><div>text</div>", "div", True)
	editor.keyboard.press("Backspace")
	assert "style" not in html(editor)
	assert editor.locator("#editor h3").inner_text() == "Titletext"


def test_delete_joining_a_heading_into_a_line(editor):
	load(editor, "<div>text</div><h3>Title</h3>", "div", False)
	editor.keyboard.press("Delete")
	editor.keyboard.type("x")
	assert "style" not in html(editor)


def test_typing_after_joining_has_no_style(editor):
	load(editor, "<h3>Title</h3><div><br></div><div>text</div>", "div:last-child", True)
	editor.keyboard.press("Backspace")
	editor.keyboard.press("Backspace")
	editor.keyboard.type("abc")
	assert "style" not in html(editor)


def test_styled_spans_of_a_saved_document_go_away(editor):
	editor.evaluate("""() => fillEditorWithHTML('<h3><span style="font-size: 1.3em; font-weight: 700;">Creative</span></h3>'
		+ '<div><span style="font-size: 1.3em;"><br></span></div>')""")
	assert html(editor) == "<h3>Creative</h3><div><br></div>"
