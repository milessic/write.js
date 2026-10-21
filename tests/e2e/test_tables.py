"""
Tables (tables.js): inserted from the toolbar's widget, changed from a cell's menu (rows, columns, the table), pasted
from HTML or Markdown as the editor's own tables, exported to and imported from Markdown.
"""
import pytest

from test_list_folding import HTML, load, vi_insert  # noqa: F401 (fixture)
from test_paste_list import paste

pytest.importorskip("playwright")

TABLE = '<div>a</div><table><thead><tr><th>h1</th><th>h2</th></tr></thead><tbody><tr><td>x</td><td>y</td></tr></tbody></table><div>b</div>'


def caret_in(page, text):
	page.evaluate("""(text) => {
		const cell = [...document.querySelectorAll("#editor td, #editor th")].find((c) => c.textContent === text);
		cell.closest(".editor").focus();
		getSelection().collapse(cell.firstChild, cell.firstChild.length || 0);
	}""", text)


def menu(page, text, label):
	page.click(f"#editor :is(td, th):text-is('{text}')", button="right")
	page.click(f"#context-menu button:text-is('{label}')")


def undo(page):
	page.evaluate("document.execCommand('undo')")


def test_insert_from_the_widget(vi_insert):
	load(vi_insert, "<div>ab</div>")
	vi_insert.evaluate("""() => {
		const text = document.querySelector("#editor div").firstChild;
		getSelection().collapse(text, 2);
	}""")
	vi_insert.click("#tb-btn-table")
	vi_insert.fill("#table-columns", "2")
	vi_insert.fill("#table-rows", "1")
	vi_insert.click("#insert-table-btn")
	assert vi_insert.evaluate(HTML) == ('<div>ab</div><table><thead><tr><th><br></th><th><br></th></tr></thead>'
		'<tbody><tr><td><br></td><td><br></td></tr></tbody></table><div><br></div>')
	# the caret in the first header cell
	vi_insert.keyboard.type("H")
	assert vi_insert.evaluate("document.querySelector('#editor th').textContent") == "H"
	assert vi_insert.evaluate("getComputedStyle(document.querySelector('#editor th')).fontWeight") == "700"


def test_insert_without_headers(vi_insert):
	load(vi_insert, "<div>ab</div><div>c</div>")
	vi_insert.evaluate("getSelection().collapse(document.querySelector('#editor div').firstChild, 1)")
	vi_insert.click("#tb-btn-table")
	vi_insert.fill("#table-columns", "1")
	vi_insert.fill("#table-rows", "2")
	vi_insert.uncheck("#table-headers")
	vi_insert.press("#table-rows", "Enter")
	assert vi_insert.evaluate(HTML) == ('<div>a</div><table><tbody><tr><td><br></td></tr><tr><td><br></td></tr></tbody></table>'
		'<div>b</div><div>c</div>')


@pytest.mark.parametrize("label, expected", [
	("Add 1 row above", '<tr><td><br></td><td><br></td></tr><tr><td>x</td><td>y</td></tr>'),
	("Add 1 row below", '<tr><td>x</td><td>y</td></tr><tr><td><br></td><td><br></td></tr>'),
])
def test_add_row(vi_insert, label, expected):
	load(vi_insert, TABLE)
	menu(vi_insert, "x", label)
	assert vi_insert.evaluate("document.querySelector('#editor tbody').innerHTML") == expected
	undo(vi_insert)
	assert vi_insert.evaluate(HTML) == TABLE


def test_columns(vi_insert):
	load(vi_insert, TABLE)
	menu(vi_insert, "h1", "Add 1 column right")
	assert vi_insert.evaluate(HTML) == ('<div>a</div><table><thead><tr><th>h1</th><th><br></th><th>h2</th></tr></thead>'
		'<tbody><tr><td>x</td><td><br></td><td>y</td></tr></tbody></table><div>b</div>')
	menu(vi_insert, "h2", "Remove column")
	menu(vi_insert, "h1", "Remove column")
	assert vi_insert.evaluate(HTML) == '<div>a</div><table><thead><tr><th><br></th></tr></thead><tbody><tr><td><br></td></tr></tbody></table><div>b</div>'


