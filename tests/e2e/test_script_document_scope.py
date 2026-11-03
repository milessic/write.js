"""
A script only reaches its own document (scripting.js scriptDocument / scriptGlobals): document's queries look inside the
editor, document.body is the editor, window / globalThis / self have that document too; the page's globals (setTimeout,
Promise...) still work. Other editors and the app's UI aren't touched.
"""
import pytest

pytest.importorskip("playwright")

from tests.e2e.test_scripting import app  # noqa: F401

DOC = ('<div data-element-id="intro">intro</div><table><tbody><tr><td>a</td></tr><tr><td>b</td></tr></tbody></table>'
	'<div id="own">own</div>')


def run(page, code):
	return page.evaluate("""async (code) => {
		const editor = document.getElementById("editor");
		const run = await executeScript(editor, code);
		return run.ok ? run.result : "error: " + (run.error?.message ?? run.error);
	}""", code)


@pytest.fixture
def doc(app):
	app.evaluate("(html) => { document.getElementById('editor').innerHTML = html }", DOC)
	return app


def test_queries_only_find_the_document(doc):
	# a table of the app's UI outside the editor
	doc.evaluate("document.body.insertAdjacentHTML('beforeend', '<table id=\"outside\"><tr><td>x</td></tr></table>')")
	run(doc, 'document.querySelectorAll("tr").forEach((e) => { e.style.backgroundColor = "red" })')
	assert doc.evaluate("[...document.querySelectorAll('#editor tr')].every((tr) => tr.style.backgroundColor === 'red')")
	assert doc.evaluate("document.querySelector('#outside tr').style.backgroundColor") == ""
	assert doc.evaluate("[...document.querySelectorAll('.topbar *, .tab-bar *, #sub-bar *')].every((el) => !el.style.backgroundColor)")


def test_document_and_window(doc):
	assert run(doc, "return document.querySelectorAll('td').length") == "2"
	assert run(doc, "return document.getElementById('intro').textContent") == "intro"
	assert run(doc, "return document.getElementById('own').textContent") == "own"
	assert run(doc, "return document.getElementById('save-btn')") == "null"
	assert run(doc, "return document.querySelector('#save-btn')") == "null"
	assert run(doc, "return document.body === editor") == "true"
	assert run(doc, "return window.document === document && globalThis.document === document && self.window.document === document") == "true"
	assert run(doc, "return typeof document.cookie") == "undefined"
	assert run(doc, "return window.document.getElementById('tabs')") == "null"


def test_page_globals_still_work(doc):
	assert run(doc, "await new Promise((resolve) => window.setTimeout(resolve, 10)); return 'waited'") == "waited"
	assert run(doc, "const el = document.createElement('b'); el.textContent = 'new'; editor.append(el); return editor.lastChild.outerHTML") == "<b>new</b>"
	assert run(doc, "return JSON.stringify([1].map((n) => n + 1))") == "[2]"


def test_reaching_around_is_refused(doc):
	assert doc.evaluate("checkScriptCode('return editor.ownerDocument')").endswith("the page around the document can't be reached")
	assert doc.evaluate("checkScriptCode('return editor.getRootNode()')").endswith("the page around the document can't be reached")
