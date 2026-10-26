"""
A long press on a row of the documents tree opens its right-click menu: iOS Safari has no contextmenu event for it
(workspace.js setupLongPressMenus).
"""
import pytest

pytest.importorskip("playwright")


@pytest.fixture
def phone(browser, server):
	context = browser.new_context(viewport={"width": 393, "height": 852}, has_touch=True, is_mobile=True)
	page = context.new_page()
	errors = []
	page.on("pageerror", lambda e: errors.append(str(e)))
	page.goto(server)
	page.evaluate("""() => {
		localStorage.clear();
		localStorage.setItem("__userConsent__", "1");
		localStorage.setItem("__doc__plan", "<div>plan</div>");
		localStorage.setItem("__folders__", '{"folders": ["work"], "documents": {"plan": "work"}}');
	}""")
	page.reload()
	page.evaluate("showFileTree()")
	yield page
	assert errors == []
	context.close()


TOUCH = """([selector, type, dx]) => {
	const row = document.querySelector(selector);
	const r = row.getBoundingClientRect();
	const point = { identifier: 1, target: row, clientX: r.left + 20 + dx, clientY: r.top + 5 };
	const touches = type === "touchend" ? [] : [point];
	let e;
	try {
		const touch = new Touch(point);
		e = new TouchEvent(type, { bubbles: true, cancelable: true, touches: touches.map(() => touch), changedTouches: [touch] });
	} catch {
		// desktop WebKit can't make touches: an event of the type with them
		e = new Event(type, { bubbles: true, cancelable: true });
		Object.defineProperty(e, "touches", { value: touches });
		Object.defineProperty(e, "changedTouches", { value: [point] });
	}
	row.dispatchEvent(e);
}"""
FOLDER = '#file-tree-list li[data-folder="work"] > .tree-folder'


def touch(page, type, dx=0, selector=FOLDER):
	page.evaluate(TOUCH, [selector, type, dx])


def menu(page):
	return page.evaluate("""document.getElementById("context-menu").classList.contains("menu-opened")
		? [...document.querySelectorAll("#context-menu button[role=menuitem]")].map((b) => b.textContent) : null""")


def test_long_press_on_a_folder_opens_its_menu(phone):
	touch(phone, "touchstart")
	phone.wait_for_timeout(700)
	assert "Rename folder" in menu(phone)
	touch(phone, "touchend")
	assert phone.locator(FOLDER).evaluate("el => el.draggable") is True


def test_long_press_on_a_document_opens_its_menu(phone):
	touch(phone, "touchstart", selector='.tree-document[data-name="plan"]')
	phone.wait_for_timeout(700)
	assert "Duplicate" in menu(phone)


def test_a_tap_or_a_swipe_doesnt(phone):
	touch(phone, "touchstart")
	touch(phone, "touchend")
	phone.wait_for_timeout(700)
	assert menu(phone) is None
	touch(phone, "touchstart")
	touch(phone, "touchmove", dx=30)
	phone.wait_for_timeout(700)
	assert menu(phone) is None