def test_remove_rows_and_table(vi_insert):
	load(vi_insert, TABLE)
	menu(vi_insert, "h1", "Remove header row")
	assert vi_insert.evaluate(HTML) == '<div>a</div><table><tbody><tr><td>x</td><td>y</td></tr></tbody></table><div>b</div>'
	vi_insert.click("#editor td:text-is('x')", button="right")
	assert vi_insert.is_disabled("#context-menu button:text-is('Remove row')")
	vi_insert.click("#context-menu button:text-is('Add header row')")
	assert vi_insert.evaluate("document.querySelectorAll('#editor th').length") == 2
	menu(vi_insert, "x", "Remove table")
	assert vi_insert.evaluate(HTML) == '<div>a</div><div><br></div><div>b</div>'


def test_toolbar_opens_the_table_menu_in_a_table(vi_insert):
	load(vi_insert, TABLE)
	caret_in(vi_insert, "y")
	vi_insert.click("#tb-btn-table")
	vi_insert.click("#context-menu button:text-is('Add 1 column left')")
	assert vi_insert.evaluate("[...document.querySelectorAll('#editor td')].map((c) => c.textContent)") == ["x", "", "y"]


def test_tab_moves_between_cells_and_adds_a_row(vi_insert):
	load(vi_insert, TABLE)
	caret_in(vi_insert, "x")
	vi_insert.keyboard.press("Shift+Tab")
	vi_insert.keyboard.type("!")
	vi_insert.keyboard.press("Tab")
	vi_insert.keyboard.press("Tab")
	vi_insert.keyboard.press("Tab")
	vi_insert.keyboard.type("z")
	assert vi_insert.evaluate("[...document.querySelectorAll('#editor tr')].map((r) => r.textContent)") == ["h1h2!", "xy", "z"]


def test_paste_html_table(vi_insert):
	load(vi_insert, "<div>ab</div>")
	vi_insert.evaluate("getSelection().collapse(document.querySelector('#editor div').firstChild, 2)")
	paste(vi_insert, "h\tk", '<meta charset="utf-8"><style>td{color:red}</style><p>before</p>'
		'<table style="width:100%" class="x"><colgroup><col></colgroup><tbody>'
		'<tr><th style="color:red">H</th><th><span style="font-weight:700">K</span></th></tr>'
		'<tr><td colspan="2"><b>one</b> <img src="z" onerror="alert(1)"><p>two</p></td></tr>'
		'<tr><td onclick="alert(1)">3</td></tr></tbody></table>')
	assert vi_insert.evaluate(HTML) == ('<div>abbefore</div><table><thead><tr><th>H</th><th>K</th></tr></thead>'
		'<tbody><tr><td><b>one</b><br>two</td><td><br></td></tr><tr><td>3</td><td><br></td></tr></tbody></table><div><br></div>')


def test_paste_markdown_table(vi_insert):
	load(vi_insert, "<div>ab</div>")
	vi_insert.evaluate("getSelection().collapse(document.querySelector('#editor div').firstChild, 2)")
	paste(vi_insert, "text\n\n| a | **b** |\n|---|:-:|\n| 1 | 2 |\n| 3 |")
	assert vi_insert.evaluate(HTML) == ('<div>abtext</div><div><br></div><table><thead><tr><th>a</th><th><b>b</b></th></tr></thead>'
		'<tbody><tr><td>1</td><td>2</td></tr><tr><td>3</td><td><br></td></tr></tbody></table><div><br></div>')


def test_paste_in_a_cell_goes_after_the_table(vi_insert):
	load(vi_insert, TABLE)
	caret_in(vi_insert, "x")
	paste(vi_insert, "| q |\n|---|\n| w |")
	assert vi_insert.evaluate("document.querySelectorAll('#editor table').length") == 2
	assert vi_insert.evaluate("document.querySelectorAll('#editor table table').length") == 0


def test_markdown_round_trip(page):
	page.evaluate("(html) => fillEditorWithHTML(html)", '<div>t</div><table><thead><tr><th>a|b</th><th>c</th></tr></thead>'
		'<tbody><tr><td><b>1</b></td><td><br></td></tr></tbody></table><table><tbody><tr><td>n</td></tr></tbody></table><div>e</div>')
	md = page.evaluate("getContentAsMarkdown()")
	assert md == "t\n\n| a\\|b | c |\n| --- | --- |\n| __1__ |  |\n\n|  |\n| --- |\n| n |\n\ne"
	page.evaluate("(md) => fillEditorWithHTML(markdownToHtml(md))", md)
	assert page.evaluate(HTML) == ('<div>t</div><table><thead><tr><th>a|b</th><th>c</th></tr></thead>'
		'<tbody><tr><td><b>1</b></td><td><br></td></tr></tbody></table><table><tbody><tr><td>n</td></tr></tbody></table><div>e</div>')


