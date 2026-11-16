import pytest

pytest.importorskip("playwright")

from tests.e2e.test_doc_title import app  # noqa: F401


def test_heading_threshold_is_stable_and_has_scroll_offset(app):
	result = app.evaluate("""() => {
		localStorage.setItem(floatingHeadingsKey, JSON.stringify({desktop: 'all'}));
		const pane = focusedPane;
		pane.editor.innerHTML = '<h1>Parent</h1><h2>Child</h2><h1>Next</h1>' + '<div>text</div>'.repeat(100);
		const scroller = pane.el.querySelector('.pane-scroll');
		const headings = [...pane.editor.querySelectorAll('h1, h2')];
		const next = headings[2];
		const top = scroller.getBoundingClientRect().top;
		scroller.scrollTop += next.getBoundingClientRect().top - top + 4;
		renderFloatingHeadings(pane);
		const before = pane.floatingHeadings.map(h => h.textContent);
		scroller.scrollTop += 8;
		const samples = [];
		for (let n = 0; n < 12; n++) {
			renderFloatingHeadings(pane);
			samples.push(pane.floatingHeadings.map(h => h.textContent));
		}
		return {before, samples};
	}""")
	assert result["before"] == ["Parent", "Child"]
	assert result["samples"] == [["Next"]] * 12
