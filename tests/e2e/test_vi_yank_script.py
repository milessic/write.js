"""Script buttons keep their boundary when vi puts a line into another document."""
import pytest

pytest.importorskip("playwright")
from tests.e2e.test_vi_repeat import vi  # noqa: F401


@pytest.mark.parametrize("new_line", [("o",), ("A", "Enter")])
def test_new_line_after_put_script_is_plain(vi, new_line):
	vi.load(html='<div>before <span class="script-activator" contenteditable="false" data-script="return 1" data-script-border="dashed">Run</span></div>').keys("y", "y")
	target = "script-target-" + new_line[0]
	vi.page.evaluate("name => localStorage.setItem('__doc__' + name, '<div>last</div>')", target)
	vi.command("e " + target).keys("G", "p")
	vi.keys(*new_line)
	assert vi.page.locator('#editor .script-activator').count() == 1
	assert vi.page.evaluate("document.querySelector('#editor').lastElementChild.outerHTML") == "<div><br></div>"
	vi.keys("Enter")
	assert vi.page.locator('#editor .script-activator').count() == 1
