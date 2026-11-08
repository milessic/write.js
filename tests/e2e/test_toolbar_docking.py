"""
The formatting toolbar docks above, below, left or right of the editors (workspace.js): dragged by its grip, the nearest
edge of the editors is previewed and taken, or from its right-click menu; the side is kept with the layout. Beside the
editors it is a column, its dropdowns open towards the editors.
"""
import pytest

pytest.importorskip("playwright")

from tests.e2e.test_docking import app, rect, drag_to  # noqa: F401


def point(page, side):
	area = rect(page, "#workspace")
	cx, cy = area["left"] + area["width"] / 2, area["top"] + area["height"] / 2
	return {"left": (area["left"] + 20, cy), "right": (area["right"] - 20, cy),
		"top": (cx, area["top"] + 10), "bottom": (cx, area["bottom"] - 10)}[side]


@pytest.mark.parametrize("side", ["bottom", "left", "right", "top"])
def test_toolbar_is_dragged_to_a_side(app, side):
	if side == "top":
		app.evaluate("setToolbarSide('bottom')")
	drag_to(app, "#toolbar-grip", *point(app, side))
	assert app.evaluate("document.getElementById('dock-zones').dataset.target") == side
	app.mouse.up()
	assert app.evaluate("layout.toolbarSide") == side
	assert app.evaluate("JSON.parse(localStorage.getItem('__layout__')).toolbarSide") == side
	bar, editors = rect(app, "#sub-bar"), rect(app, "#editor-grid")
	if side == "top":
		assert bar["bottom"] <= editors["top"] + 1
	elif side == "bottom":
		assert bar["top"] >= editors["bottom"] - 1
	elif side == "left":
		assert bar["right"] <= editors["left"] + 1
		assert bar["height"] > bar["width"]
	else:
		assert bar["left"] >= editors["right"] - 1
		assert bar["height"] > bar["width"]


def test_toolbar_menu_moves_it(app):
	app.locator("#toolbar-grip").click(button="right")
	labels = app.locator("#context-menu button").all_text_contents()
	assert labels == ["Move toolbar to the top", "Move toolbar to the bottom", "Move toolbar to the left", "Move toolbar to the right", "Opened documents | Toolbar", "Toolbar | Opened documents", "Opened documents above toolbar"]
	assert app.locator("#context-menu button", has_text="to the top").is_disabled()
	app.locator("#context-menu button", has_text="to the left").click()
	assert app.evaluate("document.body.dataset.toolbarSide") == "left"
	# kept across visits
	app.reload()
	app.wait_for_function("getActiveTab()?.name === 'notes'")
	assert app.evaluate("document.body.dataset.toolbarSide") == "left"


def test_dropdowns_open_towards_the_editors(app):
	app.evaluate("setToolbarSide('left')")
	app.click("#tb-block-select .block-select-btn")
	menu, button = rect(app, "#tb-block-select .block-select-menu"), rect(app, "#tb-block-select .block-select-btn")
	assert menu["left"] >= button["right"]
	app.keyboard.press("Escape")
	app.evaluate("setToolbarSide('bottom')")
	app.click("#tb-block-select .block-select-btn")
	menu, button = rect(app, "#tb-block-select .block-select-menu"), rect(app, "#tb-block-select .block-select-btn")
	assert menu["bottom"] <= button["top"]
	app.keyboard.press("Escape")
	# the "More" dropdown stays a phone's
	app.evaluate("setToolbarSide('right')")
	assert not app.locator("#tb-more-select").is_visible()
