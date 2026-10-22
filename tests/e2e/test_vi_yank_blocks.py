"""
Vi mode: yanked (or deleted) whole lines paste back as the blocks they were (headings, quotes), with their inline styles.
"""
import pytest

pytest.importorskip("playwright")

from tests.e2e.test_vi_repeat import vi  # noqa: F401

# Safari leaves a <br> at the end of a line it put HTML in
HTML = "() => document.getElementById('editor').innerHTML.replace(/<br><\\/div>/g, '</div>')"


def test_yy_p_pastes_a_heading(vi):
	vi.load(html="<h2>title</h2><div>text</div>").keys("y", "y", "j", "p")
	assert vi.page.evaluate(HTML) == "<h2>title</h2><div>text</div><h2>title</h2>"


def test_yj_P_pastes_heading_and_text(vi):
	vi.load(html="<h1>one</h1><div>two</div><div>three</div>").keys("y", "j", "G", "P")
	assert vi.page.evaluate(HTML) == "<h1>one</h1><div>two</div><h1>one</h1><div>two</div><div>three</div>"


def test_text_pasted_above_a_heading_stays_text(vi):
	vi.load(html="<div>text</div><h3>title</h3>").keys("y", "y", "j", "P")
	assert vi.page.evaluate(HTML) == "<div>text</div><div>text</div><h3>title</h3>"


def test_dd_p_moves_a_quote(vi):
	vi.load(html="<blockquote>quote</blockquote><div>text</div>").keys("d", "d", "p")
	assert vi.page.evaluate(HTML) == "<div>text</div><blockquote>quote</blockquote>"


def test_yy_p_keeps_inline_styles(vi):
	vi.load(html="<div>a <b>bold</b> and <i>it</i></div><div>x</div>").keys("y", "y", "j", "p")
	assert vi.page.evaluate(HTML) == "<div>a <b>bold</b> and <i>it</i></div><div>x</div><div>a <b>bold</b> and <i>it</i></div>"


def test_yy_p_keeps_a_styled_checklist_item(vi):
	vi.load(html='<ul><li data-checked="true">a <b>b</b></li></ul><div>x</div>').keys("y", "y", "j", "p")
	assert vi.page.evaluate("document.querySelectorAll('#editor li b').length") == 2
	assert vi.page.evaluate("[...document.querySelectorAll('#editor li')].map(li => li.dataset.checked)") == ["true", "true"]


def test_dd_on_a_first_heading_leaves_the_text_line(vi):
	vi.load(html="<h1>title</h1><div>text</div>").keys("d", "d")
	assert vi.page.evaluate(HTML) == "<div>text</div>"
