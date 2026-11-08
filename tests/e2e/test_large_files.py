"""Large documents keep their scroll geometry and reuse vi's model between edits."""
import pytest

pytest.importorskip("playwright")
from tests.e2e.test_vi_repeat import vi  # noqa: F401


def test_large_file_scroll_reuses_model_and_keeps_scrollbar(vi):
    vi.load([f"line {i}: some text in a large document" for i in range(10000)])
    page = vi.page
    page.wait_for_timeout(200)
    page.evaluate("""() => {
        const editor = document.getElementById('editor');
        const getter = Object.getOwnPropertyDescriptor(Node.prototype, 'childNodes').get;
        window.modelWalks = 0;
        Object.defineProperty(editor, 'childNodes', {configurable: true, get() {
            if (/(?:at walk |walk@)/.test(new Error().stack)) { window.modelWalks++; }
            return getter.call(this);
        }});
    }""")
    try:
        geometry = page.evaluate("""async () => {
            const s = document.getElementById('editor').closest('.pane-scroll');
            const height = s.scrollHeight;
            const samples = [];
            for (const fraction of [.2, .7, .4, .95, .1]) {
                s.dispatchEvent(new WheelEvent('wheel', {bubbles: true, deltaY: 100}));
                const target = Math.round((height - s.clientHeight) * fraction);
                s.scrollTop = target;
                await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
                samples.push({target, actual: s.scrollTop, height: s.scrollHeight});
            }
            return {height, samples, walks: window.modelWalks};
        }""")
        assert geometry['walks'] == 0
        for sample in geometry['samples']:
            assert abs(sample['actual'] - sample['target']) <= 1
            assert sample['height'] == geometry['height']
    finally:
        page.evaluate("delete document.getElementById('editor').childNodes")


def test_large_file_model_updates_after_edit_and_replace(vi):
    vi.load([f"line {i}" for i in range(5000)])
    vi.keys("G", "$", "a").type(" appended").keys("Escape", "0")
    assert vi.page.evaluate("getSelection().focusNode.textContent") == "line 4999 appended"
    vi.keys("d", "d", "G")
    assert vi.page.evaluate("getSelection().focusNode.textContent") == "line 4998"
    vi.load(["replacement", "last"]).keys("G")
    assert vi.page.evaluate("getSelection().focusNode.textContent") == "last"


def test_large_file_line_numbers_preserve_geometry(vi):
    vi.load([f"line {i}" for i in range(5000)])
    page = vi.page
    page.evaluate("setLineNumbers(true)")
    try:
        page.wait_for_function("document.querySelectorAll('.line-numbers > span:not(.title-number)').length === 5000")
        page.wait_for_timeout(100)
        result = page.evaluate("""async () => {
            const s = document.getElementById('editor').closest('.pane-scroll');
            const height = s.scrollHeight;
            s.scrollTop = height - s.clientHeight;
            const target = s.scrollTop;
            await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
            const line = document.getElementById('editor').lastElementChild;
            const number = s.querySelector('.line-numbers').lastElementChild;
            return {height, after: s.scrollHeight, target, actual: s.scrollTop,
                number: number.textContent,
                difference: Math.abs(number.getBoundingClientRect().top - line.getBoundingClientRect().top)};
        }""")
        assert result['height'] == result['after']
        assert abs(result['target'] - result['actual']) <= 1
        assert result['number'] == '5000'
        assert result['difference'] < 10
    finally:
        page.evaluate("setLineNumbers(false)")
