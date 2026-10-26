"""
A list pasted into a list (script.js): its items become items of that list where the caret is, not text in one item.
"""
import pytest

from test_list_folding import HTML, caret, load, undo, vi_insert  # noqa: F401 (fixture)

pytest.importorskip("playwright")

CHECKLIST = '<ul><li data-checked="false">ab</li><li data-checked="false">c</li></ul>'


def paste(page, text, html=None):
	page.evaluate("""async ([text, html]) => {
		const items = { "text/plain": new Blob([text], { type: "text/plain" }) };
		if ( html ) { items["text/html"] = new Blob([html], { type: "text/html" }) }
		await navigator.clipboard.write([new ClipboardItem(items)]);
	}""", [text, html])
	page.keyboard.press("Control+v")


@pytest.mark.parametrize("text", ["- x\n- y", "* x\n* y", "1. x\n2. y", "- [ ] x\n- [ ] y", "\n- x\n\n- y\n"])
def test_text_list_after_the_item(vi_insert, text):
	load(vi_insert, CHECKLIST)
	caret(vi_insert, "ab")
	paste(vi_insert, text)
	assert vi_insert.evaluate(HTML) == ('<ul><li data-checked="false">ab</li><li data-checked="false">x</li>'
		'<li data-checked="false">y</li><li data-checked="false">c</li></ul>')


def test_states_and_nesting_are_kept(vi_insert):
	load(vi_insert, "<ul><li>ab</li></ul>")
	caret(vi_insert, "ab")
	paste(vi_insert, "- [x] x\n    - [ ] x1\n\t- y1\n- y")
	assert vi_insert.evaluate(HTML) == ('<ul><li>ab</li><li data-checked="true">x</li>'
		'<ul><li data-checked="false">x1</li><li>y1</li></ul><li>y</li></ul>')


def test_before_and_splitting_the_item(vi_insert):
	load(vi_insert, CHECKLIST)
	caret(vi_insert, "ab", at_end=False)
	paste(vi_insert, "- x")
	assert vi_insert.evaluate("[...document.querySelectorAll('#editor li')].map((li) => li.textContent)") == ["x", "ab", "c"]
	load(vi_insert, CHECKLIST)
	vi_insert.evaluate("""() => {
		const text = document.querySelector("#editor li").firstChild;
		getSelection().setBaseAndExtent(text, 1, text, 1);
	}""")
	paste(vi_insert, "- x")
	assert vi_insert.evaluate("[...document.querySelectorAll('#editor li')].map((li) => li.textContent)") == ["a", "x", "b", "c"]


def test_html_list_nested_after_its_item(vi_insert):
	load(vi_insert, CHECKLIST)
	caret(vi_insert, "ab")
	paste(vi_insert, "x\nx1\ny", '<meta charset="utf-8"><ul style="color: red"><li><span style="font-weight: 700">x</span>'
		'<ul><li><b>x1</b> <a href="https://e.com/" onclick="alert(1)">link</a></li></ul></li>'
		'<li>y<img src="z" onerror="alert(1)"></li></ul>')
	assert vi_insert.evaluate(HTML) == ('<ul><li data-checked="false">ab</li><li data-checked="false">x</li>'
		'<ul><li data-checked="false"><b>x1</b> <a href="https://e.com/" target="about:blank">link</a></li></ul>'
		'<li data-checked="false">y</li><li data-checked="false">c</li></ul>')


def test_into_an_empty_item(vi_insert):
	load(vi_insert, '<ul><li data-checked="true">a</li><li data-checked="false"><br></li></ul>')
	vi_insert.evaluate("""() => {
		const li = document.querySelectorAll("#editor li")[1];
		li.closest(".editor").focus();
		getSelection().setBaseAndExtent(li, 0, li, 0);
	}""")
	paste(vi_insert, "- x\n- y")
	assert vi_insert.evaluate(HTML) == ('<ul><li data-checked="true">a</li><li data-checked="false">x</li>'
		'<li data-checked="false">y</li></ul>')


def test_one_undo(vi_insert):
	load(vi_insert, CHECKLIST)
	caret(vi_insert, "ab")
	paste(vi_insert, "- x\n    - y")
	undo(vi_insert, 1)
	assert vi_insert.evaluate(HTML) == CHECKLIST


def test_one_line_of_text_is_pasted_as_before(vi_insert):
	load(vi_insert, "<ul><li>ab</li></ul>")
	caret(vi_insert, "ab")
	paste(vi_insert, "plain text")
	assert vi_insert.evaluate(HTML) == "<ul><li>abplain text</li></ul>"


@pytest.mark.parametrize("text, html", [
	("smoke\ntest case\ntest\ntest rail \nclose ", None),
	("smoke\r\ntest case\r\n\r\ntest\ntest rail\nclose\n", None),
	("smoke\ntest case\ntest\ntest rail\nclose", "<div>smoke</div><div>test case</div><div>test</div><div>test rail</div><div>close</div>"),
])
def test_lines_of_text_are_items(vi_insert, text, html):
	load(vi_insert, CHECKLIST)
	caret(vi_insert, "ab")
	paste(vi_insert, text, html)
	assert vi_insert.evaluate(HTML) == ('<ul><li data-checked="false">ab</li>' + "".join(
		f'<li data-checked="false">{line}</li>' for line in ["smoke", "test case", "test", "test rail", "close"])
		+ '<li data-checked="false">c</li></ul>')


def test_lines_of_text_and_list_lines(vi_insert):
	load(vi_insert, "<ul><li>ab</li></ul>")
	caret(vi_insert, "ab")
	paste(vi_insert, "- [x] x\nnot an item\n  - y")
	assert vi_insert.evaluate(HTML) == ('<ul><li>ab</li><li data-checked="true">x</li><li>not an item</li>'
		'<ul><li>y</li></ul></ul>')


def test_outside_a_list_as_before(vi_insert):
	load(vi_insert, "<div>ab</div>")
	vi_insert.evaluate("""() => {
		const text = document.querySelector("#editor div").firstChild;
		document.getElementById("editor").focus();
		getSelection().setBaseAndExtent(text, 2, text, 2);
	}""")
	paste(vi_insert, "- x\n- y")
	assert vi_insert.locator("#editor li").count() == 0