def test_insert_keeps_the_scroll(vi_insert):
	load(vi_insert, "".join(f"<div>line {i}</div>" for i in range(80)))
	vi_insert.click("#editor div:text-is('line 60')")
	scroll = "document.getElementById('editor').closest('.pane-scroll').scrollTop"
	before = vi_insert.evaluate(scroll)
	assert before > 0
	vi_insert.click("#tb-btn-table")
	vi_insert.click("#insert-table-btn")
	assert vi_insert.evaluate(scroll) == before


def command(page, text):
	page.click("#editor")
	page.keyboard.press("Escape")
	page.keyboard.type(f"gg:{text}")
	page.keyboard.press("Enter")


@pytest.mark.parametrize("text, values", [
	("table", ["3", "3", True]),
	("table 4", ["4", "3", True]),
])
def test_command_without_rows_opens_the_widget(page, text, values):
	load(page, "<div>ab</div>")
	command(page, text)
	assert [page.input_value("#table-columns"), page.input_value("#table-rows"), page.is_checked("#table-headers")] == values
	page.keyboard.press("Escape")
	assert page.locator("#table-columns").count() == 0


@pytest.mark.parametrize("text, headers", [
	("table 3 2", True),
	("table 3 2 false", False),
	("table 3 2 NO", False),
	("table 3 2 0", False),
	("table 3 2 True", True),
	("table 3 2 yes", True),
	("table 3 2 1", True),
])
def test_command_adds_the_table_under_the_line(page, text, headers):
	load(page, "<div>ab</div><div>c</div>")
	command(page, text)
	assert page.locator("#table-columns").count() == 0
	assert page.evaluate("[...document.querySelectorAll('#editor tr')].map((r) => r.cells.length)") == [3] * (3 if headers else 2)
	assert page.evaluate("document.querySelectorAll('#editor th').length") == (3 if headers else 0)
	assert page.evaluate("[...document.getElementById('editor').children].map((el) => el.tagName + el.textContent)") == ["DIVab", "TABLE", "DIVc"]


@pytest.mark.parametrize("text", ["table 0 2", "table x 2", "table 3 2 maybe", "table 3 2 no x", "table 51 1"])
def test_command_with_wrong_arguments(page, text):
	load(page, "<div>ab</div>")
	command(page, text)
	assert page.locator("#table-columns").count() == 0
	assert page.locator("#vi-root").inner_text().count("E4") == 1


GRID = ('<div>above</div><table><thead><tr><th>a</th><th>b</th><th>c</th></tr></thead>'
	'<tbody><tr><td>d</td><td>ee</td><td>f</td></tr><tr><td>g</td><td>h</td><td>i</td></tr></tbody></table><div>below</div>')
WHERE = """() => {
	const node = getSelection().focusNode;
	const el = node.nodeType === 1 ? node : node.parentElement;
	return (el.closest("td, th") || el.closest("#editor > *")).textContent;
}"""


def normal_in(page, text, at_end=False):
	# vi's NORMAL, the cursor at the start (or on the last character) of the cell
	page.click("#editor")
	page.keyboard.press("Escape")
	page.evaluate("""([text, atEnd]) => {
		const cell = [...document.querySelectorAll("#editor td, #editor th")].find((c) => c.textContent === text);
		getSelection().collapse(cell.firstChild, atEnd ? cell.firstChild.length - 1 : 0);
	}""", [text, at_end])


@pytest.mark.parametrize("start, keys, end", [
	("ee", "j", "h"), ("ee", "k", "b"), ("ee", "ArrowDown", "h"), ("ee", "ArrowUp", "b"),
	("b", "k", "above"), ("h", "j", "below"), ("g", "2k", "a"), ("a", "3j", "below"),
	("d", "h", "above"), ("ee", "h", "d"), ("d", "l", "ee"), ("i", "l", "below"), ("f", "ArrowRight", "below"), ("d", "ArrowLeft", "above"),
])
def test_vi_moves_through_the_table(page, start, keys, end):
	load(page, GRID)
	normal_in(page, start)
	for key in ([keys] if len(keys) > 2 else list(keys)):
		page.keyboard.press(key)
	assert page.evaluate(WHERE) == end


