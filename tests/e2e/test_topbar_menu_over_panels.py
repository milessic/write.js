"""
The top bar's open menus (the hamburger menu, the document search tray) are over the side panels: with the documents on
the right, their resizer doesn't take the pointer through the open menu.
"""
import pytest

pytest.importorskip("playwright")


@pytest.fixture
def app(browser, server):
	context = browser.new_context(viewport={"width": 1400, "height": 900})
	page = context.new_page()
	page.errors = []
	page.on("pageerror", lambda e: page.errors.append(str(e)))
	page.goto(server)
	page.evaluate("""() => {
		localStorage.clear();
		localStorage.setItem("__userConsent__", "1");
		localStorage.setItem("__layout__", JSON.stringify({treeSide: "right"}));
		localStorage.setItem("__treeWidth__", "170");
		localStorage.setItem("__doc__plan", "<div>x</div>");
		localStorage.setItem("__lastOpened__", "plan");
	}""")
	page.reload()
	page.wait_for_function("getActiveTab()?.name === 'plan'")
	yield page
	assert page.errors == []
	context.close()


# what is under a point of the resizer that the menu covers
UNDER_JS = """(menu) => {
	const resizer = document.getElementById("file-tree-resizer").getBoundingClientRect();
	const box = document.querySelector(menu).getBoundingClientRect();
	const x = resizer.left + resizer.width / 2;
	if ( x < box.left || x > box.right ) { return "not covered" }
	return document.elementFromPoint(x, box.top + box.height / 2).closest(menu) ? "menu" : "panel";
}"""


def test_hamburger_menu_is_over_the_resizer(app):
	app.click("#hamburger-button")
	assert app.evaluate(UNDER_JS, "#menu") == "menu"
	# a drag there doesn't resize the documents
	width = app.evaluate("document.getElementById('file-tree').offsetWidth")
	resizer = app.locator("#file-tree-resizer").bounding_box()
	menu = app.locator("#menu").bounding_box()
	x, y = resizer["x"] + resizer["width"] / 2, menu["y"] + menu["height"] - 4
	app.mouse.move(x, y)
	app.mouse.down()
	app.mouse.move(x - 100, y, steps=5)
	app.mouse.up()
	assert app.evaluate("document.getElementById('file-tree').offsetWidth") == width
