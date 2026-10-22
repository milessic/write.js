"""
Docking (workspace.js, toc.js): the documents tree and the table of contents are dragged by their heads onto a drop zone
for any side of the editors, left, right, top or bottom; the documents stay outermost, the contents next to the editors.
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


def dock(page, handle, panel, side):
	# the zones show up a frame after the drag starts, so the drag is done step by step
	page.hover(handle, position={"x": 5, "y": 5})
	page.mouse.down()
	box = rect(page, handle)
	page.mouse.move(box["left"] + 40, box["top"] + 40, steps=3)
	page.wait_for_selector("#dock-zones.dragging")
	zone = page.locator(f'#dock-zones .dock-zone[data-for="{panel}"][data-side="{side}"]')
	zone.hover()
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


def test_drop_zones_cover_the_page(app):
	app.evaluate("const z = document.getElementById('dock-zones'); z.dataset.panel = 'toc'; z.classList.add('dragging')")
	style = app.evaluate("(() => { const s = getComputedStyle(document.getElementById('dock-zones')); return [s.backdropFilter, s.backgroundColor, s.zIndex] })()")
	assert style[0] == "blur(4px)"
	assert style[1] not in ("rgba(0, 0, 0, 0)", "transparent")
	assert int(style[2]) > 100
	app.evaluate("document.getElementById('dock-zones').classList.remove('dragging')")


@pytest.mark.parametrize("tree_side", ["left", "right", "top", "bottom"])
def test_contents_zones_for_the_documents_place_are_where_they_are(app, tree_side):
	app.evaluate("(side) => { openTableOfContents(); setTocSide('right'); setTreeSide(side) }", tree_side)
	handle = "#toc-head"
	app.hover(handle, position={"x": 5, "y": 5})
	app.mouse.down()
	box = rect(app, handle)
	app.mouse.move(box["left"] + 40, box["top"] + 40, steps=3)
	app.wait_for_selector("#dock-zones.dragging")
	zone = lambda side: rect(app, f'#dock-zones .dock-zone[data-for="toc"][data-side="{side}"]')
	tree, split, left, right, top, bottom = (zone(s) for s in ["tree", "split", "left", "right", "top", "bottom"])
	app.mouse.up()
	app.evaluate("document.getElementById('dock-zones').classList.remove('dragging')")
	if tree_side == "left":
		assert tree["right"] <= left["left"] and split["right"] <= left["left"]
	elif tree_side == "right":
		assert tree["left"] >= right["right"] and split["left"] >= right["right"]
	elif tree_side == "top":
		assert tree["bottom"] <= top["top"] and split["bottom"] <= top["top"]
	else:
		assert tree["top"] >= bottom["bottom"] and split["top"] >= bottom["bottom"]
