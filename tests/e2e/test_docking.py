"""
Docking (workspace.js, toc.js): the documents tree and the table of contents are dragged by their heads, like in VS Code:
where the panel would go is previewed under the pointer, the side of the editors it is nearest to, or (the contents) over
the documents, as a tab next to them or splitting their place; the documents stay outermost, the contents next to the editors.
"""
import pytest

pytest.importorskip("playwright")

RECT = """(selector) => {
	const r = document.querySelector(selector).getBoundingClientRect();
	return {top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height};
}"""


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
		localStorage.setItem("__viMode__", "1");
		localStorage.setItem("__doc__notes", "<h2>One</h2><div>text</div>");
		localStorage.setItem("__lastOpened__", "notes");
	}""")
	page.reload()
	page.wait_for_function("getActiveTab()?.name === 'notes'")
	yield page
	assert page.errors == []
	context.close()


def rect(page, selector):
	return page.evaluate(RECT, selector)


def drop_point(page, panel, side):
	# a point the side is the nearest one of: next to an edge of the page body (the documents) or of the editors (the
	# contents), or over the documents for the contents' tab and split
	if side in ("tree", "split"):
		tree = rect(page, "#file-tree")
		rows = page.evaluate("dockedInRows(layout.treeSide)")
		if side == "tree":
			return tree["left"] + tree["width"] * .25, tree["top"] + tree["height"] * .25
		return (tree["left"] + tree["width"] * .75, tree["top"] + tree["height"] / 2) if rows else (tree["left"] + tree["width"] / 2, tree["top"] + tree["height"] * .75)
	area = rect(page, "#app-body" if panel == "tree" else ".editor-area")
	cx, cy = area["left"] + area["width"] / 2, area["top"] + area["height"] / 2
	return {"left": (area["left"] + 20, cy), "right": (area["right"] - 20, cy),
		"top": (cx, area["top"] + 10), "bottom": (cx, area["bottom"] - 10)}[side]


def drag_to(page, handle, x, y):
	# the layer over the page shows up a frame after the drag starts, so the drag is done step by step
	page.hover(handle, position={"x": 5, "y": 5})
	page.mouse.down()
	box = rect(page, handle)
	page.mouse.move(box["left"] + 40, box["top"] + 40, steps=3)
	page.wait_for_selector("#dock-zones.dragging")
	page.mouse.move(x, y, steps=5)


def dock(page, handle, panel, side):
	drag_to(page, handle, *drop_point(page, panel, side))
	assert page.evaluate("document.getElementById('dock-zones').dataset.target") == side
	page.mouse.up()


@pytest.mark.parametrize("side", ["top", "bottom"])
def test_documents_dock_above_or_below(app, side):
	dock(app, "#file-tree-head", "tree", side)
	assert app.evaluate("layout.treeSide") == side
	assert app.evaluate("JSON.parse(localStorage.getItem('__layout__')).treeSide") == side
	tree, editors = rect(app, "#file-tree"), rect(app, ".editor-area")
	# as wide as the page, on its side of the editors, which get the whole width
	assert tree["width"] == pytest.approx(1400, abs=1)
	assert (tree["bottom"] <= editors["top"] + 1) if side == "top" else (tree["top"] >= editors["bottom"] - 1)
	assert editors["width"] == pytest.approx(1400, abs=1)
	# and back to the left
	dock(app, "#file-tree-head", "tree", "left")
	tree, editors = rect(app, "#file-tree"), rect(app, ".editor-area")
	assert tree["right"] <= editors["left"] + 1
	assert tree["height"] > 600


@pytest.mark.parametrize("side", ["top", "bottom"])
def test_contents_dock_above_or_below(app, side):
	app.evaluate("openTableOfContents(); setTocSide('right')")
	dock(app, "#toc-head", "toc", side)
	assert app.evaluate("layout.tocSide") == side
	toc, editors, tree = rect(app, "#toc-panel"), rect(app, ".editor-area"), rect(app, "#file-tree")
	assert (toc["bottom"] <= editors["top"] + 1) if side == "top" else (toc["top"] >= editors["bottom"] - 1)
	# beside the documents, over the editors only
	assert toc["left"] == pytest.approx(tree["right"], abs=1)
	assert toc["width"] == pytest.approx(editors["width"], abs=1)
	assert app.locator("#toc-panel .toc-row").count() == 1


def test_contents_stay_next_to_the_editors(app):
	# the documents above, the contents above as well: the contents between them and the editors
	app.evaluate("openTableOfContents(); setTreeSide('top'); setTocSide('top')")
	tree, toc, editors = rect(app, "#file-tree"), rect(app, "#toc-panel"), rect(app, ".editor-area")
	assert tree["bottom"] <= toc["top"] + 1
	assert toc["bottom"] <= editors["top"] + 1


@pytest.mark.parametrize("panel", ["tree", "toc"])
def test_resizing_above_the_editors(app, panel):
	selector, resizer, key = {"tree": ("#file-tree", "#file-tree-resizer", "__treeHeight__"),
		"toc": ("#toc-panel", "#toc-resizer", "__tocHeight__")}[panel]
	app.evaluate("openTableOfContents(); setTreeSide('bottom'); setTocSide('top')")
	before = rect(app, selector)["height"]
	edge = rect(app, resizer)
	x, y = edge["left"] + edge["width"] / 2, edge["top"] + edge["height"] / 2
	# the contents' edge is its bottom one (dragged down to grow), the documents' its top one (dragged up)
	grow = 60 if panel == "toc" else -60
	app.mouse.move(x, y)
	app.mouse.down()
	app.mouse.move(x, y + grow, steps=5)
	app.mouse.up()
	after = rect(app, selector)["height"]
	assert after == pytest.approx(before + 60, abs=2)
	assert int(app.evaluate(f"localStorage.getItem('{key}')")) == round(after)
	assert app.evaluate(f"document.querySelector('{resizer}').getAttribute('aria-orientation')") == "horizontal"


def test_vi_goes_to_documents_above(app):
	app.evaluate("setTreeSide('top')")
	app.click("#editor")
	app.keyboard.press("Escape")
	app.keyboard.press("Control+w")
	app.keyboard.press("k")
	assert app.evaluate("!!document.activeElement.closest('#file-tree')")
	app.keyboard.press("Control+w")
	app.keyboard.press("j")
	assert app.evaluate("document.activeElement.id") == "editor"


def test_menus_move_panels_up_and_down(app):
	app.click("#file-tree-head", button="right")
	app.click("#context-menu button:has-text('Move documents to the bottom')")
	assert app.evaluate("layout.treeSide") == "bottom"
	app.evaluate("openTableOfContents(); setTocSide('right')")
	app.click("#toc-head", button="right")
	app.click("#context-menu button:has-text('Move contents to the top')")
	assert app.evaluate("layout.tocSide") == "top"


@pytest.mark.parametrize("tree_side", ["left", "top"])
def test_contents_split_the_documents_place(app, tree_side):
	app.evaluate(f"openTableOfContents(); setTreeSide('{tree_side}'); setTocSide('right')")
	before = rect(app, "#file-tree")
	dock(app, "#toc-head", "toc", "split")
	assert app.evaluate("layout.tocSide") == "split"
	tree, toc, dock_box, editors = (rect(app, s) for s in ("#file-tree", "#toc-panel", "#side-dock", ".editor-area"))
	if tree_side == "left":
		# the documents' place, under them, the editors as wide as before
		assert dock_box["width"] == pytest.approx(before["width"], abs=1)
		assert toc["top"] == pytest.approx(tree["bottom"], abs=1)
		assert toc["left"] == pytest.approx(tree["left"], abs=1) and toc["width"] == pytest.approx(tree["width"], abs=1)
		assert dock_box["right"] <= editors["left"] + 1
	else:
		# above the editors: beside them, the height of the documents' place
		assert dock_box["height"] == pytest.approx(before["height"], abs=1)
		assert toc["left"] == pytest.approx(tree["right"], abs=1)
		assert toc["height"] == pytest.approx(tree["height"], abs=1)
		assert dock_box["bottom"] <= editors["top"] + 1
	assert app.locator("#toc-panel .toc-row").count() == 1
	assert not app.is_visible("#toc-resizer")


def test_split_resizes_with_the_documents(app):
	app.evaluate("openTableOfContents(); setTreeSide('left'); setTocSide('split')")
	edge = rect(app, "#file-tree-resizer")
	# the resizer runs along the whole place, the contents' part too
	assert edge["height"] == pytest.approx(rect(app, "#side-dock")["height"], abs=1)
	x, y = edge["left"] + edge["width"] / 2, edge["bottom"] - 20
	before = rect(app, "#toc-panel")["width"]
	app.mouse.move(x, y)
	app.mouse.down()
	app.mouse.move(x + 50, y, steps=5)
	app.mouse.up()
	assert rect(app, "#toc-panel")["width"] == pytest.approx(before + 50, abs=2)
	assert rect(app, "#file-tree")["width"] == pytest.approx(before + 50, abs=2)


def test_split_contents_alone_when_documents_are_hidden(app):
	app.evaluate("openTableOfContents(); setTocSide('split'); hideFileTree()")
	assert not app.is_visible("#file-tree")
	toc = rect(app, "#toc-panel")
	assert toc["width"] > 100 and toc["height"] > 600


def test_preview_follows_the_pointer(app):
	app.evaluate("openTableOfContents(); setTocSide('right')")
	drag_to(app, "#toc-head", *drop_point(app, "toc", "left"))
	preview, editors = rect(app, "#dock-preview"), rect(app, ".editor-area")
	assert app.is_visible("#dock-preview")
	assert "left" in app.inner_text("#dock-preview")
	# on the editors' left, as wide as the panel
	assert preview["left"] == pytest.approx(editors["left"], abs=1)
	assert preview["height"] == pytest.approx(editors["height"], abs=1)
	assert preview["width"] == pytest.approx(rect(app, "#toc-panel")["width"], abs=1)
	app.mouse.move(*drop_point(app, "toc", "bottom"), steps=3)
	preview = rect(app, "#dock-preview")
	assert preview["bottom"] == pytest.approx(editors["bottom"], abs=1) and preview["width"] == pytest.approx(editors["width"], abs=1)
	app.mouse.up()
	assert app.evaluate("layout.tocSide") == "bottom"
	assert not app.is_visible("#dock-zones")


def test_dropping_puts_no_text_in_the_editor(app):
	before = app.evaluate("document.getElementById('editor').innerHTML")
	dock(app, "#file-tree-head", "tree", "right")
	assert app.evaluate("layout.treeSide") == "right"
	assert app.evaluate("document.getElementById('editor').innerHTML") == before


@pytest.mark.parametrize("tree_side", ["left", "right", "top", "bottom"])
def test_contents_onto_the_documents(app, tree_side):
	app.evaluate("(side) => { openTableOfContents(); setTocSide('right'); setTreeSide(side) }", tree_side)
	dock(app, "#toc-head", "toc", "tree")
	assert app.evaluate("layout.tocSide") == "tree"
	assert app.evaluate("layout.treeTab") == "toc"


def test_documents_onto_the_contents(app):
	# the documents take the contents' place, with the contents as their tab
	app.evaluate("openTableOfContents(); setTreeSide('left'); setTocSide('right')")
	toc = rect(app, "#toc-panel")
	drag_to(app, "#file-tree-head", toc["left"] + toc["width"] / 2, toc["top"] + toc["height"] / 2)
	assert app.evaluate("document.getElementById('dock-zones').dataset.target") == "with-toc"
	app.mouse.up()
	assert app.evaluate("[layout.treeSide, layout.tocSide]") == ["right", "tree"]
	assert app.is_visible("#toc-tab")


def test_tabs_dock_at_the_bottom(app):
	area = rect(app, ".editor-area")
	drag_to(app, "#tab-grip", area["left"] + area["width"] / 2, area["bottom"] - 30)
	app.mouse.up()
	assert app.evaluate("layout.tabsSide") == "bottom"


def drag_strip(page, x, y):
	# held between the tabs, right of the last one
	strip = rect(page, "#side-tabs")
	page.mouse.move(strip["right"] - 4, strip["top"] + strip["height"] / 2)
	page.mouse.down()
	page.mouse.move(strip["right"] + 30, strip["top"] + 40, steps=3)
	page.wait_for_selector("#dock-zones.dragging")
	page.mouse.move(x, y, steps=5)


# together, neither panel is the master: the tabs' strip moves both, a tab or a panel's head only its panel
@pytest.mark.parametrize("together", ["tree", "split"])
def test_tab_strip_moves_documents_and_contents_together(app, together):
	app.evaluate(f"setTreeSide('left'); openTableOfContents(); setTocSide('{together}')")
	drag_strip(app, *drop_point(app, "tree", "right"))
	assert app.evaluate("document.getElementById('dock-zones').dataset.panel") == "group"
	app.mouse.up()
	assert app.evaluate("[layout.treeSide, layout.tocSide]") == ["right", together]


def test_tab_strip_alone_moves_the_documents(app):
	# the contents not with them: the strip moves the documents like their head
	drag_strip(app, *drop_point(app, "tree", "bottom"))
	app.mouse.up()
	assert app.evaluate("layout.treeSide") == "bottom"


@pytest.mark.parametrize("together, handle", [("tree", "#documents-tab"), ("split", "#file-tree-head")])
def test_documents_alone_leave_the_contents_where_they_were(app, together, handle):
	app.evaluate(f"setTreeSide('left'); openTableOfContents(); setTocSide('{together}')")
	dock(app, handle, "tree", "right")
	assert app.evaluate("[layout.treeSide, layout.tocSide, layout.tocHidden]") == ["right", "left", False]
	tree, toc, editors = rect(app, "#file-tree"), rect(app, "#toc-panel"), rect(app, ".editor-area")
	assert toc["right"] <= editors["left"] + 1 and tree["left"] >= editors["right"] - 1


def test_documents_dropped_where_they_are_stay_together(app):
	app.evaluate("setTreeSide('left'); openTableOfContents(); setTocSide('tree')")
	tree = rect(app, "#file-tree")
	drag_to(app, "#documents-tab", tree["left"] + tree["width"] / 2, tree["top"] + tree["height"] / 2)
	assert app.evaluate("document.getElementById('dock-zones').dataset.target") == "keep"
	app.mouse.up()
	assert app.evaluate("[layout.treeSide, layout.tocSide]") == ["left", "tree"]


def test_contents_tab_moves_only_the_contents(app):
	app.evaluate("setTreeSide('left'); openTableOfContents(); setTocSide('tree')")
	dock(app, "#toc-tab", "toc", "bottom")
	assert app.evaluate("[layout.treeSide, layout.tocSide]") == ["left", "bottom"]
