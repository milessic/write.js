"""
Checklist items are only ever Text: a heading can't be made of one, and a heading in or around one goes away.
"""
import pytest

pytest.importorskip("playwright")

HEADINGS = "h1, h2, h3, h4, h5, h6"


@pytest.fixture
def editor(page):
	# vi's INSERT, so keys type into the document
	page.click("#editor")
	page.keyboard.press("Escape")
	page.keyboard.press("i")
	yield page
	page.keyboard.press("Escape")


def load(page, html, item=0):
	# the caret at the end of the item-th list item
	page.evaluate("""([html, item]) => {
		const editor = document.getElementById("editor");
		editor.innerHTML = html;
		editor.dispatchEvent(new Event("input", { bubbles: true }));
		editor.focus();
		const range = document.createRange();
		range.selectNodeContents(editor.querySelectorAll("li")[item]);
		range.collapse(false);
		getSelection().removeAllRanges();
		getSelection().addRange(range);
	}""", [html, item])


def html(page):
	return page.evaluate("document.getElementById('editor').innerHTML")


@pytest.mark.parametrize("tag", ["h1", "h2", "h3", "h4"])
def test_heading_on_a_checklist_item_does_nothing(editor, tag):
	load(editor, '<ul><li data-checked="false">abc</li><li data-checked="true">def</li></ul>')
	editor.evaluate(f"formatText('{tag}')")
	assert editor.locator(f"#editor :is({HEADINGS})").count() == 0
	editor.keyboard.press("Enter")
	editor.keyboard.type("new")
	assert html(editor) == '<ul><li data-checked="false">abc</li><li data-checked="false">new</li><li data-checked="true">def</li></ul>'


def test_heading_on_a_nested_checklist_item_does_nothing(editor):
	load(editor, '<ul><li>parent<ul><li data-checked="false">child</li></ul></li></ul>', item=1)
	editor.evaluate("formatText('h2')")
	assert editor.locator(f"#editor :is({HEADINGS})").count() == 0


def test_heading_on_a_bullet_still_works(editor):
	load(editor, "<ul><li>abc</li></ul>")
	editor.evaluate("formatText('h1')")
	assert editor.locator("#editor h1").count() == 1


@pytest.mark.parametrize("saved", [
	'<h1><ul><li data-checked="false">abc</li></ul></h1><hr class="heading-break">',
	'<ul><li data-checked="false"><h2>abc</h2></li></ul>',
])
def test_saved_heading_checklist_becomes_text(editor, saved):
	load(editor, saved)
	assert html(editor) == '<ul><li data-checked="false">abc</li></ul>'
