"""
List folding (folding.js): the arrow left of an item with nested items collapses them; edits never go into hidden items,
and the browser's undo keeps working. Nested lists are right after their item, as Tab makes them, or inside it.
"""
import pytest

pytest.importorskip("playwright")

# as Tab nests items: the list right after its item
AFTER = ('<ul><li>a</li><ul><li>a1</li><li>a2</li></ul><li>b</li></ul>'
	'<ul><li data-checked="false">task</li><ul><li data-checked="true">sub</li></ul></ul>'
	'<ol><li>one</li><ol><li>one.one</li></ol><li>two</li></ol>'
	'<div>end</div>')
# as pasted or from Markdown: the list inside its item
INSIDE = ('<ul><li>a<ul><li>a1</li><li>a2</li></ul></li><li>b</li></ul>'
	'<ul><li data-checked="false">task<ul><li data-checked="true">sub</li></ul></li></ul>'
	'<ol><li>one<ol><li>one.one</li></ol></li><li>two</li></ol>'
	'<div>end</div>')

FIND = """(text) => [...document.querySelectorAll("#editor li")].find((li) => li.firstChild?.textContent === text)"""
HTML = "document.getElementById('editor').innerHTML"


@pytest.fixture
def vi_insert(page):
	# vi's INSERT, so keys type into the document
	page.click("#editor")
	page.keyboard.press("Escape")
	page.keyboard.press("i")
	yield page
	page.keyboard.press("Escape")
	page.evaluate("localStorage.removeItem(listFoldingKey); applyFoldingSettings()")


@pytest.fixture(params=["after", "inside"])
def editor(vi_insert, request):
	load(vi_insert, AFTER if request.param == "after" else INSIDE)
	return vi_insert


def load(page, html):
	page.evaluate("""(html) => {
		const editor = document.getElementById("editor");
		editor.innerHTML = html;
		editor.dispatchEvent(new Event("input", { bubbles: true }));
	}""", html)


def caret(page, text, at_end=True):
	# the caret at the start or the end of the item's own text
	page.evaluate(f"""([text, atEnd]) => {{
		const li = ({FIND})(text);
		li.closest(".editor").focus();
		const node = li.firstChild;
		const range = document.createRange();
		range.setStart(node, atEnd ? node.length : 0);
		range.collapse(true);
		getSelection().removeAllRanges();
		getSelection().addRange(range);
	}}""", [text, at_end])


def click_arrow(page, text):
	# the arrow is on the item's first line (list inside it) or last line (list after it)
	x, y = page.evaluate(f"""(text) => {{
		const li = ({FIND})(text);
		const rect = li.getBoundingClientRect();
		const fontSize = parseFloat(getComputedStyle(li).fontSize);
		const inside = [...li.children].some((el) => el.matches("ul, ol"));
		return [rect.left - 2.35 * fontSize, inside ? rect.top + fontSize * .7 : rect.bottom - fontSize * .7];
	}}""", text)
	page.mouse.click(x, y)


def collapsed(page):
	return page.evaluate("[...document.querySelectorAll('#editor li[data-collapsed]')].map((li) => li.firstChild.textContent)")


def visible(page, text):
	return page.evaluate(f"(text) => ({FIND})(text)?.checkVisibility() ?? false", text)


@pytest.mark.parametrize("item, hidden", [("a", "a1"), ("task", "sub"), ("one", "one.one")])
def test_arrow_collapses_and_expands(editor, item, hidden):
	click_arrow(editor, item)
	assert collapsed(editor) == [item]
	assert not visible(editor, hidden)
	assert visible(editor, item)
	click_arrow(editor, item)
	assert collapsed(editor) == []
	assert visible(editor, hidden)


def test_arrow_shows_on_hover(editor):
	opacity = f"""(text) => {{
		const li = ({FIND})(text);
		const list = [...li.children].find((el) => el.matches("ul, ol")) || li.nextElementSibling;
		return getComputedStyle(list, "::before").opacity;
	}}"""
	editor.mouse.move(5, 5)
	editor.wait_for_timeout(200)
	assert editor.evaluate(opacity, "a") == "0"
	box = editor.evaluate(f"(text) => {{ const r = ({FIND})(text).getBoundingClientRect(); return [r.left + 5, r.top + 5] }}", "a")
	editor.mouse.move(*box)
	editor.wait_for_timeout(200)
	assert editor.evaluate(opacity, "a") != "0"


def test_arrow_doesnt_toggle_the_checkbox(editor):
	click_arrow(editor, "task")
	assert editor.evaluate("document.querySelector('#editor li[data-checked]').dataset.checked") == "false"


def test_item_without_nested_items_has_no_fold(editor):
	click_arrow(editor, "two")
	assert collapsed(editor) == []


def test_collapsing_moves_the_caret_out_of_hidden_items(editor):
	caret(editor, "a1")
	click_arrow(editor, "a")
	assert collapsed(editor) == ["a"]
	editor.keyboard.type("X")
	assert visible(editor, "aX")


