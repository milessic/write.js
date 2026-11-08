"""Vi tab motions keep each document's caret when reusing an editor pane."""
import pytest

pytest.importorskip("playwright")

from tests.e2e.test_doc_positions import docs  # noqa: F401
from tests.e2e.test_vi_repeat import Vi


def caret(page):
	return page.evaluate("[getSelection().focusNode.textContent, getSelection().focusOffset]")


def test_vi_tab_motions_restore_each_caret(docs):
	docs.evaluate("openDocumentInTab('long'); openDocumentInTab('short'); openDocumentInTab('long')")
	vi = Vi(docs)
	docs.locator('#editor').focus()
	vi.keys('g', 'g', '0', 'j', 'l', 'l')
	assert caret(docs) == ['line 1', 2]
	vi.keys('g', 't')
	assert docs.evaluate('getActiveTab().name') == 'short'
	vi.keys('g', 'g', '0', 'l', 'l', 'l')
	assert caret(docs) == ['short', 3]
	vi.keys('g', 'T')
	assert docs.evaluate('getActiveTab().name') == 'long'
	assert caret(docs) == ['line 1', 2]
	vi.keys('g', 't')
	assert caret(docs) == ['short', 3]
