"""
Vi mode: the documents tree (:tree, :FileExplorer, Ctrl+w h) and coming back from it to the editor.
"""
import pytest

from test_vi_repeat import Vi

pytest.importorskip("playwright")


@pytest.fixture
def vi(page):
	page.evaluate("""() => {
		localStorage.setItem("__doc__test", "<div>test</div>");
		localStorage.setItem("__doc__other", "<div>xyz</div><div>uvw</div>");
		refreshFileTree(true);
		hideFileTree();
	}""")
	vi = Vi(page)
	page.click("#editor")
	vi.keys("Escape").command("qa!").command("e test")
	yield vi.load(["abc", "def"])
	# back to the one saved document the other tests start with
	page.evaluate("hideFileTree()")
	page.click("#editor")
	vi.keys("Escape").command("qa!").command("e test")


def focused(page):
	return page.evaluate("document.activeElement.id || document.activeElement.className")


@pytest.mark.parametrize("command", ["tree", "FileExplorer"])
def test_command_shows_the_tree(vi, page, command):
	vi.command(command)
	assert page.evaluate("isFileTreeVisible()")
	assert vi.mode == "tree"
	assert "tree-row" in focused(page)


@pytest.mark.parametrize("go_to_tree", [["command", "tree"], ["keys", "Control+w", "h"]])
def test_back_with_ctrl_w(vi, page, go_to_tree):
	how, *args = go_to_tree
	vi.command(*args) if how == "command" else vi.keys(*args)
	vi.keys("Control+w", "l")
	assert focused(page) == "editor"
	assert vi.mode == "normal"
	vi.keys("x", "j", "i").type("Q").keys("Escape")
	assert vi.lines == ["bc", "Qdef"]


def test_back_by_opening_with_l(vi, page):
	vi.command("tree").keys("g", "g")
	page.focus(".tree-row[data-name='other']")
	vi.keys("l")
	assert focused(page) == "editor"
	vi.keys("x", "j", "i").type("Q").keys("Escape")
	assert vi.lines == ["yz", "Quvw"]


@pytest.mark.parametrize("go_to_tree", [["command", "tree"], ["keys", "Control+w", "h"], ["none"]])
def test_back_by_clicking_a_document(vi, page, go_to_tree):
	# the clicked row is rebuilt: the focus must go to the editor, not fall to the page
	how, *args = go_to_tree
	if how == "command":
		vi.command(*args)
	elif how == "keys":
		vi.keys(*args)
	else:
		page.evaluate("showFileTree()")
	page.click(".tree-row[data-name='other']")
	assert focused(page) == "editor"
	assert vi.mode == "normal"
	vi.keys("x", "j", "i").type("Q").keys("Escape")
	assert vi.lines == ["yz", "Quvw"]


def test_ctrl_click_only_selects(vi, page):
	vi.command("tree")
	page.click(".tree-row[data-name='other']", modifiers=["Control"])
	assert vi.mode == "tree"
	assert vi.lines == ["abc", "def"]
