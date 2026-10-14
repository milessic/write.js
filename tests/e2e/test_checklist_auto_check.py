"""
A checklist item with checklist items nested in it is checked when all of them are (Settings > Lists, checklist.js).
"""
import pytest

from test_list_folding import load, caret

pytest.importorskip("playwright")

TREE = ('<ul><li data-checked="false">parent<ul>'
	'<li data-checked="false">c1</li>'
	'<li data-checked="false">c2<ul><li data-checked="false">g1</li><li data-checked="false">g2</li></ul></li>'
	'<li>a bullet</li>'
	'</ul></li></ul>')
# the same, nested as Tab nests items: each list right after its item
TREE_AFTER = ('<ul><li data-checked="false">parent</li><ul>'
	'<li data-checked="false">c1</li>'
	'<li data-checked="false">c2</li><ul><li data-checked="false">g1</li><li data-checked="false">g2</li></ul>'
	'<li>a bullet</li>'
	'</ul></ul>')


@pytest.fixture(params=["inside", "after"])
def editor(page, request):
	page.click("#editor")
	page.keyboard.press("Escape")
	page.keyboard.press("i")
	load(page, TREE if request.param == "inside" else TREE_AFTER)
	yield page
	page.keyboard.press("Escape")
	page.evaluate("localStorage.removeItem(autoCheckParentsKey)")


def states(page):
	return page.evaluate("""Object.fromEntries([...document.querySelectorAll("#editor li[data-checked]")]
		.map((li) => [li.firstChild.textContent, li.dataset.checked === "true"]))""")


def toggle(page, text):
	# a click on the item's checkbox
	x, y = page.evaluate("""(text) => {
		const li = [...document.querySelectorAll("#editor li[data-checked]")].find((li) => li.firstChild.textContent === text);
		const rect = li.getBoundingClientRect();
		const fontSize = parseFloat(getComputedStyle(li).fontSize);
		return [rect.left - fontSize, rect.top + fontSize * .7];
	}""", text)
	page.mouse.click(x, y)


def test_all_children_checked_checks_the_parents(editor):
	toggle(editor, "c1")
	toggle(editor, "g1")
	assert states(editor) == {"parent": False, "c1": True, "c2": False, "g1": True, "g2": False}
	toggle(editor, "g2")
	# c2 by its items, then parent by c1 and c2 (the plain bullet doesn't count)
	assert states(editor) == {"parent": True, "c1": True, "c2": True, "g1": True, "g2": True}


def test_unchecking_a_child_unchecks_the_parents(editor):
	for text in ["c1", "g1", "g2"]:
		toggle(editor, text)
	toggle(editor, "g1")
	assert states(editor) == {"parent": False, "c1": True, "c2": False, "g1": False, "g2": True}


def test_parent_checked_by_hand_stays(editor):
	toggle(editor, "parent")
	assert states(editor)["parent"] is True
	assert states(editor)["c1"] is False


def test_ctrl_enter_and_vi_tab(editor):
	caret(editor, "g1")
	editor.keyboard.press("Control+Enter")
	caret(editor, "g2")
	editor.keyboard.press("Escape")
	editor.keyboard.press("Tab")  # vi NORMAL
	editor.keyboard.press("i")
	assert states(editor)["c2"] is True


def test_setting_off(editor):
	editor.evaluate("localStorage.setItem(autoCheckParentsKey, '0')")
	toggle(editor, "g1")
	toggle(editor, "g2")
	assert states(editor)["c2"] is False


def test_setting_in_settings(editor):
	editor.evaluate("createSettingsModal()")
	assert editor.locator("#setting-auto-check-parents").is_checked()
	editor.uncheck("#setting-auto-check-parents")
	assert editor.evaluate("localStorage.getItem(autoCheckParentsKey)") == "0"
	assert editor.evaluate("Object.keys(getAllLocalStorageItems()).includes(autoCheckParentsKey)")
	editor.evaluate("closeModal?.()") if editor.evaluate("typeof closeModal === 'function'") else editor.keyboard.press("Escape")
