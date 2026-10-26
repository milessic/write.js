"""
Navigation: the document search tray in the top bar, the document's menu (moved from the main menu), Theme in Settings,
the notebook's data in Account, floating headings and the floating title in focus mode (floatingheadings.js), the
Settings search, the modals' close button staying in sight, and resizing the documents and the contents splitting a place.
"""
import pytest

pytest.importorskip("playwright")

RECT = """(selector) => {
	const r = document.querySelector(selector).getBoundingClientRect();
	return {top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height};
}"""

LONG = "".join(f"<h1>Part {i}</h1>" + "".join(f"<h2>Part {i} chapter {j}</h2>" + "<div>text</div>" * 25 for j in range(3)) for i in range(3))


@pytest.fixture
def app(browser, server):
	context = browser.new_context(viewport={"width": 1400, "height": 900})
	page = context.new_page()
	page.errors = []
	page.on("pageerror", lambda e: page.errors.append(str(e)))
	page.goto(server)
	page.evaluate("""(long) => {
		localStorage.clear();
		localStorage.setItem("__userConsent__", "1");
		localStorage.setItem("__doc__notes", "<h2>One</h2><div>text</div>");
		localStorage.setItem("__doc__long", long);
		localStorage.setItem("__doc__other", "<div>other</div>");
		localStorage.setItem("__lastOpened__", "notes");
	}""", LONG)
	page.reload()
	page.wait_for_function("getActiveTab()?.name === 'notes'")
	yield page
	assert page.errors == []
	context.close()


def rect(page, selector):
	return page.evaluate(RECT, selector)


# top bar
def test_documents_button_is_gone(app):
	assert app.locator("#open-btn").count() == 0
	assert app.is_visible("#doc-search-btn")


def test_document_search_tray(app):
	app.click("#doc-search-btn")
	assert app.is_visible("#doc-search-tray")
	assert app.evaluate("document.activeElement.id") == "doc-search-input"
	assert app.locator("#doc-search-list .tree-document").count() == 3
	app.keyboard.type("oth")
	assert app.locator("#doc-search-list .tree-document").count() == 1
	app.keyboard.press("Enter")
	assert app.evaluate("getActiveTab().name") == "other"
	assert not app.is_visible("#doc-search-tray")
	# a click on a document opens it too, Esc closes the tray
	app.click("#doc-search-btn")
	app.click("#doc-search-list .tree-document[data-name='long']")
	assert app.evaluate("getActiveTab().name") == "long"
	assert not app.is_visible("#doc-search-tray")
	app.click("#doc-search-btn")
	app.keyboard.press("Escape")
	assert not app.is_visible("#doc-search-tray")


# menus
def test_document_options_left_the_main_menu(app):
	for id in ["find-btn", "export-btn-menu", "generate-md", "copy-md", "insert-or-append-markdown", "theme-btn",
			"backup-btn", "restore-btn", "clearall-btn", "themes-attribution"]:
		assert app.locator(f"#menu #{id}").count() == 0


def test_document_menu_on_a_tab(app):
	app.evaluate("loadDocumentFromLocalStorage('other')")
	# the menu of a tab that isn't the focused one acts on its document
	app.click(".tab:has-text('notes')", button="right")
	for label in ["Search in Document", "Export", "Export as Markdown", "Copy as Markdown", "Insert or Append Markdown", "Insert or Append HTML"]:
		assert app.locator(f"#context-menu button:text-is('{label}')").count() == 1
	app.click("#context-menu button:text-is('Search in Document')")
	assert app.evaluate("getActiveTab().name") == "notes"
	assert app.is_visible("#find-bar")


def test_document_menu_on_the_name(app):
	app.click("#doc-name", button="right")
	with app.expect_download() as download:
		app.click("#context-menu button:text-is('Export as Markdown')")
	assert "One" in open(download.value.path(), encoding="utf-8").read()


def test_theme_is_in_settings(app):
	app.click("#hamburger-button")
	app.click("#settings-btn")
	assert app.locator("#modal h3:text-is('Theme')").count() == 1
	assert app.locator("#modal #theme-picker").count() == 1


def test_notebook_data_is_in_account(app):
	app.click("#hamburger-button")
	app.click("#account-btn")
	for id in ["backup-btn", "restore-btn", "clearall-btn"]:
		assert app.is_visible(f"#modal #{id}")


def test_formatting_toolbar_is_a_setting(app):
	assert app.locator("#menu #toggle-format-btn").count() == 0
	app.click("#hamburger-button")
	app.click("#settings-btn")
	app.uncheck("#setting-formatting-bar")
	assert not app.is_visible("#sub-bar")
	assert app.evaluate("localStorage.getItem('__formattingBar__')") == "0"
	# remembered
	app.reload()
	app.wait_for_function("getActiveTab()?.name === 'notes'")
	assert not app.is_visible("#sub-bar")
	app.evaluate("localStorage.removeItem('__formattingBar__'); applyFormattingBarSetting()")
	assert app.is_visible("#sub-bar")


