"""
A rule (---) is as tall as a line of text and drawn across its middle; a collapsed heading whose section starts with
a rule still shows the rule, drawn under the heading where it was (no element the caret could go to).
"""
import pytest

pytest.importorskip("playwright")

DOC = "<h2>Open</h2><hr><div>text</div><h2 data-collapsed=\"true\">Folded</h2><hr><div>hidden</div><h2>Next</h2>"


@pytest.fixture
def app(browser, server):
	context = browser.new_context(viewport={"width": 1400, "height": 900})
	page = context.new_page()
	page.errors = []
	page.on("pageerror", lambda e: page.errors.append(str(e)))
	page.goto(server)
	page.evaluate("""(doc) => {
		localStorage.clear();
		localStorage.setItem("__userConsent__", "1");
		localStorage.setItem("__doc__rules", doc);
		localStorage.setItem("__lastOpened__", "rules");
	}""", DOC)
	page.reload()
	page.wait_for_function("getActiveTab()?.name === 'rules'")
	yield page
	assert page.errors == []
	context.close()


def test_rule_is_as_tall_as_a_line(app):
	heights = app.evaluate("""() => {
		const editor = document.getElementById("editor");
		return [editor.querySelector("hr").getBoundingClientRect().height, editor.querySelector("div").getBoundingClientRect().height];
	}""")
	assert heights[0] == pytest.approx(heights[1], abs=1)


def test_folded_heading_draws_its_rule_where_it_was(app):
	offsets = app.evaluate("""() => {
		const [open, folded] = document.querySelectorAll("#editor > h2");
		const hr = open.nextElementSibling.getBoundingClientRect();
		const rect = folded.getBoundingClientRect();
		const style = getComputedStyle(folded);
		const fromBottom = parseFloat(style.backgroundPositionY.match(/[\\d.]+px/)[0]);
		return {
			open: hr.top + hr.height / 2 - open.getBoundingClientRect().top,
			folded: rect.height - fromBottom,
			hidden: getComputedStyle(folded.nextElementSibling).display,
		};
	}""")
	assert offsets["hidden"] == "none"
	assert offsets["folded"] == pytest.approx(offsets["open"], abs=1)


def test_typed_rule_is_a_line_of_its_own_and_folds_with_its_heading(app):
	# --- typed on the line under a heading used to end up inside that line: <div><hr><div>text</div></div>
	app.evaluate("""() => {
		const editor = document.getElementById("editor");
		editor.innerHTML = "<div><br></div>";
		editor.focus();
		getSelection().collapse(editor.firstChild, 0);
	}""")
	app.keyboard.type("# h1")
	app.keyboard.press("Enter")
	app.keyboard.type("---")
	app.keyboard.type("some text")
	assert app.evaluate("document.getElementById('editor').innerHTML") == "<h1>h1</h1><hr><div>some text</div>"
	app.evaluate("toggleHeadingFold(document.querySelector('#editor h1'))")
	assert app.evaluate("getComputedStyle(document.querySelector('#editor h1')).backgroundImage") != "none"


def test_rule_inside_a_saved_line_is_lifted_when_loaded(browser, server):
	context = browser.new_context()
	page = context.new_page()
	page.goto(server)
	page.evaluate("""() => {
		localStorage.clear();
		localStorage.setItem("__userConsent__", "1");
		localStorage.setItem("__doc__old", "<h1>h1</h1><div><hr><div>some text</div></div>");
		localStorage.setItem("__lastOpened__", "old");
	}""")
	page.reload()
	page.wait_for_function("getActiveTab()?.name === 'old'")
	assert page.evaluate("document.getElementById('editor').innerHTML") == "<h1>h1</h1><hr><div>some text</div>"
	context.close()


CHECKLIST = '<h2>heading</h2><hr><div><br></div><ul><li data-checked="false">checkbox</li><li data-checked="false">list</li></ul>'
AFTER = '<h2>heading</h2><hr><ul><li data-checked="false">checkbox</li><li data-checked="false">list</li></ul>'


def load(app, html, caret):
	app.evaluate("""([html, caret]) => {
		const editor = document.getElementById("editor");
		editor.innerHTML = html;
		editor.focus();
		const node = eval(caret);
		getSelection().collapse(node, 0);
	}""", [html, caret])


def test_backspace_before_a_checklist_removes_the_empty_line_under_a_rule(app):
	# the empty line's <br> used to go into the checklist item: an empty checkbox with the text under it
	load(app, CHECKLIST, "editor.querySelector('li').firstChild")
	app.keyboard.press("Backspace")
	assert app.evaluate("document.getElementById('editor').innerHTML") == AFTER
	assert app.evaluate("getSelection().focusNode.textContent") == "checkbox"
	app.keyboard.press("Control+z")
	app.keyboard.press("Control+z")
	assert app.evaluate("document.getElementById('editor').innerHTML") == CHECKLIST


def test_delete_on_the_empty_line_under_a_rule(app):
	load(app, CHECKLIST, "editor.querySelector('div')")
	app.keyboard.press("Delete")
	assert app.evaluate("document.getElementById('editor').innerHTML") == AFTER
	load(app, "<h2>heading</h2><hr><div><br></div><h3>next</h3>", "editor.querySelector('div')")
	app.keyboard.press("Delete")
	assert app.evaluate("document.getElementById('editor').innerHTML") == "<h2>heading</h2><hr><h3>next</h3>"


def test_rule_is_one_character(app):
	# the caret gets on the rule with the arrow keys: typing doesn't go in, Backspace takes the rule
	load(app, "<h2>heading</h2><hr><div>text</div>", "editor.querySelector('h2').firstChild")
	app.keyboard.press("End")
	app.keyboard.press("ArrowDown")
	app.keyboard.type("Z")
	assert app.evaluate("document.getElementById('editor').innerHTML") == "<h2>heading</h2><hr><div>text</div>"
	app.keyboard.press("Backspace")
	assert app.evaluate("document.getElementById('editor').innerHTML") == "<h2>heading</h2><div>text</div>"


def test_backspace_and_delete_next_to_a_rule_take_it(app):
	load(app, '<h2>heading</h2><hr><ul><li data-checked="false">a</li></ul>', "editor.querySelector('li').firstChild")
	app.keyboard.press("Backspace")
	assert app.evaluate("document.getElementById('editor').innerHTML") == '<h2>heading</h2><ul><li data-checked="false">a</li></ul>'
	load(app, '<h2>heading</h2><hr><h3>next</h3>', "editor.querySelector('h2').firstChild")
	app.keyboard.press("End")
	app.keyboard.press("Delete")
	assert app.evaluate("document.getElementById('editor').innerHTML") == "<h2>heading</h2><h3>next</h3>"
