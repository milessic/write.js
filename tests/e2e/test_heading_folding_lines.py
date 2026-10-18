"""
Heading folding (folding.js) of headings that ended up inside a line <div>: they move up to the editor when the
document loads or the heading is made (moveHeadingsOutOfLines, script.js), so every heading folds.
"""
import pytest

pytest.importorskip("playwright")

DOC = ('<h3>Regulacja hamulca Side Pull</h3><hr class="heading-break">'
	'<div><ul><li>linka</li><ul><li>śruba</li></ul></ul><div><br></div><h3>Składam Fixed Gear</h3></div>'
	'<div><br></div><div><hr><h3>Rama</h3></div><div>- tsunami SNM100</div><div>- Cinelli? Fuji?</div>'
	'<h3>Koła</h3><div>?</div>'
	'<div><h2>Break</h2><hr class="heading-break"><span>after break</span></div>'
	'<ul><li><h4>in a list</h4></li></ul>')

TOP_HEADINGS = """() => [...document.getElementById("editor").children]
	.filter((el) => /^H[1-4]$/.test(el.nodeName)).map((el) => el.textContent)"""


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
		localStorage.setItem("__doc__bike", doc);
		localStorage.setItem("__lastOpened__", "bike");
	}""", DOC)
	page.reload()
	page.wait_for_function("getActiveTab()?.name === 'bike'")
	yield page
	assert page.errors == []
	context.close()


def test_loaded_headings_move_up_to_the_editor(app):
	assert app.evaluate(TOP_HEADINGS) == ["Regulacja hamulca Side Pull", "Składam Fixed Gear", "Rama", "Koła", "Break"]
	html = app.evaluate("document.getElementById('editor').innerHTML")
	# the lines around them are split, the heading's break stays under it, lists keep their headings
	assert '<div><hr></div><h3>Rama</h3><div>- tsunami SNM100</div>' in html
	assert '<h2>Break</h2><hr class="heading-break"><div><span>after break</span></div>' in html
	assert '<ul><li><h4>in a list</h4></li></ul>' in html


def test_moved_heading_folds_its_section(app):
	app.evaluate("toggleHeadingFold([...document.querySelectorAll('#editor > h3')].find((h) => h.textContent === 'Rama'))")
	hidden = app.evaluate("[...document.querySelectorAll('#editor > .fold-hidden')].map((el) => el.textContent)")
	assert hidden == ["- tsunami SNM100", "- Cinelli? Fuji?"]


def test_heading_made_in_a_nested_line_moves_up(app):
	app.evaluate("""() => {
		const editor = document.getElementById("editor");
		editor.innerHTML = "<div><div>first</div><div>title</div><div>last</div></div>";
		editor.focus();
		const range = document.createRange();
		range.selectNodeContents(editor.firstChild.children[1]);
		getSelection().removeAllRanges();
		getSelection().addRange(range);
		formatBlockWithHeadingBreaks("h3");
	}""")
	assert app.evaluate(TOP_HEADINGS) == ["title"]
