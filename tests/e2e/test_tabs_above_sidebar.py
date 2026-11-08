"""Opened documents can span the app above the sidebar independently of formatting."""
import pytest

pytest.importorskip("playwright")

from tests.e2e.test_docking import app, rect  # noqa: F401


def move_tabs(page, label):
	page.locator("#tab-grip").click(button="right")
	page.locator("#context-menu button", has_text=label).click()


@pytest.mark.parametrize("tree_side", ["left", "right", "top", "bottom"])
def test_tabs_above_sidebar(app, tree_side):
	app.evaluate("side => setTreeSide(side)", tree_side)
	app.evaluate("setToolbarSide('bottom')")
	move_tabs(app, "Move opened documents above the sidebar")
	strip, tree = rect(app, "#tab-bar"), rect(app, "#file-tree")
	assert strip["bottom"] <= tree["top"] + 1
	assert strip["width"] == pytest.approx(1400, abs=1)
	assert app.evaluate("layout.toolbarSide") == "bottom"
	assert app.evaluate("JSON.parse(localStorage.getItem('__layout__')).tabsSide") == "above-sidebar"
	app.reload()
	app.wait_for_function("getActiveTab()?.name === 'notes'")
	assert rect(app, "#tab-bar")["bottom"] <= rect(app, "#file-tree")["top"] + 1
	app.locator("#tab-grip").click(button="right")
	assert app.locator("#context-menu button", has_text="above the sidebar").is_disabled()
	app.keyboard.press("Escape")
	# The relocated tabs still activate their document.
	app.locator("#tabs .tab").first.click()
	assert app.locator("#editor").is_visible()


@pytest.mark.parametrize("side", ["top", "bottom"])
def test_tabs_return_to_editor(app, side):
	move_tabs(app, "Move opened documents above the sidebar")
	move_tabs(app, f"Move opened documents to the {side}")
	assert app.evaluate("document.getElementById('tab-bar').parentElement.classList.contains('editor-area')")
	strip, workspace = rect(app, "#tab-bar"), rect(app, "#workspace")
	if side == "top":
		assert strip["bottom"] <= workspace["top"] + 1
	else:
		assert strip["top"] >= workspace["bottom"] - 1


def test_tabs_above_sidebar_on_phone(app):
	app.set_viewport_size({"width": 390, "height": 844})
	move_tabs(app, "Move opened documents above the sidebar")
	strip = rect(app, "#tab-bar")
	assert strip["width"] == pytest.approx(390, abs=1)
	assert strip["bottom"] <= rect(app, "#workspace")["top"] + 1
	assert rect(app, "#editor-grid")["height"] > 0


@pytest.mark.parametrize("width", [390, 1400])
@pytest.mark.parametrize("mode,label", [("tabs-toolbar", "Opened documents | Toolbar"), ("toolbar-tabs", "Toolbar | Opened documents"), ("with-tabs", "Opened documents above toolbar")])
def test_toolbar_follows_opened_documents(app, width, mode, label):
	app.set_viewport_size({"width": width, "height": 900})
	app.evaluate("setToolbarSide('left')")
	move_tabs(app, label)
	for side in ["above-sidebar", "bottom", "top", "above-sidebar"]:
		app.evaluate("side => setTabsSide(side)", side)
		assert app.evaluate("document.getElementById('tab-bar').nextElementSibling.id") == "sub-bar"
		strip, toolbar = rect(app, "#tab-bar"), rect(app, "#sub-bar")
		if mode == "tabs-toolbar":
			assert strip["right"] <= toolbar["left"] + 1
			assert strip["top"] == pytest.approx(toolbar["top"], abs=1)
		elif mode == "toolbar-tabs":
			assert toolbar["right"] <= strip["left"] + 1
			assert strip["top"] == pytest.approx(toolbar["top"], abs=1)
		else:
			assert strip["bottom"] <= toolbar["top"] + 1
		if side == "above-sidebar":
			assert toolbar["bottom"] <= rect(app, "#app-body")["top"] + 1
		assert rect(app, "#editor-grid")["height"] > 0
	app.reload()
	app.wait_for_function("getActiveTab()?.name === 'notes'")
	assert app.evaluate("layout.toolbarSide") == mode
	assert app.evaluate("document.getElementById('tab-bar').nextElementSibling.id") == "sub-bar"
	# The formatting controls still work outside the workspace.
	app.click("#tb-block-select .block-select-btn")
	assert app.locator("#tb-block-select .block-select-menu").is_visible()
	app.keyboard.press("Escape")
	app.locator("#toolbar-grip").click(button="right")
	app.locator("#context-menu button", has_text="Move toolbar to the bottom").click()
	assert app.evaluate("document.getElementById('sub-bar').parentElement.id") == "workspace"
	assert rect(app, "#sub-bar")["top"] >= rect(app, "#editor-grid")["bottom"] - 1


@pytest.mark.parametrize("panel,handle,other", [("toolbar", "#toolbar-grip", "#tab-bar"), ("tabs", "#tab-grip", "#sub-bar")])
@pytest.mark.parametrize("fraction", [.15, .5, .85])
def test_drag_to_combine_bars(app, panel, handle, other, fraction):
	from tests.e2e.test_docking import drag_to
	box = rect(app, other)
	drag_to(app, handle, box["left"] + box["width"] * fraction, box["top"] + box["height"] / 2)
	expected = "with-tabs" if fraction == .5 else ("toolbar-tabs" if (fraction < .5) == (panel == "toolbar") else "tabs-toolbar")
	assert app.locator("#dock-zones").get_attribute("data-target") == expected
	app.mouse.up()
	assert app.evaluate("layout.toolbarSide") == expected
	assert app.locator("#document-toolbar-bar #tab-bar").count() == 1
	assert app.locator("#document-toolbar-bar #sub-bar").count() == 1


@pytest.mark.parametrize("mode", ["tabs-toolbar", "toolbar-tabs"])
def test_resize_combined_bar(app, mode):
	app.evaluate("mode => { setTabsSide('above-sidebar'); setToolbarSide(mode) }", mode)
	divider = app.locator("#document-toolbar-resizer")
	box = divider.bounding_box()
	app.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
	app.mouse.down()
	app.mouse.move(1400 * (.65 if mode == "tabs-toolbar" else .35), box["y"] + 5, steps=5)
	app.mouse.up()
	assert app.evaluate("layout.tabsShare") == pytest.approx(65, abs=1)
	assert rect(app, "#tab-bar")["width"] == pytest.approx(1400 * .65 - 3, abs=2)
	app.reload()
	app.wait_for_function("getActiveTab()?.name === 'notes'")
	assert rect(app, "#tab-bar")["width"] == pytest.approx(1400 * .65 - 3, abs=2)
	app.locator("#document-toolbar-resizer").dblclick()
	assert app.evaluate("layout.tabsShare") == 50
