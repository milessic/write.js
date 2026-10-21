"""
Code blocks (codeblocks.js): a Copy button in the top right corner of each code block copies its text; it is drawn
outside the editor, so it is never part of the document.
"""
import pytest

pytest.importorskip("playwright")

from tests.e2e.test_vi_repeat import vi  # noqa: F401


def test_copy_button_copies_the_code(vi):
	vi.load(html="<div>text</div><pre>let a = 1;<br>let b = 2;</pre><div>after</div>")
	vi.page.hover("#editor pre")
	vi.page.wait_for_selector(".editor-pane.focused .code-copy.shown")
	vi.page.click(".editor-pane.focused .code-copy.shown")
	vi.page.wait_for_function("document.querySelector('.editor-pane.focused .code-copy').textContent === 'Copied'")
	assert vi.page.evaluate("navigator.clipboard.readText()") == "let a = 1;\nlet b = 2;"


def test_a_button_for_each_block_outside_the_document(vi):
	vi.load(html="<pre>one</pre><div>text</div><pre>two</pre>")
	vi.page.wait_for_function("document.querySelectorAll('.editor-pane.focused .code-copy:not([hidden])').length === 2")
	assert vi.page.evaluate("document.getElementById('editor').querySelector('.code-copy')") is None
	vi.load(html="<div>no code</div>")
	vi.page.wait_for_function("document.querySelectorAll('.editor-pane.focused .code-copy').length === 0")


def test_shown_with_the_caret_in_the_block(vi):
	vi.load(html="<div>text</div><pre>code</pre>", at=(1, 0))
	vi.page.mouse.move(0, 0)
	vi.page.wait_for_selector(".editor-pane.focused .code-copy.shown")
	vi.keys("k")
	vi.page.wait_for_selector(".editor-pane.focused .code-copy:not(.shown)")
