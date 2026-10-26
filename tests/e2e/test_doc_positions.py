"""
Positions (workspace.js): every opened document remembers its scroll and caret, across switching documents and
reloads; closing its tab forgets them.
"""
import json

import pytest

pytest.importorskip("playwright")

LONG = "".join(f"<div>line {i}</div>" for i in range(200))


@pytest.fixture
def docs(page):
	page.evaluate("""(html) => {
		localStorage.setItem("__doc__long", html);
		localStorage.setItem("__doc__short", "<div>short</div>");
	}""", LONG)
	yield page
	page.evaluate("""() => {
		for ( const name of ["long", "short"] ) { tabs.filter(t => t.name === name).forEach(t => { t.dirty = false; closeTab(t.id) }) }
		localStorage.removeItem("__doc__long");
		localStorage.removeItem("__doc__short");
		openDocumentInTab("test");
	}""")


def put_caret(page, line):
	page.evaluate("""(line) => {
		const text = document.getElementById("editor").children[line].firstChild;
		getSelection().collapse(text, 3);
	}""", line)


def scroll(page):
	return page.evaluate("document.getElementById('editor').closest('.pane-scroll').scrollTop")


def caret_line(page):
	return page.evaluate("getSelection().focusNode.textContent")


def test_switching_documents_keeps_the_position(docs):
	docs.evaluate("openDocumentInTab('long')")
	put_caret(docs, 150)
	docs.evaluate("document.getElementById('editor').closest('.pane-scroll').scrollTop = 2500")
	docs.evaluate("openDocumentInTab('short')")
	assert scroll(docs) == 0
	docs.evaluate("openDocumentInTab('long')")
	assert scroll(docs) == 2500
	assert caret_line(docs) == "line 150"


def test_kept_across_reloads_and_forgotten_on_close(docs):
	docs.evaluate("openDocumentInTab('long')")
	put_caret(docs, 120)
	docs.evaluate("document.getElementById('editor').closest('.pane-scroll').scrollTop = 1800")
	docs.wait_for_timeout(700)
	saved = json.loads(docs.evaluate("localStorage.getItem('__docPositions__')"))
	assert saved["long"]["scroll"] == 1800
	docs.reload()
	docs.wait_for_function("window.WriteVi")
	docs.wait_for_timeout(100)
	assert scroll(docs) == 1800
	assert caret_line(docs) == "line 120"
	docs.evaluate("closeTab(getActiveTab().id)")
	assert "long" not in json.loads(docs.evaluate("localStorage.getItem('__docPositions__')"))
	docs.evaluate("openDocumentInTab('long')")
	assert scroll(docs) == 0
