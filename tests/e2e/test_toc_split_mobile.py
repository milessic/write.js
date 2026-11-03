"""
On phones and tablets the table of contents is a tab of the documents drawer, unless the user splits the documents'
place with it (toc.js): then the drawer holds both, the documents above the contents.
"""
import pytest

pytest.importorskip("playwright")

RECT = """(selector) => {
	const r = document.querySelector(selector).getBoundingClientRect();
	return {top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height};
}"""


@pytest.fixture
def phone(browser, server):
	context = browser.new_context(viewport={"width": 400, "height": 760}, has_touch=True)
	page = context.new_page()
	page.errors = []
	page.on("pageerror", lambda e: page.errors.append(str(e)))
	page.goto(server)
	page.evaluate("""() => {
		localStorage.clear();
		localStorage.setItem("__userConsent__", "1");
		localStorage.setItem("__doc__plan", "<h1>One</h1><div>x</div><h2>Two</h2>");
		localStorage.setItem("__lastOpened__", "plan");
	}""")
	page.reload()
	page.wait_for_function("getActiveTab()?.name === 'plan'")
	yield page
	assert page.errors == []
	context.close()


def rect(page, selector):
	return page.evaluate(RECT, selector)


def test_a_tab_by_default(phone):
	phone.evaluate("openTableOfContents()")
	assert phone.evaluate("document.body.classList.contains('toc-in-tree')")
	assert phone.locator("#toc-tab").is_visible()


def test_split_on_a_phone(phone):
	phone.evaluate("openTableOfContents()")
	phone.evaluate("setTocSide('split')")
	assert phone.evaluate("document.body.classList.contains('toc-split')")
	assert phone.locator("#file-tree-list").is_visible()
	assert phone.locator("#toc-panel .toc-row", has_text="One").is_visible()
	tree, toc = rect(phone, "#file-tree"), rect(phone, "#toc-panel")
	# one under the other in the drawer
	assert tree["bottom"] <= toc["top"] + 1
	assert tree["left"] == pytest.approx(toc["left"], abs=1)
	# kept: closed and opened again, still split
	phone.click("#file-tree-scrim", position={"x": 390, "y": 400})
	assert not phone.locator("#side-dock").is_visible()
	phone.evaluate("openTableOfContents()")
	assert phone.locator("#toc-panel .toc-row", has_text="Two").is_visible()
	assert phone.locator("#file-tree-list").is_visible()


def test_split_from_the_contents_tab_menu(phone):
	phone.evaluate("openTableOfContents()")
	phone.locator("#toc-tab").dispatch_event("contextmenu", {"clientX": 50, "clientY": 20})
	phone.locator("#context-menu button", has_text="Split the documents' place with contents").click()
	assert phone.evaluate("layout.tocSide") == "split"
	assert phone.locator("#toc-panel").is_visible()