def test_vi_moves_inside_a_cell_first(page):
	load(page, GRID)
	normal_in(page, "ee")
	page.keyboard.press("l")
	assert page.evaluate(WHERE) == "ee"
	page.keyboard.press("l")
	assert page.evaluate(WHERE) == "f"
	page.keyboard.press("h")
	assert page.evaluate("[getSelection().focusNode.textContent, getSelection().focusOffset]") == ["ee", 1]


def select_cells(page, a, b):
	page.evaluate("""([a, b]) => {
		const cell = (text) => [...document.querySelectorAll("#editor td, #editor th")].find((c) => c.textContent === text).firstChild;
		document.getElementById("editor").focus();
		getSelection().setBaseAndExtent(cell(a), 0, cell(b), 1);
	}""", [a, b])
	page.wait_for_timeout(50)


def selected(page):
	return page.evaluate("document.querySelectorAll('.editor-pane.focused .table-selection-cell').length")


def copy(page):
	page.keyboard.press("Control+c")
	return page.evaluate("""async () => {
		const [item] = await navigator.clipboard.read();
		return [await (await item.getType("text/plain")).text(), await (await item.getType("text/html")).text()];
	}""")


def test_selection_between_cells_is_a_rectangle(vi_insert):
	load(vi_insert, GRID)
	select_cells(vi_insert, "b", "g")
	assert selected(vi_insert) == 6
	text, html = copy(vi_insert)
	assert text == "| a | b |\n| --- | --- |\n| d | ee |\n| g | h |"
	assert "<table><thead><tr><th>a</th><th>b</th></tr></thead>" in html
	caret_in(vi_insert, "i")
	vi_insert.wait_for_timeout(50)
	assert selected(vi_insert) == 0


def test_shift_click_selects_rows_and_columns(vi_insert):
	load(vi_insert, GRID)
	vi_insert.click("#editor td:text-is('d')")
	vi_insert.click("#editor td:text-is('f')", modifiers=["Shift"])
	vi_insert.wait_for_timeout(50)
	assert selected(vi_insert) == 3
	assert copy(vi_insert)[0] == "|  |  |  |\n| --- | --- | --- |\n| d | ee | f |"


def test_ctrl_click_adds_and_removes_cells(vi_insert):
	load(vi_insert, GRID)
	vi_insert.click("#editor th:text-is('a')")
	vi_insert.click("#editor td:text-is('i')", modifiers=["Control"])
	vi_insert.click("#editor td:text-is('ee')", modifiers=["Control"])
	vi_insert.wait_for_timeout(50)
	assert selected(vi_insert) == 3
	assert copy(vi_insert)[0] == "| a |  |  |\n| --- | --- | --- |\n|  | ee |  |\n|  |  | i |"
	vi_insert.click("#editor td:text-is('ee')", modifiers=["Control"])
	vi_insert.wait_for_timeout(50)
	assert selected(vi_insert) == 2


def test_copy_as_html_setting(vi_insert):
	load(vi_insert, GRID)
	vi_insert.evaluate("localStorage.setItem(tableCopyKey, 'html')")
	try:
		select_cells(vi_insert, "d", "ee")
		text, html = copy(vi_insert)
		assert text == "<table><tbody><tr><td>d</td><td>ee</td></tr></tbody></table>"
	finally:
		vi_insert.evaluate("localStorage.removeItem(tableCopyKey)")


def test_copy_a_selection_with_a_table(vi_insert):
	load(vi_insert, GRID)
	vi_insert.evaluate("""() => {
		const editor = document.getElementById("editor");
		editor.focus();
		getSelection().setBaseAndExtent(editor.firstChild.firstChild, 0, editor.lastChild.firstChild, 5);
	}""")
	assert copy(vi_insert)[0] == "above\n\n| a | b | c |\n| --- | --- | --- |\n| d | ee | f |\n| g | h | i |\n\nbelow"


