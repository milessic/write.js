"""
Focus mode on a phone: the documents tree hides while in it and a pinned one is open again after leaving.
"""
import pytest

pytest.importorskip("playwright")


@pytest.fixture
def phone(browser, server):
	# its own narrow page: the shared one is a desktop
	context = browser.new_context(viewport={"width": 400, "height": 800})
	page = context.new_page()
	page.goto(server)
	page.evaluate("""() => {
		localStorage.clear();
		localStorage.setItem("__userConsent__", "1");
		localStorage.setItem("__doc__test", "<div>test</div>");
	}""")
	yield page
	context.close()


def drawer_open(page):
	return page.evaluate("document.body.classList.contains('tree-drawer-open')")


def test_pinned_tree_opens_again_after_focus_mode(phone):
	phone.evaluate("localStorage.setItem('__treePinned__', 'true')")
	phone.reload()
	assert drawer_open(phone)
	phone.evaluate("toggleFocusMode(true)")
	assert not phone.is_visible(".file-tree")
	phone.evaluate("toggleFocusMode(false)")
	assert drawer_open(phone)
	assert phone.is_visible(".file-tree")


def test_unpinned_tree_stays_closed_after_focus_mode(phone):
	phone.reload()
	phone.evaluate("document.body.classList.add('tree-drawer-open')")
	phone.evaluate("toggleFocusMode(true)")
	phone.evaluate("toggleFocusMode(false)")
	assert not drawer_open(phone)
