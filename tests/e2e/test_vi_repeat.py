"""
Vi mode: "." repeats the last change, for every kind of change.

Browser tests (Playwright + Chromium) against the app served by uvicorn:
    pip install -r requirements-dev.txt && playwright install chromium
    pytest tests/e2e
"""
import pytest

pytest.importorskip("playwright")

# a document line by line: the text of each block and list item, "" for an empty line; a pasted text keeps
# its line breaks in one block (white-space: pre-wrap), they are lines too
LINES_JS = """() => {
	const editor = document.getElementById("editor");
	const lines = [];
	for ( const block of editor.children ) {
		if ( block.matches("ul, ol") ) {
			for ( const li of block.querySelectorAll("li") ) { lines.push(li.textContent) }
		} else {
			lines.push(...block.textContent.split("\\n"));
		}
	}
	return lines;
}"""


def html_of(lines):
	return "".join(f"<div>{line or '<br>'}</div>" for line in lines)


@pytest.fixture
def vi(page):
	return Vi(page)


class Vi:
	def __init__(self, page):
		self.page = page

	def load(self, lines=None, html=None, at=(0, 0)):
		# a fresh document in NORMAL, the cursor on line, column
		self.page.evaluate("""(html) => {
			const editor = document.getElementById("editor");
			editor.innerHTML = html;
			editor.focus();
			const range = document.createRange();
			range.setStart(editor.firstElementChild.firstChild || editor.firstElementChild, 0);
			range.collapse(true);
			getSelection().removeAllRanges();
			getSelection().addRange(range);
		}""", html if html is not None else html_of(lines))
		self.keys("Escape", "g", "g", "0")
		line, column = at
		self.keys(*["j"] * line, *["l"] * column)
		return self

	def keys(self, *keys):
		# one key each: a character is typed, a name (Escape, Enter, Tab...) pressed
		for key in keys:
			self.page.keyboard.press(key) if len(key) > 1 else self.page.keyboard.type(key)
		return self

	def type(self, text):
		for char in text:
			self.page.keyboard.press("Enter") if char == "\n" else self.page.keyboard.type(char)
		return self

	def command(self, command):
		self.keys(":").page.keyboard.type(command)
		return self.keys("Enter")

	@property
	def lines(self):
		return self.page.evaluate(LINES_JS)

	@property
	def checked(self):
		return self.page.evaluate("[...document.querySelectorAll('#editor li')].map(li => li.dataset.checked)")

	@property
	def mode(self):
		return self.page.get_attribute(".vi-mode", "data-mode")


# deleting
def test_x(vi):
	vi.load(["abcdef"]).keys("x", ".")
	assert vi.lines == ["cdef"]


def test_x_with_count(vi):
	vi.load(["abcdefgh"]).keys("2", "x", ".")
	assert vi.lines == ["efgh"]


def test_count_before_dot_replaces_the_count(vi):
	vi.load(["abcdefgh"]).keys("x", "3", ".")
	assert vi.lines == ["efgh"]


def test_X(vi):
	vi.load(["abcdef"], at=(0, 4)).keys("X", ".")
	assert vi.lines == ["abef"]


def test_dd(vi):
	vi.load(["one", "two", "three", "four"]).keys("d", "d", ".")
	assert vi.lines == ["three", "four"]


def test_2dd(vi):
	vi.load(["1", "2", "3", "4", "5"]).keys("2", "d", "d", ".")
	assert vi.lines == ["5"]


def test_dw(vi):
	vi.load(["one two three four"]).keys("d", "w", ".")
	assert vi.lines == ["three four"]


def test_D(vi):
	vi.load(["abc", "def"], at=(0, 1)).keys("D", "j", "l", ".")
	assert vi.lines == ["a", "d"]


def test_d_text_object(vi):
	vi.load(["(a) (b)"], at=(0, 1)).keys("d", "i", "(", "w", "w", ".")
	assert vi.lines == ["() ()"]


# changing and inserting
def test_cw(vi):
	vi.load(["one two"]).keys("c", "w").type("X").keys("Escape", "w", ".")
	assert vi.lines == ["X X"]


def test_cc(vi):
	vi.load(["one", "two"]).keys("c", "c").type("new").keys("Escape", "j", ".")
	assert vi.lines == ["new", "new"]


