"""
Vi mode: after 2 characters on the : command line, the matching commands are listed; Ctrl+N / Ctrl+P pick one, a click runs it.
"""
import pytest

pytest.importorskip("playwright")

from tests.e2e.test_vi_repeat import vi  # noqa: F401

# the listed commands, without their descriptions
ITEMS_JS = """() => {
	const list = document.querySelector(".vi-complete");
	if ( list.hidden ) { return null }
	return [...list.querySelectorAll("li[role=option]")].map(li => li.textContent.slice(0, li.textContent.length - (li.querySelector(".vi-complete-hint")?.textContent.length ?? 0)));
}"""


def items(vi):
	return vi.page.evaluate(ITEMS_JS)


def selected(vi):
	return vi.page.evaluate("document.querySelector('.vi-complete li[aria-selected=true]')?.dataset.index ?? null")


def command_line(vi):
	return vi.page.input_value(".vi-mode-cmd input")


@pytest.fixture
def typing(vi):
	yield vi
	vi.keys("Escape")


def test_one_character_lists_nothing(typing):
	typing.load(["one"]).keys(":", "l")
	assert items(typing) is None


def test_two_characters_list_the_matching_commands(typing):
	typing.load(["one"]).keys(":", "t", "o")
	assert items(typing) == ["toc"]
	typing.keys("Backspace", "Backspace", "q", "u")
	assert items(typing) == ["quit", "quitall"]


def test_no_match_lists_nothing(typing):
	typing.load(["one"]).keys(":", "z", "z")
	assert items(typing) is None


def test_ctrl_n_and_ctrl_p_pick_a_command(typing):
	typing.load(["one"]).keys(":", "q", "u")
	typing.keys("Control+n")
	assert selected(typing) == "0" and command_line(typing) == "quit"
	typing.keys("Control+n")
	assert selected(typing) == "1" and command_line(typing) == "quitall"
	typing.keys("Control+n")
	assert selected(typing) == "0"
	typing.keys("Control+p")
	assert selected(typing) == "1" and command_line(typing) == "quitall"


def test_enter_runs_the_picked_command(vi):
	vi.load(["one", "two"]).keys(":", "l", "i", "Control+n", "Enter")
	assert vi.page.evaluate("document.body.classList.contains('show-line-numbers')")
	vi.command("lines")
	assert not vi.page.evaluate("document.body.classList.contains('show-line-numbers')")


def test_click_runs_the_command(vi):
	vi.load(["one", "two"]).keys(":", "l", "i")
	vi.page.click(".vi-complete li[role=option]")
	assert vi.page.evaluate("document.body.classList.contains('show-line-numbers')")
	assert vi.mode == "normal"
	vi.command("lines")


def test_click_on_a_command_with_an_argument_fills_the_command_line(typing):
	typing.load(["one"]).keys(":", "e", "d")
	typing.page.click(".vi-complete li[role=option]")
	assert command_line(typing) == "edit "
	assert typing.mode == "command"


def test_ctrl_n_picks_a_document_for_e(typing):
	typing.load(["one"]).keys(":").page.keyboard.type("e tes")
	typing.keys("Control+n")
	assert command_line(typing) == "e test"
