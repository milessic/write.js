"""
The document's metadata widget (workspace.js): a compact pop-up from the document's menus (tab, editor head, tree) with
its title and scripts switches, its owner and authors and its id. Several documents selected in the tree are changed
together: what differs between them is left as it is unless it is changed. A logged in user saving a document becomes
its owner when it has none, and one of its authors.
"""
import pytest

pytest.importorskip("playwright")

from tests.e2e.test_doc_title import app, stored_meta, TITLE  # noqa: F401

WIDGET = ".metadata-widget"


def open_from_tab(page):
	page.locator("#tabs .tab.active").click(button="right")
	page.locator("#context-menu button", has_text="Document metadata").click()
	return page.locator(WIDGET)


def field(page, key):
	return page.locator(f'{WIDGET} [data-meta="{key}"]')


def test_one_compact_menu_item_instead_of_the_toggles(app):
	app.locator("#tabs .tab.active").click(button="right")
	labels = app.locator("#context-menu button").all_text_contents()
	assert "Document metadata" in labels
	assert not any(label in labels for label in ["Show title", "Hide title", "Enable scripts", "Disable scripts"])
	app.keyboard.press("Escape")


def test_widget_edits_title_scripts_owner_and_authors(app):
	widget = open_from_tab(app)
	assert widget.is_visible()
	assert app.locator(f"{WIDGET} .metadata-name").text_content() == "plan"
	assert len(app.locator(f"{WIDGET} .metadata-id code").text_content()) == 36
	field(app, "showTitle").check()
	field(app, "scripts").check()
	field(app, "owner").fill("alice")
	field(app, "authors").fill("alice, bob,  , bob")
	app.click(f"{WIDGET} .metadata-save")
	assert not widget.is_visible()
	assert app.locator(TITLE).is_visible()
	assert app.locator("#tb-btn-script").is_visible()
	app.click("#save-btn")
	assert stored_meta(app, "plan") == {"showTitle": True, "scripts": True, "owner": "alice", "authors": ["alice", "bob"]}
	# shown again as saved; emptied, they go
	open_from_tab(app)
	assert field(app, "owner").input_value() == "alice"
	assert field(app, "authors").input_value() == "alice, bob"
	assert field(app, "showTitle").is_checked()
	field(app, "owner").fill("")
	field(app, "authors").fill("")
	field(app, "owner").press("Enter")
	app.click("#save-btn")
	assert stored_meta(app, "plan") == {"showTitle": True, "scripts": True}


def test_cancel_and_escape_change_nothing(app):
	open_from_tab(app)
	field(app, "owner").fill("alice")
	app.click(f"{WIDGET} .metadata-cancel")
	assert app.locator(WIDGET).count() == 0
	open_from_tab(app)
	field(app, "showTitle").check()
	app.keyboard.press("Escape")
	assert app.locator(WIDGET).count() == 0
	assert not app.locator(TITLE).is_visible()


def test_several_documents_from_the_tree(app):
	app.evaluate("""() => {
		localStorage.setItem("__doc__a", withDocumentId("<div>a</div>", newDocumentId(), {owner: "x", showTitle: true}));
		localStorage.setItem("__doc__b", withDocumentId("<div>b</div>", newDocumentId(), {owner: "y"}));
		refreshFileTree(true);
	}""")
	row = lambda name: app.locator("#file-tree-list .tree-document", has_text=name).first
	row("a").click()
	row("b").click(modifiers=["Control"])
	row("b").click(button="right")
	app.locator("#context-menu button", has_text="Document metadata").click()
	assert app.locator(f"{WIDGET} .metadata-name").text_content() == "2 documents"
	assert field(app, "owner").input_value() == ""
	assert field(app, "owner").get_attribute("placeholder") == "Several values"
	assert field(app, "showTitle").evaluate("el => el.indeterminate")
	# only what was changed changes
	field(app, "authors").fill("carol")
	app.click(f"{WIDGET} .metadata-save")
	# a document opened in a tab is changed there (unsaved), the other one where it is stored
	assert app.evaluate("storedDocumentMeta('a')") == {"owner": "x", "showTitle": True, "authors": ["carol"]}
	assert app.evaluate("storedDocumentMeta('b')") == {"owner": "y", "authors": ["carol"]}


def test_a_logged_in_user_becomes_owner_and_author(app):
	app.evaluate("document.body.dataset.user = 'dave'")
	app.click("#save-btn")
	assert stored_meta(app, "plan") == {"owner": "dave", "authors": ["dave"]}
	open_from_tab(app)
	field(app, "owner").fill("erin")
	app.click(f"{WIDGET} .metadata-save")
	app.click("#save-btn")
	assert stored_meta(app, "plan") == {"owner": "erin", "authors": ["dave"]}
	app.evaluate("delete document.body.dataset.user")