def test_settings_has_the_copy_format(page):
	page.click("#hamburger-button")
	page.click("#settings-btn")
	page.check('input[name="setting-table-copy"][value="html"]')
	assert page.evaluate("localStorage.getItem(tableCopyKey)") == "html"
	page.check('input[name="setting-table-copy"][value="markdown"]')
	assert page.evaluate("localStorage.getItem(tableCopyKey)") == "markdown"
	page.keyboard.press("Escape")


@pytest.mark.parametrize("start, key, end", [
	("ee", "ArrowUp", "b"), ("ee", "ArrowDown", "h"), ("b", "ArrowUp", "above"), ("h", "ArrowDown", "below"),
	("above", "ArrowDown", "a"), ("below", "ArrowUp", "g"),
])
def test_arrows_move_up_and_down_the_table(vi_insert, start, key, end):
	load(vi_insert, GRID)
	vi_insert.evaluate("""(text) => {
		const el = [...document.querySelectorAll("#editor td, #editor th, #editor > div")].find((c) => c.textContent === text);
		el.closest(".editor").focus();
		getSelection().collapse(el.firstChild, 0);
	}""", start)
	vi_insert.keyboard.press(key)
	assert vi_insert.evaluate(WHERE) == end


def test_arrows_go_through_the_lines_of_a_cell_first(vi_insert):
	load(vi_insert, '<table><tbody><tr><td>a</td></tr><tr><td>one<br>two</td></tr><tr><td>b</td></tr></tbody></table><div>x</div>')
	vi_insert.click("#editor td:text-is('a')")
	vi_insert.keyboard.press("ArrowDown")
	vi_insert.keyboard.press("ArrowDown")
	assert vi_insert.evaluate("getSelection().focusNode.textContent") == "two"
	vi_insert.keyboard.press("ArrowDown")
	assert vi_insert.evaluate(WHERE) == "b"


@pytest.mark.parametrize("html, key, expected", [
	(GRID, "o", "<div>above</div>TABLE<div>new</div><div>below</div>"),
	(GRID, "O", "<div>above</div><div>new</div>TABLE<div>below</div>"),
	(GRID.replace("<div>below</div>", ""), "o", "<div>above</div>TABLE<div>new</div>"),
	(GRID.replace("<div>above</div>", ""), "O", "<div>new</div>TABLE<div>below</div>"),
])
def test_vi_open_line_around_the_table(page, html, key, expected):
	load(page, html)
	normal_in(page, "ee")
	page.keyboard.press(key)
	page.keyboard.type("new")
	page.keyboard.press("Escape")
	assert page.evaluate("document.getElementById('editor').innerHTML.replace(/<table>.*<\\/table>/, 'TABLE')") == expected
	assert page.evaluate("document.querySelector('#editor td:nth-child(2)').textContent") == "ee"


def test_a_wide_table_scrolls(vi_insert):
	load(vi_insert, "<div>a</div>")
	vi_insert.evaluate("insertTable(50, 2, true)")
	width = "(() => { const t = document.querySelector('#editor table'); return [t.scrollWidth > t.clientWidth, t.getBoundingClientRect().right <= document.getElementById('editor').getBoundingClientRect().right + 1] })()"
	assert vi_insert.evaluate(width) == [True, True]
	vi_insert.evaluate("caretToCell(document.querySelector('#editor tbody tr').cells[49])")
	assert vi_insert.evaluate("document.querySelector('#editor table').scrollLeft") > 0


def test_limits_are_50_columns_and_500_rows(page):
	load(page, "<div>ab</div>")
	command(page, "table 50 500 no")
	assert page.evaluate("[document.querySelectorAll('#editor tr').length, document.querySelector('#editor tr').cells.length]") == [500, 50]


T2 = "<table><tbody><tr><td>a</td><td>d</td></tr></tbody></table>"


