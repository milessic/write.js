"""
Links between documents (doclinks.js): every stored document starts with a hidden div holding its id, the editors
don't show it, and a link picked in Insert Link > Write.JS doc opens the document's tab, or a new one.
"""
import re

import pytest

pytest.importorskip("playwright")

ID_DIV = re.compile(r'^<div style="display:none;" data-id="([0-9a-f-]{36})"></div>')


@pytest.fixture
def app(browser, server):
	# its own page: the documents and their ids are set up before the app loads
	context = browser.new_context(viewport={"width": 1400, "height": 900})
	page = context.new_page()
	page.errors = []
	page.on("pageerror", lambda e: page.errors.append(str(e)))
	page.goto(server)
	page.evaluate("""() => {
		localStorage.clear();
		localStorage.setItem("__userConsent__", "1");
		localStorage.setItem("__doc__first", "<div>first text</div>");
		localStorage.setItem("__doc__second", "<div>second text</div>");
		localStorage.setItem("__lastOpened__", "first");
	}""")
	page.reload()
	page.wait_for_function("getActiveTab()?.name === 'first'")
	yield page
	assert page.errors == []
	context.close()


def stored(page, name):
	return page.evaluate("(name) => localStorage.getItem('__doc__' + name)", name)


def stored_id(page, name):
	match = ID_DIV.match(stored(page, name))
	assert match, stored(page, name)
	return match.group(1)


def tab_names(page):
	return page.evaluate("tabs.map(t => t.name)")


def insert_doc_link(page, doc, text=""):
	page.click("#editor")
	page.keyboard.press("End")
	page.click("#tb-btn-link")
	page.fill("#link-name", text)
	page.fill("#link-doc", doc)
	page.click(".insert-link-modal .btn.primary")


def test_documents_get_ids_the_editor_doesnt_show(app):
	first, second = stored_id(app, "first"), stored_id(app, "second")
	assert first != second
	assert "data-id" not in app.inner_html("#editor")
	# a document from before the ids gets the same one on every device
	assert first == app.evaluate("legacyDocumentId('first')")


def test_saving_keeps_the_id_and_renaming_too(app):
	first = stored_id(app, "first")
	app.click("#editor")
	app.keyboard.type("more ")
	app.click("#save-btn")
	assert stored_id(app, "first") == first
	assert stored(app, "first").count("data-id") == 1
	app.fill("#doc-name", "renamed")
	app.click("#save-btn")
	assert stored(app, "first") is None
	assert stored_id(app, "renamed") == first


def test_new_document_gets_a_new_id(app):
	app.evaluate("createNewDocument()")
	app.fill("#doc-name", "third")
	app.click("#editor")
	app.keyboard.type("third text")
	app.click("#save-btn")
	assert stored_id(app, "third") not in (stored_id(app, "first"), stored_id(app, "second"))


def test_link_opens_a_new_tab_then_the_existing_one(app):
	second = stored_id(app, "second")
	insert_doc_link(app, "second")
	link = app.locator("#editor a[data-doc-id]")
	assert link.get_attribute("data-doc-id") == second
	assert link.inner_text() == "second"
	assert "url" not in (link.get_attribute("href") or "")
	app.click("#save-btn")
	assert f'data-doc-id="{second}"' in stored(app, "first")

	app.click("#editor a[data-doc-id]")
	assert app.evaluate("getActiveTab().name") == "second"
	assert tab_names(app) == ["first", "second"]
	assert "second text" in app.inner_text("#editor")

	# back on the first one, its link goes to the opened tab rather than a new one
	app.locator(".tab", has_text="first").click()
	app.click("#editor a[data-doc-id]")
	assert app.evaluate("getActiveTab().name") == "second"
	assert tab_names(app) == ["first", "second"]


def test_link_follows_a_renamed_document(app):
	insert_doc_link(app, "second", "go there")
	assert app.inner_text("#editor a[data-doc-id]") == "go there"
	app.click("#save-btn")
	app.evaluate("loadDocumentFromLocalStorage('second')")
	app.fill("#doc-name", "moved")
	app.click("#save-btn")
	app.evaluate("closeTab(getActiveTab().id)")
	app.locator(".tab", has_text="first").click()
	app.click("#editor a[data-doc-id]")
	assert app.evaluate("getActiveTab().name") == "moved"


def test_unknown_document_is_not_linked(app):
	insert_doc_link(app, "nope")
	assert app.locator("#editor a").count() == 0
	assert app.locator(".insert-link-modal").count() == 1
