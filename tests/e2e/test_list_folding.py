"""
List folding (folding.js): the arrow left of an item with nested items collapses them; edits never go into hidden items.
"""
import pytest

pytest.importorskip("playwright")

NESTED = ('<ul><li>a<ul><li>a1</li><li>a2</li></ul></li><li>b</li></ul>'
	'<ul><li data-checked="false">task<ul><li data-checked="true">sub</li></ul></li></ul>'
	'<ol><li>one<ol><li>one.one</li></ol></li><li>two</li></ol>'
	'<div>end</div>')


@pytest.fixture
def editor(page):
	# vi's INSERT, so keys type into the document
	page.click("#editor")
	page.keyboard.press("Escape")
	page.keyboard.press("i")
	load(page, NESTED)
	yield page
	page.keyboard.press("Escape")
	page.evaluate("localStorage.removeItem(listFoldingKey); applyFoldingSettings()")


def load(page, html):
	page.evaluate("""(html) => {
		const editor = document.getElementById("editor");
		editor.innerHTML = html;
		editor.dispatchEvent(new Event("input", { bubbles: true }));
	}""", html)


def caret(page, selector, at_end=True):
	# the caret at the start or the end of the item's own text
	page.evaluate("""([selector, atEnd]) => {
		const li = document.querySelector(selector);
		const editor = li.closest(".editor");
		editor.focus();
		const text = [...li.childNodes].find((n) => n.nodeType === Node.TEXT_NODE);
		const range = document.createRange();
		range.setStart(text, atEnd ? text.length : 0);
		range.collapse(true);
		getSelection().removeAllRanges();
		getSelection().addRange(range);
	}""", [selector, at_end])


def click_arrow(page, selector):
	x, y = page.evaluate("""(selector) => {
		const li = document.querySelector(selector);
		const rect = li.getBoundingClientRect();
		const fontSize = parseFloat(getComputedStyle(li).fontSize);
		return [rect.left - 2.35 * fontSize, rect.top + fontSize * .7];
	}""", selector)
	page.mouse.click(x, y)


def collapsed(page):
	return page.evaluate("[...document.querySelectorAll('#editor li[data-collapsed]')].map((li) => li.firstChild.textContent)")


def visible(page, text):
	return page.evaluate("""(text) => [...document.querySelectorAll("#editor li")]
		.some((li) => li.firstChild.textContent === text && li.checkVisibility())""", text)


@pytest.mark.parametrize("selector, item, hidden", [
	("#editor > ul > li", "a", "a1"),
	("#editor > ul:nth-of-type(2) > li", "task", "sub"),
	("#editor > ol > li", "one", "one.one"),
])
def test_arrow_collapses_and_expands(editor, selector, item, hidden):
	click_arrow(editor, selector)
	assert collapsed(editor) == [item]
	assert not visible(editor, hidden)
	assert visible(editor, item)
	click_arrow(editor, selector)
	assert collapsed(editor) == []
	assert visible(editor, hidden)


def test_arrow_doesnt_toggle_the_checkbox(editor):
	click_arrow(editor, "#editor > ul:nth-of-type(2) > li")
	assert editor.evaluate("document.querySelector('#editor li[data-checked]').dataset.checked") == "false"


def test_item_without_nested_items_has_no_fold(editor):
	click_arrow(editor, "#editor > ol > li:nth-child(2)")
	assert collapsed(editor) == []


def test_collapsing_moves_the_caret_out_of_hidden_items(editor):
	caret(editor, "#editor > ul > li > ul > li")
	click_arrow(editor, "#editor > ul > li")
	assert collapsed(editor) == ["a"]
	editor.keyboard.type("X")
	assert editor.evaluate("document.querySelector('#editor > ul > li').firstChild.textContent") == "aX"


def test_enter_in_collapsed_item_expands_it(editor):
	click_arrow(editor, "#editor > ul > li")
	caret(editor, "#editor > ul > li")
	editor.keyboard.press("Enter")
	assert collapsed(editor) == []
	assert visible(editor, "a1")


def test_backspace_into_hidden_item_expands_it(editor):
	click_arrow(editor, "#editor > ul > li")
	caret(editor, "#editor > ul > li:nth-child(2)", at_end=False)
	editor.keyboard.press("Backspace")
	assert collapsed(editor) == []


def test_delete_at_end_of_collapsed_item_expands_it(editor):
	click_arrow(editor, "#editor > ol > li")
	caret(editor, "#editor > ol > li")
	editor.keyboard.press("Delete")
	assert collapsed(editor) == []


def test_tab_into_collapsed_item_expands_it(editor):
	click_arrow(editor, "#editor > ul > li")
	caret(editor, "#editor > ul > li:nth-child(2)")
	editor.keyboard.press("Tab")
	assert collapsed(editor) == []
	assert visible(editor, "b")


def test_fold_is_dropped_with_the_nested_items(editor):
	load(editor, '<ul><li data-collapsed="true">a</li></ul>')
	assert collapsed(editor) == []


def test_setting_off_shows_everything(editor):
	click_arrow(editor, "#editor > ul > li")
	editor.evaluate("localStorage.setItem(listFoldingKey, '0'); applyFoldingSettings()")
	assert visible(editor, "a1")
	assert collapsed(editor) == ["a"]  # kept for when it is back on
	click_arrow(editor, "#editor > ul > li")
	assert collapsed(editor) == ["a"]


def test_tab_makes_the_item_above_foldable(editor):
	load(editor, "<ul><li>a</li><li>b</li></ul>")
	caret(editor, "#editor li:nth-child(2)")
	editor.keyboard.press("Tab")
	assert editor.evaluate("document.getElementById('editor').innerHTML") == "<ul><li>a<ul><li>b</li></ul></li></ul>"
	editor.keyboard.type("X")
	click_arrow(editor, "#editor > ul > li")
	assert collapsed(editor) == ["a"]
	assert not visible(editor, "bX")
	click_arrow(editor, "#editor > ul > li")
	caret(editor, "#editor li li")
	editor.keyboard.press("Shift+Tab")
	# back as the item after a (Chrome wraps its text in a <span style>, as it did before folding)
	assert editor.evaluate("[...document.querySelectorAll('#editor > ul > li')].map((li) => li.textContent)") == ["a", "bX"]
	assert editor.locator("#editor li li").count() == 0
