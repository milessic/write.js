"""
Scripts API createNotification() (scriptapi.js, scripting.js formatScriptText): "\\n" starts a new line, **text** is bold,
*text* italic and [text](link) a link: a url as it is, anything else a document's id, a link to that document when there
is one, else a link to nowhere. Everything else stays plain text.
"""
import pytest

pytest.importorskip("playwright")

from tests.e2e.test_scripting import app  # noqa: F401


def body(page, text):
	# the html of a script's notification text
	return page.evaluate("""(text) => {
		document.querySelectorAll(".notification-container").forEach((n) => n.remove());
		const note = scriptApi(document.getElementById("editor")).createNotification(text, "info", 0);
		return note.querySelector(".notification-text > div:nth-child(2)").innerHTML;
	}""", text)


def test_new_lines_bold_and_italic(app):
	assert body(app, "one\ntwo") == "one<br>two"
	assert body(app, "a **bold** and *italic* word") == "a <strong>bold</strong> and <em>italic</em> word"
	assert body(app, "**bold *italic* inside**") == "<strong>bold <em>italic</em> inside</strong>"
	assert body(app, "2 * 3 * 4") == "2 * 3 * 4"
	assert body(app, "*a*") == "<em>a</em>"


def test_html_stays_text(app):
	assert body(app, "<b>x</b> & **<i>y</i>**") == "&lt;b&gt;x&lt;/b&gt; &amp; <strong>&lt;i&gt;y&lt;/i&gt;</strong>"


def test_url_links(app):
	html = body(app, "see [the site](https://example.com/a?b=1&c=*2*)")
	assert html == 'see <a href="https://example.com/a?b=1&amp;c=*2*" target="_blank" rel="noopener noreferrer">the site</a>'
	# not a url: a document's id
	assert 'href=""' in body(app, "[x](javascript:alert)")


def test_document_id_links(app):
	doc_id = app.evaluate("documentIdOf('plan')")
	html = body(app, f"open [**plan**]({doc_id})")
	assert html == f'open <a href="?doc={doc_id}" data-doc-id="{doc_id}" title="plan"><strong>plan</strong></a>'
	# no such document: a link to nowhere, a click does nothing
	assert body(app, "[gone](no-such-id)") == '<a href="" class="script-link-missing" title="No document with this id">gone</a>'
	url = app.url
	app.locator("#notifications-container a.script-link-missing").click()
	assert app.url == url


def test_document_link_opens_it(app):
	app.evaluate("localStorage.setItem('__doc__other', withDocumentId('<div>other</div>', newDocumentId()))")
	doc_id = app.evaluate("documentIdOf('other')")
	body(app, f"[other]({doc_id})")
	app.locator("#notifications-container a[data-doc-id]").click()
	app.wait_for_function("getActiveTab()?.name === 'other'")
