"""
Checklists and the clipboard (checklist.js): copied checklist items are Markdown text ("- [ ] a", "- [x] a"), and
Markdown checklist lines ("- [ ]", "- []", "- [x]") pasted outside of a list become a checklist.
"""
import pytest

pytest.importorskip("playwright")

HTML = "document.getElementById('editor').innerHTML"


@pytest.fixture
def app(browser, server):
	context = browser.new_context(viewport={"width": 1400, "height": 900}, permissions=["clipboard-read", "clipboard-write"])
	page = context.new_page()
	page.errors = []
	page.on("pageerror", lambda e: page.errors.append(str(e)))
	page.goto(server)
	page.evaluate("""() => {
		localStorage.clear();
		localStorage.setItem("__userConsent__", "1");
		localStorage.setItem("__doc__notes", "<div>x</div>");
		localStorage.setItem("__lastOpened__", "notes");
	}""")
	page.reload()
	page.wait_for_function("getActiveTab()?.name === 'notes'")
	yield page
	assert page.errors == []
	context.close()


def load(app, html):
	app.evaluate("(html) => { document.getElementById('editor').innerHTML = html }", html)


def select_all(app):
	app.evaluate("""() => {
		const editor = document.getElementById("editor");
		editor.focus();
		getSelection().selectAllChildren(editor);
	}""")


def clipboard_text(app):
	return app.evaluate("navigator.clipboard.readText()")


def paste(app, text):
	app.evaluate("(text) => navigator.clipboard.writeText(text)", text)
	app.keyboard.press("Control+v")


def test_copy_checklist_as_markdown(app):
	load(app, '<div>Todo</div><ul><li data-checked="true">done</li><li data-checked="false">open</li>'
		'<ul><li data-checked="false">nested</li><li>bullet</li></ul></ul>')
	select_all(app)
	app.keyboard.press("Control+c")
	assert clipboard_text(app) == "Todo\n- [x] done\n- [ ] open\n    - [ ] nested\n    - bullet"


def test_copy_part_of_a_nested_checklist(app):
	load(app, '<ul><li data-checked="false">a</li><ul><li data-checked="true">b</li><li data-checked="false">c</li></ul></ul>')
	app.evaluate("""() => {
		const [, b, c] = document.querySelectorAll("#editor li");
		document.getElementById("editor").focus();
		getSelection().setBaseAndExtent(b.firstChild, 0, c.firstChild, 1);
	}""")
	app.keyboard.press("Control+c")
	assert clipboard_text(app) == "- [x] b\n- [ ] c"


def test_paste_markdown_checklist_into_a_line(app):
	load(app, "<div><br></div>")
	app.evaluate("""() => {
		const line = document.querySelector("#editor div");
		document.getElementById("editor").focus();
		getSelection().collapse(line, 0);
	}""")
	paste(app, "- [x] done\n- [] empty\n- [ ] open\n    - [X] nested")
	items = app.evaluate("[...document.querySelectorAll('#editor li')].map((li) => [li.textContent, li.dataset.checked])")
	assert items == [["done", "true"], ["empty", "false"], ["open", "false"], ["nested", "true"]]
	assert app.evaluate("document.querySelectorAll('#editor ul ul').length") == 1


def test_plain_list_paste_outside_a_list_is_left_alone(app):
	load(app, "<div><br></div>")
	app.evaluate("""() => {
		document.getElementById("editor").focus();
		getSelection().collapse(document.querySelector("#editor div"), 0);
	}""")
	paste(app, "- a\n- b")
	assert app.evaluate("document.querySelectorAll('#editor li[data-checked]').length") == 0


def test_copy_then_paste_round_trip(app):
	load(app, '<ul><li data-checked="true">one</li><li data-checked="false">two</li></ul><div><br></div>')
	app.evaluate("""() => {
		const [one, two] = document.querySelectorAll("#editor li");
		document.getElementById("editor").focus();
		getSelection().setBaseAndExtent(one.firstChild, 0, two.firstChild, 3);
	}""")
	app.keyboard.press("Control+c")
	app.evaluate("""() => getSelection().collapse(document.querySelector("#editor > div"), 0)""")
	app.keyboard.press("Control+v")
	items = app.evaluate("[...document.querySelectorAll('#editor li')].map((li) => [li.textContent, li.dataset.checked])")
	assert items == [["one", "true"], ["two", "false"], ["one", "true"], ["two", "false"]]
