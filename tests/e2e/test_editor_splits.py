"""Nested editor splits, proportional dividers and document drop previews."""
import pytest
from test_docking import app, rect


def drag_document(page, selector, side):
    box = rect(page, ".editor-pane.focused")
    points = {"bottom": (.5, .95), "top": (.5, .05), "left": (.05, .5), "right": (.95, .5)}
    x, y = points[side]
    source = page.locator(selector)
    source.dispatch_event("dragstart", {"dataTransfer": page.evaluate_handle("new DataTransfer()")})
    page.locator(".editor-pane.focused").dispatch_event("dragover", {"clientX": box["left"] + box["width"]*x, "clientY": box["top"] + box["height"]*y, "dataTransfer": page.evaluate_handle("new DataTransfer()")})
    assert page.is_visible("#dock-preview.shown")
    assert side in page.inner_text("#dock-preview")
    page.locator(".editor-pane.focused").dispatch_event("drop", {"clientX": box["left"] + box["width"]*x, "clientY": box["top"] + box["height"]*y})
    source.dispatch_event("dragend")


@pytest.mark.parametrize("source", ["tree", "tab"])
@pytest.mark.parametrize("side", ["left", "right", "top", "bottom"])
def test_document_edge_drop(app, source, side):
    app.evaluate("""() => {
        localStorage.setItem('__doc__second', '<div>second text</div>');
        createTab('second'); renderTabs(); refreshFileTree(true);
    }""")
    selector = '.tree-document[data-name="second"]' if source == "tree" else '#tabs .tab:has-text("second")'
    drag_document(app, selector, side)
    assert app.evaluate("panes.length") == 2
    assert app.evaluate("getActiveTab().name") == "second"
    a, b = app.evaluate("panes.map(p => { const r = p.el.getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width,h:r.height} })")
    if side in ("top", "bottom"):
        assert a["w"] == pytest.approx(b["w"], abs=1)
        assert abs(a["y"]-b["y"]) == pytest.approx(a["h"], abs=1)
    else:
        assert abs(a["x"]-b["x"]) == pytest.approx(a["w"], abs=1)
    assert "second text" in app.locator("#editor").inner_text()
    assert not app.is_visible("#dock-preview.shown")


def test_nested_resize_survives_viewport_and_reload(app):
    app.evaluate("""() => {
        for (const name of ['two', 'three']) { localStorage.setItem('__doc__'+name, '<div>'+name+'</div>'); createTab(name) }
        splitEditor(tabs.find(t => t.name === 'two'));
        splitEditor(tabs.find(t => t.name === 'three'), 'bottom');
    }""")
    assert app.locator(".editor-resizer").count() == 2
    bar = app.locator(".editor-resizer.vertical").bounding_box()
    app.mouse.move(bar["x"]+4, bar["y"]+20)
    app.mouse.down()
    app.mouse.move(bar["x"]+100, bar["y"]+20, steps=5)
    app.mouse.up()
    saved = app.evaluate("JSON.parse(localStorage.getItem('__openedEditors__')).splits")
    assert saved["ratio"] > .55
    app.set_viewport_size({"width": 1000, "height": 750})
    app.reload()
    app.wait_for_function("panes.length === 3")
    assert app.evaluate("encodeEditorSplits(editorSplits)") == saved
    assert app.evaluate("JSON.parse(localStorage.getItem('__openedEditors__')).splits") == saved
    widths = app.evaluate("[panes[0].el.offsetWidth, editorGrid.offsetWidth]")
    assert widths[0]/widths[1] == pytest.approx(saved["ratio"], abs=.01)
    app.locator(".editor-pane.focused .pane-close").click()
    assert app.locator(".editor-resizer").count() == 1
    assert app.is_enabled("#split-btn")


def test_native_document_drag_and_center_drop(app):
    app.evaluate("""() => {
        localStorage.setItem('__doc__second', '<div>second text</div>');
        refreshFileTree(true);
    }""")
    target = app.locator('.editor-pane.focused')
    box = target.bounding_box()
    app.locator('.tree-document[data-name="second"]').drag_to(target, target_position={"x": box["width"] / 2, "y": box["height"] - 15})
    assert app.evaluate("panes.length") == 2
    assert app.evaluate("getActiveTab().name") == "second"
    assert app.evaluate("editorSplits.axis") == "y"
    # Center drops retain the replacement/swap behavior without inserting dragged text.
    app.evaluate("""() => {
        localStorage.setItem('__doc__third', '<div>third text</div>');
        createTab('third'); renderTabs();
    }""")
    app.locator('#tabs .tab:has-text("third")').drag_to(target)
    assert app.evaluate("panes.length") == 2
    assert app.locator('#editor').inner_text().strip() == 'third text'


def test_existing_split_controls_and_keyboard_resize(app):
    app.click('#split-btn')
    assert app.evaluate('panes.length') == 2
    app.keyboard.press('Control+\\')
    assert app.evaluate('panes.length') == 3
    divider = app.locator('.editor-resizer').last
    divider.focus()
    before = float(divider.get_attribute('aria-valuenow'))
    app.keyboard.press('ArrowRight')
    assert float(app.locator('.editor-resizer').last.get_attribute('aria-valuenow')) == before + 2
    app.click('#split-btn')
    assert app.evaluate('panes.length') == 4
    assert app.is_disabled('#split-btn')
    app.locator('.editor-pane.focused .pane-close').click()
    assert app.evaluate('panes.length') == 3
    assert app.is_enabled('#split-btn')