@pytest.mark.parametrize("html, key, expected", [
	(f"<div>x</div>{T2}<h2>y</h2>", "o", "<div>x</div>TABLE<div>NEW</div><h2>y</h2>"),
	(f"<div>x</div>{T2}<ul><li>y</li></ul>", "o", "<div>x</div>TABLE<div>NEW</div><ul><li>y</li></ul>"),
	(f"<div>x</div>{T2}<pre>y</pre>", "o", "<div>x</div>TABLE<div>NEW</div><pre>y</pre>"),
	(f"<ul><li>x</li></ul>{T2}<div>y</div>", "O", "<ul><li>x</li></ul><div>NEW</div>TABLE<div>y</div>"),
	(f"<pre>x</pre>{T2}<div>y</div>", "O", "<pre>x</pre><div>NEW</div>TABLE<div>y</div>"),
	(f"<div>x</div><div>{T2}</div><div>y</div>", "o", "<div>x</div><div>TABLE</div><div>NEW</div><div>y</div>"),
	(f"<div>x</div>\n{T2}\n<div>y</div>", "O", "<div>x</div>\n<div>NEW</div>TABLE\n<div>y</div>"),
])
def test_vi_open_line_by_the_table_is_an_empty_text_line(page, html, key, expected):
	load(page, html)
	normal_in(page, "d")
	page.keyboard.press(key)
	page.keyboard.type("NEW")
	page.keyboard.press("Escape")
	assert page.evaluate("document.getElementById('editor').innerHTML.replace(/<table>.*<\\/table>/, 'TABLE')") == expected


def test_vi_open_line_by_the_table_is_one_undo(page):
	load(page, f"<div>x</div>{T2}<h2>y</h2>")
	normal_in(page, "d")
	page.keyboard.press("o")
	page.keyboard.press("Escape")
	page.keyboard.press("u")
	assert page.evaluate(HTML) == f"<div>x</div>{T2}<h2>y</h2>"


def labels(page):
	return page.evaluate("[...document.querySelectorAll('#context-menu button')].map((b) => b.textContent)")


@pytest.mark.parametrize("a, b, rows, columns", [("d", "h", 2, 2), ("b", "c", 1, 2), ("ee", "h", 2, 1)])
def test_menu_adds_as_many_rows_and_columns_as_selected(vi_insert, a, b, rows, columns):
	load(vi_insert, GRID)
	select_cells(vi_insert, a, b)
	vi_insert.click(f"#editor :is(td, th):text-is('{b}')", button="right")
	r = "row" if rows == 1 else "rows"
	c = "column" if columns == 1 else "columns"
	assert labels(vi_insert)[:2] == [f"Add {rows} {r} above", f"Add {rows} {r} below"]
	assert labels(vi_insert)[3:5] == [f"Add {columns} {c} left", f"Add {columns} {c} right"]
	vi_insert.keyboard.press("Escape")


def test_add_selected_rows_below_and_columns_left(vi_insert):
	load(vi_insert, GRID)
	select_cells(vi_insert, "d", "h")
	vi_insert.click("#editor td:text-is('h')", button="right")
	vi_insert.click("#context-menu button:text-is('Add 2 rows below')")
	assert vi_insert.evaluate("[...document.querySelectorAll('#editor tr')].map((r) => r.textContent)") == ["abc", "deef", "ghi", "", ""]
	select_cells(vi_insert, "ee", "f")
	vi_insert.click("#editor td:text-is('f')", button="right")
	vi_insert.click("#context-menu button:text-is('Add 2 columns left')")
	assert vi_insert.evaluate("[...document.querySelector('#editor tbody tr').cells].map((c) => c.textContent)") == ["d", "", "", "ee", "f"]


def test_twenty_rows_from_a_ctrl_click_selection(vi_insert):
	load(vi_insert, "<table><tbody>" + "".join(f"<tr><td>r{i}</td></tr>" for i in range(20)) + "</tbody></table><div>x</div>")
	vi_insert.click("#editor td:text-is('r0')")
	vi_insert.click("#editor td:text-is('r19')", modifiers=["Shift"])
	vi_insert.wait_for_timeout(50)
	vi_insert.click("#editor td:text-is('r5')", button="right")
	vi_insert.click("#context-menu button:text-is('Add 20 rows above')")
	assert vi_insert.evaluate("document.querySelectorAll('#editor tr').length") == 40
	assert vi_insert.evaluate("document.querySelectorAll('#editor tr')[20].textContent") == "r0"


def test_right_click_keeps_a_ctrl_click_selection(vi_insert):
	load(vi_insert, GRID)
	vi_insert.click("#editor td:text-is('d')")
	vi_insert.click("#editor td:text-is('i')", modifiers=["Control"])
	vi_insert.click("#editor td:text-is('i')", button="right")
	assert labels(vi_insert)[:2] == ["Add 2 rows above", "Add 2 rows below"]
	assert labels(vi_insert)[3] == "Add 2 columns left"
	vi_insert.keyboard.press("Escape")