def test_C(vi):
	vi.load(["abc", "def"], at=(0, 1)).keys("C").type("Z").keys("Escape", "j", ".")
	assert vi.lines == ["aZ", "dZ"]


def test_s(vi):
	vi.load(["abc"]).keys("s").type("XY").keys("Escape", "l", ".")
	assert vi.lines == ["XYXYc"]


def test_S(vi):
	vi.load(["one", "two"]).keys("S").type("s").keys("Escape", "j", ".")
	assert vi.lines == ["s", "s"]


def test_i(vi):
	vi.load(["abc"]).keys("i").type("xy").keys("Escape", ".")
	assert vi.lines == ["xxyyabc"]


def test_a(vi):
	vi.load(["abc"]).keys("a").type("-").keys("Escape", "l", ".")
	assert vi.lines == ["a-b-c"]


def test_I(vi):
	vi.load(["one", "two"]).keys("I").type("> ").keys("Escape", "j", ".")
	assert vi.lines == ["> one", "> two"]


def test_A(vi):
	vi.load(["one", "two"]).keys("A").type(";").keys("Escape", "j", ".")
	assert vi.lines == ["one;", "two;"]


def test_insert_with_backspace(vi):
	vi.load(["abc"]).keys("A").type("xyz").keys("Backspace", "Escape", "j", ".")
	assert vi.lines == ["abcxyxy"]


def test_insert_with_word_deleted(vi):
	vi.load(["a", "b"]).keys("A").type(" one two").keys("Control+Backspace", "Escape", "j", ".")
	assert vi.lines == ["a one ", "b one "]


def test_o_with_count(vi):
	vi.load(["x"]).keys("2", "o").type("n").keys("Escape")
	assert vi.lines == ["x", "n", "n"]
	vi.keys(".")
	assert vi.lines == ["x", "n", "n", "n", "n"]


def test_insert_several_lines(vi):
	vi.load(["end"]).keys("O").type("a\nb").keys("Escape", ".")
	assert vi.lines == ["a", "a", "b", "b", "end"]


def test_o(vi):
	vi.load(["one", "two"]).keys("o").type("new").keys("Escape", "j", ".")
	assert vi.lines == ["one", "new", "two", "new"]


def test_O(vi):
	vi.load(["one"]).keys("O").type("up").keys("Escape", ".")
	assert vi.lines == ["up", "up", "one"]


def test_insert_with_count(vi):
	vi.load(["x"]).keys("3", "i").type("ab").keys("Escape")
	assert vi.lines == ["abababx"]
	# like Vim, "." inserts it as many times again
	vi.keys("0", ".")
	assert vi.lines == ["abababababab" + "x"]


def test_R(vi):
	vi.load(["abcdef"]).keys("R").type("XY").keys("Escape", "l", ".")
	assert vi.lines == ["XYXYef"]


def test_r(vi):
	vi.load(["abcd"]).keys("r", "z", "l", ".")
	assert vi.lines == ["zzcd"]


def test_tilde(vi):
	vi.load(["abcd"]).keys("~", ".")
	assert vi.lines == ["ABcd"]


def test_gU_word(vi):
	vi.load(["one two"]).keys("g", "U", "w", "w", ".")
	assert vi.lines == ["ONE TWO"]


def test_guu(vi):
	vi.load(["ONE", "TWO"]).keys("g", "u", "u", "j", ".")
	assert vi.lines == ["one", "two"]


def test_J(vi):
	vi.load(["a", "b", "c"]).keys("J", ".")
	assert vi.lines == ["a b c"]


def test_gJ(vi):
	vi.load(["a", "b", "c"]).keys("g", "J", ".")
	assert vi.lines == ["abc"]


def test_indent(vi):
	vi.load(["one", "two"]).keys(">", ">", "j", ".")
	assert vi.lines == ["    one", "    two"]


# pasting
def test_p_characters(vi):
	vi.load(["ab"]).keys("y", "l", "p", ".")
	assert vi.lines == ["aaab"]


def test_P_characters(vi):
	vi.load(["ab"], at=(0, 1)).keys("y", "l", "P", ".")
	assert vi.lines == ["abbb"]


