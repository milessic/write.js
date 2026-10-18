"""
Line numbers (linenumbers.js): Settings > Editor shows a number left of each line, the lines vi mode counts.
"""
import pytest

pytest.importorskip("playwright")

from tests.e2e.test_vi_repeat import vi  # noqa: F401

# the numbers shown left of the focused editor
NUMBERS_JS = """() => [...document.querySelector(".editor-pane.focused .line-numbers").children]
	.filter((el) => !el.hidden).map((el) => el.textContent)"""


@pytest.fixture
def numbered(vi):
	vi.page.evaluate("""() => { localStorage.setItem("__lineNumbers__", "1"); applyLineNumbersSetting() }""")
	yield vi
	vi.page.evaluate("""() => { localStorage.setItem("__lineNumbers__", "0"); applyLineNumbersSetting() }""")


def numbers(vi):
	vi.page.wait_for_timeout(50)
	return vi.page.evaluate(NUMBERS_JS)


def test_a_number_for_each_line_not_for_a_rule(numbered):
	numbered.load(html="<h2>heading</h2><hr><div>one</div><div><br></div><ul><li>a</li><li>b</li></ul><div>x<br>y</div>")
	assert numbers(numbered) == ["1", "2", "3", "4", "5", "6", "7"]


def test_numbers_follow_edits(numbered):
	numbered.load(["one", "two"]).keys("o").type("new").keys("Escape")
	assert numbers(numbered) == ["1", "2", "3"]
	numbered.keys("d", "d", "d", "d")
	assert numbers(numbered) == ["1"]


def test_number_is_on_its_line(numbered):
	numbered.load(["one", "two", "three"])
	numbered.page.wait_for_timeout(50)
	offsets = numbered.page.evaluate("""() => {
		const spans = [...document.querySelector(".editor-pane.focused .line-numbers").children];
		return [...document.getElementById("editor").children].map((line, i) => {
			const a = line.getBoundingClientRect(), b = spans[i].getBoundingClientRect();
			return Math.abs((a.top + a.bottom) / 2 - (b.top + b.bottom) / 2);
		});
	}""")
	assert all(offset < 3 for offset in offsets)


def test_caret_line_is_current(numbered):
	numbered.load(["one", "two", "three"], at=(1, 0))
	# drawn on the next frame
	numbered.page.wait_for_function("document.querySelector('.line-numbers .current')?.textContent === '2'", timeout=2000)
	current = numbered.page.evaluate("[...document.querySelectorAll('.line-numbers .current')].map(el => el.textContent)")
	assert current == ["2"]


def test_vi_goes_to_the_numbered_line(numbered):
	numbered.load(html="<h2>heading</h2><hr><div>one</div><div>two</div>").command("3").keys("i").type("X").keys("Escape")
	assert numbered.page.evaluate("document.getElementById('editor').children[3].textContent") == "Xtwo"


def test_off_shows_nothing(vi):
	vi.load(["one"])
	assert not vi.page.evaluate("document.body.classList.contains('show-line-numbers')")
	assert vi.page.evaluate("document.querySelectorAll('.line-numbers > span').length") == 0
