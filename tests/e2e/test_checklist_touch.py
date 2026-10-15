"""
A tap on a checklist item's checkbox on a phone toggles it once and leaves the caret and the scroll where they were
(iOS Safari moved the caret to the tap and scrolled the editor to it, checklist.js).
"""
import pytest

pytest.importorskip("playwright")

ITEMS = "".join(f'<li data-checked="false">item {i}</li>' for i in range(60))


@pytest.fixture
def phone(browser, server):
	context = browser.new_context(viewport={"width": 393, "height": 852}, has_touch=True, is_mobile=True)
	page = context.new_page()
	errors = []
	page.on("pageerror", lambda e: errors.append(str(e)))
	page.goto(server)
	page.evaluate("""() => {
		localStorage.clear();
		localStorage.setItem("__userConsent__", "1");
	}""")
	page.reload()
	page.evaluate("""(html) => {
		const editor = document.getElementById("editor");
		editor.innerHTML = `<div>top</div><ul>${html}</ul>`;
		editor.dispatchEvent(new Event("input", { bubbles: true }));
	}""", ITEMS)
	yield page
	assert errors == []
	context.close()


def scroller(page):
	# the element that scrolls the editor
	return """(() => {
		for ( let el = document.getElementById("editor"); el; el = el.parentElement ) {
			if ( el.scrollHeight > el.clientHeight + 1 && getComputedStyle(el).overflowY !== "visible" ) { return el }
		}
		return document.scrollingElement;
	})()"""


def test_tap_on_checkbox_toggles_once_without_moving_caret_or_scroll(phone):
	phone.evaluate(f"""() => {{
		const editor = document.getElementById("editor");
		editor.focus();
		const range = document.createRange();
		range.setStart(editor.firstChild.firstChild, 1);
		getSelection().removeAllRanges();
		getSelection().addRange(range);
		const li = [...editor.querySelectorAll("li")][40];
		li.scrollIntoView({{block: "center"}});
	}}""")
	before = phone.evaluate(f"{scroller(phone)}.scrollTop")
	assert before > 0
	x, y = phone.evaluate("""() => {
		const li = [...document.querySelectorAll("#editor li")][40];
		const rect = li.getBoundingClientRect();
		const fontSize = parseFloat(getComputedStyle(li).fontSize);
		return [rect.left - fontSize, rect.top + fontSize * .7];
	}""")
	# iOS ignores a cancelled mousedown: the tap itself (its touchend) has to be cancelled
	phone.evaluate("window.addEventListener('touchend', (e) => { window.tapCancelled = e.defaultPrevented })")
	phone.touchscreen.tap(x, y)
	phone.wait_for_timeout(100)
	assert phone.evaluate('[...document.querySelectorAll("#editor li")][40].dataset.checked') == "true"
	assert phone.evaluate("window.tapCancelled") is True
	assert phone.evaluate(f"{scroller(phone)}.scrollTop") == before
	caret = phone.evaluate("(() => { const r = getSelection().getRangeAt(0); return [r.startContainer.textContent, r.startOffset] })()")
	assert caret == ["top", 1]
