"""
Imported or appended Markdown looks as if it was typed: lines are <div>s, no blank lines from showdown's newlines,
no ids, classes or styles, and appending never puts lines inside a line.
"""
import pytest

pytest.importorskip("playwright")

MD = """# Title

Some **bold** and *italic* with `code` and a [link](http://x.y).
second line

Another para

- a
    - b
- [x] done

> quote

```
code
```

##### deep
"""


def html(page):
	return page.evaluate("document.getElementById('editor').innerHTML")


def test_replacing_with_markdown(page):
	page.evaluate("(md) => fillEditorWithHTML(markdownToHtml(md))", MD)
	assert html(page) == (
		'<h1>Title</h1>'
		'<div>Some <b>bold</b> and <i>italic</i> with <code>code</code> and a <a href="http://x.y">link</a>.</div>'
		'<div>second line</div><div><br></div><div>Another para</div>'
		'<ul><li>a</li><ul><li>b</li></ul><li data-checked="true">done</li></ul>'
		'<div>&gt; quote</div><pre>code</pre><h4>deep</h4>'
	)


def append(page, setup, selector, md):
	page.evaluate("""([setup, selector, md]) => {
		const editor = document.getElementById("editor");
		editor.innerHTML = setup;
		const range = document.createRange();
		range.selectNodeContents(editor.querySelector(selector));
		range.collapse(false);
		lastEditorRange = range;
		fillEditorWithHTML(markdownToHtml(md), true);
	}""", [setup, selector, md])
	return html(page)


def test_appending_on_an_empty_line(page):
	assert append(page, "<h2>Head</h2><div><br></div><div>x</div>", "div", "# T\n\ntext") == \
		"<h2>Head</h2><h1>T</h1><div>text</div><div>x</div>"


def test_appending_on_the_last_empty_line(page):
	assert append(page, "<h2>Head</h2><div><br></div>", "div", "# T\n\ntext") == "<h2>Head</h2><h1>T</h1><div>text</div>"


def test_appending_into_a_line_has_no_style(page):
	assert append(page, "<h2>Head</h2><div>abc</div>", "div", "some **bold** text") == \
		"<h2>Head</h2><div>abcsome <b>bold</b> text</div>"