def test_enter_in_collapsed_item_expands_it(editor):
	click_arrow(editor, "a")
	caret(editor, "a")
	editor.keyboard.press("Enter")
	assert collapsed(editor) == []
	assert visible(editor, "a1")


def test_backspace_into_hidden_item_expands_it(editor):
	click_arrow(editor, "a")
	caret(editor, "b", at_end=False)
	editor.keyboard.press("Backspace")
	assert collapsed(editor) == []


def test_delete_at_end_of_collapsed_item_expands_it(editor):
	click_arrow(editor, "one")
	caret(editor, "one")
	editor.keyboard.press("Delete")
	assert collapsed(editor) == []


def test_tab_into_collapsed_item_expands_it(editor):
	click_arrow(editor, "a")
	caret(editor, "b")
	editor.keyboard.press("Tab")
	assert collapsed(editor) == []
	assert visible(editor, "b")


def test_fold_is_dropped_with_the_nested_items(vi_insert):
	load(vi_insert, '<ul><li data-collapsed="true">a</li></ul>')
	assert collapsed(vi_insert) == []


def test_setting_off_shows_everything(editor):
	click_arrow(editor, "a")
	editor.evaluate("localStorage.setItem(listFoldingKey, '0'); applyFoldingSettings()")
	assert visible(editor, "a1")
	assert collapsed(editor) == ["a"]  # kept for when it is back on
	click_arrow(editor, "a")
	assert collapsed(editor) == ["a"]


def test_tab_makes_the_item_above_foldable(vi_insert):
	load(vi_insert, "<ul><li>a</li><li>b</li></ul>")
	caret(vi_insert, "b")
	vi_insert.keyboard.press("Tab")
	vi_insert.keyboard.type("X")
	click_arrow(vi_insert, "a")
	assert collapsed(vi_insert) == ["a"]
	assert not visible(vi_insert, "bX")
	click_arrow(vi_insert, "a")
	caret(vi_insert, "bX")
	vi_insert.keyboard.press("Shift+Tab")
	assert vi_insert.evaluate("[...document.querySelectorAll('#editor > ul > li')].map((li) => li.textContent)") == ["a", "bX"]


# the browser's undo (vi's u) after folding and nesting: nothing is moved behind its back

def typed_checklist(page):
	load(page, "<div><br></div>")
	page.evaluate("""() => {
		const editor = document.getElementById("editor");
		editor.focus();
		const range = document.createRange();
		range.setStart(editor.firstChild, 0);
		getSelection().removeAllRanges();
		getSelection().addRange(range);
	}""")
	page.keyboard.type("- [ ] p")
	page.keyboard.press("Enter")
	page.keyboard.type("c")
	page.keyboard.press("Tab")


def undo(page, times):
	page.keyboard.press("Escape")
	for _ in range(times):
		page.keyboard.press("u")
	page.keyboard.press("i")


def test_undo_after_folding(vi_insert):
	typed_checklist(vi_insert)
	click_arrow(vi_insert, "p")
	click_arrow(vi_insert, "p")
	undo(vi_insert, 1)
	assert vi_insert.evaluate(HTML) == '<ul><li data-checked="false">p</li><li data-checked="false">c</li></ul>'


def test_undo_tab_under_an_item_with_nested_items(vi_insert):
	typed_checklist(vi_insert)
	vi_insert.keyboard.press("Enter")
	vi_insert.keyboard.press("Shift+Tab")
	vi_insert.keyboard.type("q")
	before_tab = vi_insert.evaluate(HTML)
	vi_insert.keyboard.press("Tab")
	click_arrow(vi_insert, "p")
	click_arrow(vi_insert, "p")
	undo(vi_insert, 1)
	assert vi_insert.evaluate(HTML) == before_tab


def test_enter_at_end_of_parent_keeps_its_items(vi_insert):
	typed_checklist(vi_insert)
	caret(vi_insert, "p")
	vi_insert.keyboard.press("Enter")
	vi_insert.keyboard.type("n")
	assert vi_insert.evaluate("[...document.querySelectorAll('#editor > ul > li')].map((li) => li.textContent)") == ["p", "n"]
	assert vi_insert.locator("#editor li li").count() == 0
	undo(vi_insert, 2)
	assert vi_insert.evaluate(HTML) == '<ul><li data-checked="false">p</li><ul><li data-checked="false">c</li></ul></ul>'


def test_loaded_document_has_lists_after_their_items(page):
	# a list inside an item goes right after it; an item that is only its lists (two checkboxes side by side) goes
	page.evaluate("""() => fillEditorWithHTML('<ul><li data-checked="false">p<ul><li data-checked="true">c</li></ul></li>'
		+ '<li data-checked="false"><br><ul><li data-checked="false">x</li></ul></li></ul>')""")
	assert page.evaluate(HTML) == ('<ul><li data-checked="false">p</li><ul><li data-checked="true">c</li></ul>'
		'<ul><li data-checked="false">x</li></ul></ul>')
