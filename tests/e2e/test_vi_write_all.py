"""
Vi mode: :wa saves every document with unsaved changes, in an editor or in a tab that isn't shown.
"""
import pytest

from test_vi_repeat import Vi

pytest.importorskip("playwright")


@pytest.fixture
def vi(page):
	page.evaluate("""() => {
		localStorage.setItem("__doc__test", "<div>test</div>");
		localStorage.setItem("__doc__other", "<div>xyz</div>");
		localStorage.setItem("__doc__third", "<div>uvw</div>");
		refreshFileTree(true);
	}""")
	vi = Vi(page)
	page.click("#editor")
	vi.keys("Escape").command("qa!").command("e test")
	yield vi
	# back to the one saved document the other tests start with
	page.click("#editor")
	vi.keys("Escape").command("qa!")
	page.evaluate("""() => localStorage.setItem("__doc__test", "<div>test</div>")""")
	vi.command("e test")


def stored(page, name):
	return page.evaluate(f"""() => {{
		const box = document.createElement("div");
		box.innerHTML = localStorage.getItem("__doc__{name}");
		return box.textContent;
	}}""")


def dirty(page):
	return page.evaluate("tabs.filter(t => t.dirty).map(t => t.name)")


def test_wa_saves_shown_and_hidden_tabs(vi, page):
	vi.keys("g", "g", "0", "i").type("A").keys("Escape")
	vi.command("e other")
	vi.keys("g", "g", "0", "i").type("B").keys("Escape")
	vi.command("e third")
	assert sorted(dirty(page)) == ["other", "test"]
	vi.command("wa")
	assert dirty(page) == []
	assert stored(page, "test") == "Atest"
	assert stored(page, "other") == "Bxyz"
	assert stored(page, "third") == "uvw"
	# a saved tab shows its saved document again
	vi.command("e test")
	assert page.evaluate("document.getElementById('editor').textContent") == "Atest"


def test_wa_saves_the_split_editors(vi, page):
	vi.keys("g", "g", "0", "i").type("A").keys("Escape")
	vi.command("vsplit")
	vi.command("e other")
	vi.keys("g", "g", "0", "i").type("B").keys("Escape")
	vi.command("wa")
	assert dirty(page) == []
	assert stored(page, "test") == "Atest"
	assert stored(page, "other") == "Bxyz"