# Settings
def test_settings_search(app):
	app.click("#hamburger-button")
	app.click("#settings-btn")
	assert app.evaluate("document.activeElement.id") == "settings-search"
	app.keyboard.type("spell")
	assert app.is_visible("#setting-spellcheck")
	assert not app.is_visible("#setting-autosave")
	assert not app.is_visible("#setting-vi-mode")
	# a section's title shows all of it
	app.fill("#settings-search", "vi mode")
	assert app.is_visible("#setting-vi-mode") and app.is_visible("#setting-vi-wrap")
	app.fill("#settings-search", "zzzz")
	assert app.is_visible(".settings-empty")
	app.fill("#settings-search", "")
	assert app.is_visible("#setting-autosave") and app.is_visible("#setting-vi-mode")


def test_modal_close_stays_in_sight(app):
	app.click("#hamburger-button")
	app.click("#settings-btn")
	app.evaluate("document.querySelector('#modal .modal-content').scrollTop = 100000")
	modal, close = rect(app, "#modal"), rect(app, "#modal .section-head .small-btn")
	assert close["top"] >= modal["top"] and close["bottom"] <= modal["top"] + 120
	app.click("#modal .section-head .small-btn")
	assert app.locator("#modal").count() == 0


# floating headings
def scroll_long(app, top):
	app.evaluate("loadDocumentFromLocalStorage('long')")
	app.evaluate("(top) => document.querySelector('.editor-pane.focused .pane-scroll').scrollTop = top", top)
	app.wait_for_timeout(100)


def floating(app):
	return app.evaluate("[...document.querySelectorAll('.editor-pane.focused .floating-heading')].map(b => b.textContent)")


@pytest.mark.parametrize("mode, expected", [
	("off", []),
	("all", ["Part 1", "Part 1 chapter 1"]),
	("highest", ["Part 1"]),
	("lowest", ["Part 1 chapter 1"]),
])
def test_floating_headings(app, mode, expected):
	app.evaluate("(mode) => localStorage.setItem('__floatingHeadings__', JSON.stringify({desktop: mode, mobile: 'off', tablet: 'off'}))", mode)
	app.evaluate("loadDocumentFromLocalStorage('long')")
	# into the second chapter of the second part
	top = app.evaluate("""() => {
		const h = [...document.querySelectorAll('#editor h2')].find(h => h.textContent === 'Part 1 chapter 1');
		const scroller = h.closest('.pane-scroll');
		return h.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop + 200;
	}""")
	scroll_long(app, top)
	assert floating(app) == expected
	assert app.is_visible(".editor-pane.focused .floating-headings-inner") == bool(expected)


def test_floating_headings_per_screen(app):
	app.evaluate("localStorage.setItem('__floatingHeadings__', JSON.stringify({desktop: 'off', tablet: 'all', mobile: 'off'}))")
	scroll_long(app, 3000)
	assert floating(app) == []
	app.set_viewport_size({"width": 800, "height": 900})
	app.wait_for_timeout(100)
	assert len(floating(app)) == 2


def test_floating_heading_click_goes_to_it(app):
	app.evaluate("localStorage.setItem('__floatingHeadings__', JSON.stringify({desktop: 'highest'}))")
	scroll_long(app, 3000)
	app.click(".editor-pane.focused .floating-heading")
	app.wait_for_timeout(800)
	assert floating(app) != ["Part 1"] or app.evaluate("document.querySelector('.editor-pane.focused .pane-scroll').scrollTop") < 3000


def test_floating_headings_setting(app):
	app.click("#hamburger-button")
	app.click("#settings-btn")
	app.check("input[name='setting-floating-desktop'][value='lowest']")
	assert app.evaluate("JSON.parse(localStorage.getItem('__floatingHeadings__')).desktop") == "lowest"


def test_focus_mode_title_floats(app):
	app.evaluate("toggleFocusMode(true)")
	app.wait_for_timeout(100)
	assert app.inner_text(".editor-pane.focused .floating-title") == "notes"
	app.evaluate("toggleFocusMode(false)")
	app.wait_for_timeout(100)
	assert app.locator(".editor-pane.focused .floating-title").count() == 0
	# turned off in Settings
	app.evaluate("localStorage.setItem('__focusTitle__', '0'); toggleFocusMode(true)")
	app.wait_for_timeout(100)
	assert app.locator(".editor-pane.focused .floating-title").count() == 0
	app.evaluate("toggleFocusMode(false)")


# split place
@pytest.mark.parametrize("tree_side", ["left", "top"])
def test_split_place_resizes_between_the_panels(app, tree_side):
	app.evaluate(f"openTableOfContents(); setTreeSide('{tree_side}'); setTocSide('split')")
	rows = tree_side == "left"
	tree_before = rect(app, "#file-tree")
	edge = rect(app, "#split-resizer")
	x, y = edge["left"] + edge["width"] / 2, edge["top"] + edge["height"] / 2
	app.mouse.move(x, y)
	app.mouse.down()
	app.mouse.move(x + (0 if rows else 80), y + (80 if rows else 0), steps=5)
	app.mouse.up()
	tree = rect(app, "#file-tree")
	size, before = (tree["height"], tree_before["height"]) if rows else (tree["width"], tree_before["width"])
	assert size == pytest.approx(before + 80, abs=4)
	assert app.evaluate("Number(localStorage.getItem('__tocSplit__'))") > .5
	# a double click shares the place evenly again
	app.dblclick("#split-resizer")
	tree, toc = rect(app, "#file-tree"), rect(app, "#toc-panel")
	assert (tree["height"] if rows else tree["width"]) == pytest.approx(toc["height"] if rows else toc["width"], abs=8)