def test_p_lines(vi):
	vi.load(["one", "two"]).keys("y", "y", "p", ".")
	assert vi.lines == ["one", "one", "one", "two"]


def test_P_lines(vi):
	vi.load(["one", "two"], at=(1, 0)).keys("y", "y", "P", ".")
	assert vi.lines == ["one", "two", "two", "two"]


def test_p_after_delete(vi):
	vi.load(["abc"]).keys("x", "p", ".")
	assert vi.lines == ["baac"]


def test_paste_in_insert(vi, page):
	page.evaluate("navigator.clipboard.writeText('PASTE')")
	vi.load(["a", "b"]).keys("A", "Control+v", "Escape", "j", ".")
	assert vi.lines == ["aPASTE", "bPASTE"]


def test_paste_lines_in_insert(vi, page):
	page.evaluate("navigator.clipboard.writeText('1\\n2')")
	vi.load(["a", "b"]).keys("A", "Control+v", "Escape", "j", "j", ".")
	assert vi.lines == ["a1", "2", "b1", "2"]


# checklists
def test_tab_checks_checkbox(vi):
	vi.load(html='<ul><li data-checked="false">one</li><li data-checked="false">two</li></ul>')
	vi.keys("Tab", "j", ".")
	assert vi.checked == ["true", "true"]


def test_tab_unchecks_checkbox(vi):
	vi.load(html='<ul><li data-checked="true">one</li><li data-checked="false">two</li></ul>')
	vi.keys("Tab", ".")
	assert vi.checked == ["true", "false"]


def test_o_in_checklist(vi):
	vi.load(html='<ul><li data-checked="true">one</li></ul>')
	vi.keys("o").type("new").keys("Escape", ".")
	assert vi.lines == ["one", "new", "new"]
	assert vi.checked == ["true", "false", "false"]


# VISUAL: "." does the same to as much text from the cursor
def test_visual_d(vi):
	vi.load(["abcdefgh"]).keys("v", "l", "d", ".")
	assert vi.lines == ["efgh"]


def test_visual_line_d(vi):
	vi.load(["1", "2", "3", "4", "5"]).keys("V", "j", "d", ".")
	assert vi.lines == ["5"]


def test_visual_c(vi):
	vi.load(["abcdef"]).keys("v", "l", "c").type("X").keys("Escape", "l", ".")
	assert vi.lines == ["XXef"]


def test_visual_tilde(vi):
	vi.load(["abcdef"]).keys("v", "l", "~", "l", "l", ".")
	assert vi.lines == ["ABCDef"]


def test_visual_U(vi):
	vi.load(["ab", "cd"]).keys("V", "U", "j", ".")
	assert vi.lines == ["AB", "CD"]


def test_visual_r(vi):
	vi.load(["abcdef"]).keys("v", "l", "r", "x", "l", "l", ".")
	assert vi.lines == ["xxxxef"]


def test_visual_indent(vi):
	vi.load(["a", "b", "c", "d"]).keys("V", "j", ">", "j", "j", ".")
	assert vi.lines == ["    a", "    b", "    c", "    d"]


def test_visual_J(vi):
	vi.load(["a", "b", "c", "d"]).keys("V", "j", "J", "j", ".")
	assert vi.lines == ["a b", "c d"]


# what isn't a change keeps the last change
def test_yank_keeps_last_change(vi):
	vi.load(["abcd"]).keys("x", "y", "l", ".")
	assert vi.lines == ["cd"]


def test_motion_keeps_last_change(vi):
	vi.load(["abc", "abc"]).keys("x", "j", "0", ".")
	assert vi.lines == ["bc", "bc"]


def test_saving_keeps_last_change(vi, page):
	vi.load(["abcd"]).keys("x").command("w").keys(".")
	assert vi.lines == ["cd"]
	assert vi.mode == "normal"


def test_undo_keeps_last_change(vi):
	vi.load(["abcd"]).keys("x", "u", "0", "l", ".")
	assert vi.lines == ["acd"]


def test_dot_twice(vi):
	vi.load(["abcdef"]).keys("x", ".", ".")
	assert vi.lines == ["def"]


def test_dot_marks_tab_unsaved(vi, page):
	vi.load(["abcd"]).command("w").keys("x").command("w").keys(".")
	assert page.evaluate("getActiveTab().dirty") is True
