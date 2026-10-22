"""
Vi mode: the alternate Esc (Settings): one key or keys typed one after another (jk) also leave INSERT; set by
clicking Set, pressing the keys and Save.
"""
import pytest

from tests.e2e.test_vi_repeat import Vi

pytest.importorskip("playwright")


@pytest.fixture
def vi(page):
	yield Vi(page)
	page.evaluate("""() => { localStorage.removeItem("__viAltEsc__"); closeAllModals() }""")


def set_alt_esc(page, *keys):
	page.evaluate("createSettingsModal()")
	page.click("#setting-vi-alt-esc-set")
	for key in keys:
		page.keyboard.press(key)
	page.click("#setting-vi-alt-esc-set")
	page.evaluate("closeAllModals()")


def test_settings_record_the_pressed_keys(vi):
	set_alt_esc(vi.page, "j", "x", "Backspace", "k")
	assert vi.page.evaluate("viAltEscKeys()") == ["j", "k"]
	vi.page.evaluate("createSettingsModal()")
	assert vi.page.inner_text("#setting-vi-alt-esc-keys") == "jk"


def test_settings_cancel_and_esc_keep_the_keys(vi):
	set_alt_esc(vi.page, "Control+Space")
	vi.page.evaluate("createSettingsModal()")
	vi.page.click("#setting-vi-alt-esc-set")
	vi.page.keyboard.press("a")
	vi.page.click("#setting-vi-alt-esc-cancel")
	vi.page.click("#setting-vi-alt-esc-set")
	vi.page.keyboard.press("b")
	vi.page.keyboard.press("Escape")
	assert vi.page.evaluate("viAltEscKeys()") == ["<C-Space>"]


def test_typed_sequence_leaves_insert_without_its_text(vi):
	set_alt_esc(vi.page, "j", "k")
	vi.load(["abc"]).keys("A").type("xyjk")
	assert vi.mode == "normal"
	assert vi.lines == ["abcxy"]


def test_sequence_repeats_without_its_text(vi):
	set_alt_esc(vi.page, "j", "k")
	vi.load(["abc"]).keys("A").type("xjk").keys(".")
	assert vi.lines == ["abcxx"]


def test_slow_sequence_is_only_text(vi):
	set_alt_esc(vi.page, "j", "k")
	vi.load(["abc"]).keys("A").type("j")
	vi.page.wait_for_timeout(1100)
	vi.type("k")
	assert vi.mode == "insert"
	assert vi.lines == ["abcjk"]


def test_sequence_in_replace_puts_back_what_it_overwrote(vi):
	set_alt_esc(vi.page, "j", "k")
	vi.load(["abcdef"]).keys("R").type("xjk")
	assert vi.mode == "normal"
	assert vi.lines == ["xbcdef"]


def test_single_key_works_in_insert_and_normal(vi):
	set_alt_esc(vi.page, "Control+Space")
	vi.load(["abc"]).keys("A").type("x")
	vi.page.keyboard.press("Control+Space")
	assert vi.mode == "normal"
	assert vi.lines == ["abcx"]
	vi.keys("v")
	vi.page.keyboard.press("Control+Space")
	assert vi.mode == "normal"


def test_typed_key_alone_stays_a_command_in_normal(vi):
	set_alt_esc(vi.page, "j", "k")
	vi.load(["abc", "def"]).keys("j")
	assert vi.mode == "normal"
	assert vi.page.evaluate("getSelection().anchorNode.textContent") == "def"
