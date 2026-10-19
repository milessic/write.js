"""
Comments (comments.js): hover a line, click the "+" right of it. They are kept in the line's data-comments, newest first,
shown as plain text; the line gets an icon, red while any comment is unresolved, green when all are resolved.
"""
import json

import pytest

pytest.importorskip("playwright")

DOC = "<div>first line</div><div>second line</div><ul><li>item</li></ul>"


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
		localStorage.setItem("__doc__notes", doc);
		localStorage.setItem("__autosave__", "1");
		localStorage.setItem("__lastOpened__", "notes");
	}""", DOC)
	page.reload()
	page.wait_for_function("getActiveTab()?.name === 'notes'")
	yield page
	assert page.errors == []
	context.close()


def line(app, text):
	return app.locator("#editor").get_by_text(text, exact=True)


def comment(app, text, on):
	# a line without comments has the "+" on hover, one with them its comment icon
	if comments_of(app, on):
		app.locator(".line-comment").nth(commented_lines(app).index(on)).click()
	else:
		line(app, on).hover()
		app.locator(".line-comment-add:visible").click()
	app.fill(".comments-popover .comment-input", text)
	app.click(".comments-popover .comment-add")


def commented_lines(app):
	return app.evaluate("[...document.querySelectorAll('#editor [data-comments]')].map((line) => line.textContent)")


def comments_of(app, text):
	data = line(app, text).get_attribute("data-comments")
	return json.loads(data) if data else []


def test_add_comment_from_the_hover_button(app):
	comment(app, "check this", on="second line")
	[saved] = comments_of(app, "second line")
	assert saved["text"] == "check this"
	assert saved["by"] == "Anonymous"
	assert saved["resolved"] is False
	assert comments_of(app, "first line") == []
	# saved with the document (autosave)
	assert "data-comments" in app.evaluate("localStorage.getItem('__doc__notes')")


def test_comments_are_newest_first_and_plain_text(app):
	comment(app, "<b>older</b>", on="item")
	app.wait_for_timeout(5)
	comment(app, "newer", on="item")
	texts = app.locator(".comments-popover .comment-text").all_inner_texts()
	assert texts == ["newer", "<b>older</b>"]
	assert app.locator(".comments-popover .comment-text b").count() == 0


def test_icon_is_red_until_resolved_by_its_author(app):
	comment(app, "one", on="first line")
	comment(app, "two", on="first line")
	icon = app.locator(".line-comment")
	assert icon.count() == 1
	assert "resolved" not in icon.get_attribute("class")
	app.locator(".comments-popover .comment-resolve").first.click()
	# one still unresolved: red
	assert "resolved" not in icon.get_attribute("class")
	app.locator(".comments-popover .comment-resolve").first.click()
	assert "resolved" in icon.get_attribute("class")
	assert app.locator(".comments-popover .comment-badge").count() == 2


def test_only_the_author_resolves(app):
	app.evaluate("""() => {
		const line = [...document.querySelectorAll("#editor div")].find((d) => d.textContent === "first line");
		line.dataset.comments = JSON.stringify([{id: "x", by: "someone else", date: new Date().toISOString(), text: "theirs", resolved: false}]);
	}""")
	app.locator(".line-comment").click()
	assert app.locator(".comments-popover .comment-text").inner_text() == "theirs"
	assert app.locator(".comments-popover .comment-resolve").count() == 0


def test_enter_keeps_the_comment_on_one_line(app):
	comment(app, "here", on="first line")
	app.keyboard.press("Escape")
	line(app, "first line").click()
	app.keyboard.press("End")
	app.keyboard.press("Enter")
	app.keyboard.type("new")
	assert len(comments_of(app, "first line")) == 1
	assert comments_of(app, "new") == []


def test_right_click_keeps_the_browsers_menu(app):
	# its menu has the spelling suggestions
	prevented = app.evaluate("""() => {
		const line = document.querySelector("#editor div");
		const e = new MouseEvent("contextmenu", {bubbles: true, cancelable: true});
		line.dispatchEvent(e);
		return e.defaultPrevented;
	}""")
	assert not prevented


def test_add_button_only_on_lines_without_comments(app):
	comment(app, "here", on="first line")
	app.click(".comments-popover .comments-close")
	line(app, "first line").hover()
	assert app.locator(".line-comment-add:visible").count() == 0
	line(app, "second line").hover()
	assert app.locator(".line-comment-add:visible").count() == 1


def test_closing_the_comments_keeps_the_scroll(app):
	app.evaluate("""() => {
		const editor = document.getElementById("editor");
		editor.innerHTML = Array.from({length: 120}, (_, i) => `<div>line ${i}</div>`).join("");
		editor.querySelector("div:nth-child(60)").dataset.comments = JSON.stringify([{id: "a", by: "Anonymous", date: new Date().toISOString(), text: "mid", resolved: false}]);
	}""")
	line(app, "line 60").scroll_into_view_if_needed()
	app.locator(".line-comment").click()
	app.fill(".comments-popover .comment-input", "reply")
	app.press(".comments-popover .comment-input", "Control+Enter")
	before = app.evaluate("document.querySelector('.pane-scroll').scrollTop")
	assert before > 0
	app.click(".comments-popover .comments-close")
	assert app.evaluate("document.querySelector('.pane-scroll').scrollTop") == before
