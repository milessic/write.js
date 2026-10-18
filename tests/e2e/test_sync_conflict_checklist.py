"""
Sync conflicts: the two versions are shown like documents, so a checklist item shows whether it is checked.
"""
import pytest

pytest.importorskip("playwright")

from tests.e2e.test_vi_repeat import vi  # noqa: F401

LOCAL = '<ul><li data-checked="false">task</li><li data-checked="true">done</li></ul>'
REMOTE = '<ul><li data-checked="true">task</li><li data-checked="true">done</li></ul>'


@pytest.fixture
def conflict(vi):
	vi.page.evaluate("""([local, remote]) => resolveSyncConflicts(
		[{key: "__doc__conflict", name: "conflict", local, remote}], "Cloud", true)""", [LOCAL, REMOTE])
	yield vi.page
	vi.page.evaluate("closeAllModals()")


def checkboxes(page):
	# per view, each item's checkbox fill
	return page.evaluate("""() => [...document.querySelectorAll("#modal .compare-view")].map((view) =>
		[...view.querySelectorAll("li")].map((li) => getComputedStyle(li, "::before").backgroundColor))""")


def test_checked_and_unchecked_items_look_different(conflict):
	local, remote = checkboxes(conflict)
	unchecked, checked = local
	assert unchecked != checked
	assert remote == [checked, checked]


def test_items_have_no_bullet(conflict):
	styles = conflict.evaluate("""() => [...document.querySelectorAll("#modal .compare-view li")]
		.map((li) => getComputedStyle(li).listStyleType)""")
	assert set(styles) == {"none"}
