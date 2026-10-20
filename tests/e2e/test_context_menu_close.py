"""
A context menu closes when the user clicks (or right-clicks) anywhere outside of it, even where the click doesn't
reach the document: the native menu of a right-click, a close button, a drag.
"""
import pytest

pytest.importorskip("playwright")

OPENED = "document.getElementById('context-menu').classList.contains('menu-opened')"


def open_tab_menu(page):
	page.click(".tab", button="right")
	assert page.evaluate(OPENED)


def click_corner(page, selector, button="left"):
	box = page.locator(selector).first.bounding_box()
	page.mouse.click(box["x"] + box["width"] - 5, box["y"] + box["height"] - 5, button=button)


@pytest.mark.parametrize("target", ["#editor", "#tab-bar", "#file-tree", "body", ".tab"])
def test_tab_menu_closes_on_a_click_outside(page, target):
	open_tab_menu(page)
	click_corner(page, target)
	assert not page.evaluate(OPENED)


def test_tab_menu_closes_on_a_right_click_in_the_editor(page):
	open_tab_menu(page)
	click_corner(page, "#editor", button="right")
	assert not page.evaluate(OPENED)


def test_tab_menu_closes_on_a_click_that_stops_propagation(page):
	open_tab_menu(page)
	page.evaluate("""() => {
		const button = document.createElement("button");
		button.id = "stopper";
		button.textContent = "stop";
		button.addEventListener("click", (e) => e.stopPropagation());
		document.getElementById("tab-bar").append(button);
	}""")
	page.click("#stopper")
	page.evaluate("document.getElementById('stopper').remove()")
	assert not page.evaluate(OPENED)


def test_a_click_in_the_menu_keeps_it_open(page):
	open_tab_menu(page)
	click_corner(page, "#context-menu hr")
	assert page.evaluate(OPENED)
	page.keyboard.press("Escape")
