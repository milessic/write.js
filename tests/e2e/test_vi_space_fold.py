"""
Vi mode: Space in NORMAL on a heading or a list item with nested items (folding.js) folds / unfolds it; elsewhere it
moves like l. The cursor gets to the line with vi's own keys, as when typing.
"""
import pytest

pytest.importorskip("playwright")

# line 2 is the item that folds: its list right after it (as Tab nests), inside it (pasted, Markdown), a checklist
LISTS = {
	"after": '<div>top</div><ul><li>a</li><ul><li>a1</li></ul><li>b</li></ul><div>end</div>',
	"inside": '<div>top</div><ul><li>a<ul><li>a1</li></ul></li><li>b</li></ul><div>end</div>',
	"checklist": ('<div>top</div><ul><li data-checked="false">task</li><ul><li data-checked="true">sub</li></ul>'
		'<li data-checked="false">next</li></ul><div>end</div>'),
}
FOLDING = "document.querySelector('#editor li:has(+ ul, > ul)')"


def load(page, html):
	page.click("#editor")
	page.keyboard.press("Escape")
	page.evaluate("""(html) => {
		const editor = document.getElementById("editor");
		editor.innerHTML = html;
		editor.dispatchEvent(new Event("input", { bubbles: true }));
	}""", html)


def keys(page, *pressed):
	for key in pressed:
		page.keyboard.press(key)


def offset(page):
	return page.evaluate("getSelection().focusOffset")


@pytest.mark.parametrize("shape", LISTS)
def test_space_folds_and_unfolds_list_item(page, shape):
	load(page, LISTS[shape])
	keys(page, "g", "g", "j", " ")
	assert page.evaluate(f"{FOLDING}.dataset.collapsed") == "true"
	assert page.evaluate("document.querySelector('#editor ul ul li').offsetHeight") == 0
	# the cursor stays on the item: Space again opens it
	keys(page, " ")
	assert page.evaluate(f"{FOLDING}.dataset.collapsed") is None
	assert page.evaluate("document.querySelector('#editor ul ul li').offsetHeight") > 0
	assert offset(page) == 0


def test_space_folds_and_unfolds_heading(page):
	load(page, '<h2>Title</h2><div>under</div>')
	section = "document.querySelector('#editor > div').classList.contains('fold-hidden')"
	keys(page, "g", "g", " ")
	assert page.evaluate("document.querySelector('#editor > h2').dataset.collapsed") == "true"
	assert page.evaluate(section)
	keys(page, " ")
	assert page.evaluate("document.querySelector('#editor > h2').dataset.collapsed") is None
	assert not page.evaluate(section)


@pytest.mark.parametrize("line", ["plain", "item without nested items"])
def test_space_moves_elsewhere(page, line):
	load(page, '<div>plain</div>' if line == "plain" else '<ul><li>item</li></ul>')
	keys(page, "g", "g", " ")
	assert offset(page) == 1
