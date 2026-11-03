"""
Vi mode: the command line remembers the commands and searches run from it; Up / Down go through them, the ones starting
with what is typed. Settings > Vi mode > Command history limits how many (0-9999, goes with the notebook).
"""
import pytest

pytest.importorskip("playwright")

from tests.e2e.test_vi_repeat import vi  # noqa: F401


def command_line(vi):
	return vi.page.input_value(".vi-mode-cmd input")


def history(vi):
	return vi.page.evaluate("JSON.parse(localStorage.getItem('__viHistory__') || 'null')")


@pytest.fixture
def clean(vi):
	vi.page.evaluate("localStorage.removeItem('__viHistory__'); localStorage.removeItem('__viHistoryLimit__')")
	yield vi
	if vi.mode == "command":
		vi.keys("Escape")
	vi.page.evaluate("localStorage.removeItem('__viHistory__'); localStorage.removeItem('__viHistoryLimit__')")


def test_commands_are_remembered(clean):
	clean.load(["one", "two", "three"]).command("2").command("noh").command("1")
	assert history(clean)[":"] == ["2", "noh", "1"]
	# the same command again moves to the end
	clean.command("2")
	assert history(clean)[":"] == ["noh", "1", "2"]


def test_up_and_down_go_through_the_history(clean):
	clean.load(["one", "two", "three"]).command("2").command("noh").command("1")
	clean.keys(":", "ArrowUp")
	assert command_line(clean) == "1"
	clean.keys("ArrowUp")
	assert command_line(clean) == "noh"
	clean.keys("ArrowUp", "ArrowUp")
	assert command_line(clean) == "2"
	clean.keys("ArrowDown")
	assert command_line(clean) == "noh"
	clean.keys("ArrowDown", "ArrowDown")
	assert command_line(clean) == ""
	clean.keys("ArrowUp", "Enter")
	assert clean.mode == "normal"
	assert history(clean)[":"][-1] == "1"


def test_up_with_a_prefix(clean):
	clean.load(["one", "two", "three"]).command("2").command("noh").command("3")
	clean.keys(":", "n", "ArrowUp")
	assert command_line(clean) == "noh"
	clean.keys("ArrowUp")
	assert command_line(clean) == "noh"
	clean.keys("ArrowDown")
	assert command_line(clean) == "n"


def test_searches_have_their_own_history(clean):
	clean.load(["one", "two", "three"]).keys("/").page.keyboard.type("thr")
	clean.keys("Enter", "?").page.keyboard.type("on")
	clean.keys("Enter")
	assert history(clean)["/"] == ["thr", "on"]
	clean.keys("/", "ArrowUp")
	assert command_line(clean) == "on"
	clean.keys("Escape", ":", "ArrowUp")
	assert command_line(clean) == ""


def test_the_limit(clean):
	clean.page.evaluate("localStorage.setItem('__viHistoryLimit__', '2')")
	clean.load(["one", "two", "three"]).command("1").command("2").command("3")
	assert history(clean)[":"] == ["2", "3"]
	clean.page.evaluate("localStorage.setItem('__viHistoryLimit__', '0')")
	clean.command("1")
	assert history(clean) is None


def test_the_limit_in_settings(clean):
	clean.load(["one", "two", "three"]).command("1").command("2").command("3")
	page = clean.page
	page.evaluate("createSettingsModal()")
	field = page.locator("#setting-vi-history")
	assert field.input_value() == "100"
	field.fill("1")
	field.dispatch_event("change")
	assert page.evaluate("localStorage.getItem('__viHistoryLimit__')") == "1"
	assert history(clean)[":"] == ["3"]
	field.fill("123456")
	field.dispatch_event("change")
	assert field.input_value() == "9999"
	page.evaluate("closeAllModals()")
