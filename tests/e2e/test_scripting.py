"""
Scripting (scripting.js, scriptapi.js): a document with "scripts" in its metadata gets the "Script" tool, its wizard adds
a button at the caret that runs JavaScript on a click and opens the wizard again on a right click. The code is checked
(no localStorage / sessionStorage), runs with its own scope, emptied after it, and the helpers only see its document.
A right click on a line's "+" assigns ids to lines and lists.
"""
import json
import re

import pytest

pytest.importorskip("playwright")

META = re.compile(r'^<div style="display:none;" data-id="[0-9a-f-]{36}"></div><div style="display:none;" data-meta="([^"]*)"></div>')
DOC = "<h1>Tasks</h1><div>intro</div><ul><li data-checked=\"true\">done</li><li data-checked=\"false\">todo</li></ul><h1>Other</h1><div>end</div>"
NOTES = "#notifications-container"


@pytest.fixture
def app(browser, server):
	context = browser.new_context(viewport={"width": 1400, "height": 900})
	page = context.new_page()
	page.errors = []
	page.on("pageerror", lambda e: page.errors.append(str(e)))
	page.goto(server)
	page.evaluate("""(doc) => {
		localStorage.clear();
		localStorage.setItem("__userConsent__", "1");
		localStorage.setItem("__autosave__", "0");
		localStorage.setItem("__doc__plan", doc);
		localStorage.setItem("__lastOpened__", "plan");
	}""", DOC)
	page.reload()
	page.wait_for_function("getActiveTab()?.name === 'plan'")
	yield page
	assert page.errors == []
	context.close()


def stored_meta(page, name="plan"):
	match = META.match(page.evaluate("(name) => localStorage.getItem('__doc__' + name)", name) or "")
	return json.loads(match.group(1).replace("&quot;", '"')) if match else {}


def toggle_scripts(page, label="Enable scripts"):
	page.locator("#tabs .tab.active").click(button="right")
	page.locator("#context-menu button", has_text=label).click()


def add_script(page, name, code, border="dashed", after="intro"):
	page.locator("#editor").get_by_text(after, exact=True).click()
	page.keyboard.press("End")
	page.click("#tb-btn-script")
	page.fill(".script-wizard .script-name", name)
	page.select_option(".script-wizard .script-border", border)
	page.fill(".script-wizard .script-code", code)
	page.click(".script-wizard .script-save")


def code_text(page):
	return page.evaluate("scriptCodeText(document.querySelector('.script-wizard .script-code'))")


def notes(page):
	return page.locator(NOTES).inner_text()


def test_script_tool_only_with_scripts_enabled(app):
	assert not app.locator("#tb-btn-script").is_visible()
	toggle_scripts(app)
	assert app.locator("#tb-btn-script").is_visible()
	app.click("#save-btn")
	assert stored_meta(app) == {"scripts": True}
	toggle_scripts(app, "Disable scripts")
	assert not app.locator("#tb-btn-script").is_visible()
	app.click("#save-btn")
	assert stored_meta(app) == {}


def test_wizard_adds_a_button_that_runs_the_script(app):
	toggle_scripts(app)
	add_script(app, "Count", """
		const section = locateHeading("Tasks");
		const items = getListElements(null, false);
		createNotification(`${section.hText}: ${items.filter((i) => i.checked).length}/${items.length}, ${section.children.length} lines`);
	""")
	assert not app.locator(".script-wizard").count()
	button = app.locator("#editor .script-activator")
	assert button.text_content() == "Count"
	assert button.get_attribute("data-script-border") == "dashed"
	# at the caret, after the line's text
	assert app.evaluate("document.querySelector('#editor .script-activator').parentElement.textContent") == "introCount"
	button.click()
	app.wait_for_selector(f"{NOTES} .script-notification-head")
	assert "Tasks: 1/2, 2 lines" in notes(app)
	assert "'Count' executed" in notes(app)
	assert app.locator(f"{NOTES} .script-notification-head").first.text_content() == "Script execution"
	# saved with the document
	app.click("#save-btn")
	assert 'class="script-activator"' in app.evaluate("localStorage.getItem('__doc__plan')")


def test_code_is_checked_before_it_is_added(app):
	toggle_scripts(app)
	add_script(app, "Bad", "localStorage.clear()")
	assert app.locator(".script-wizard").is_visible()
	assert "localStorage can't be used" in app.locator(".script-wizard .script-check").inner_text()
	app.fill(".script-wizard .script-code", "const x = ;")
	app.click(".script-wizard .script-save")
	assert "SyntaxError" in app.locator(".script-wizard .script-check").inner_text()
	app.fill(".script-wizard .script-code", "window['session' + 'Storage'].clear()")
	app.click(".script-wizard .script-save")
	assert app.locator(".script-wizard .script-check").inner_text() != ""
	assert not app.locator("#editor .script-activator").count()


def test_disabled_scripts_dont_run(app):
	toggle_scripts(app)
	add_script(app, "Mark", "scope.done = true; locateById('missing'); editor.querySelector('div').textContent = 'changed';")
	toggle_scripts(app, "Disable scripts")
	app.locator("#editor .script-activator").click()
	app.wait_for_selector(f"{NOTES} .notification-warn")
	assert "Scripts are disabled" in notes(app)
	assert app.locator("#editor").get_by_text("changed").count() == 0
	# the wizard is disabled too
	app.locator("#editor .script-activator").click(button="right")
	assert app.locator("#context-menu button", has_text="Open Wizard").is_disabled()


def test_right_click_opens_the_wizard_to_edit(app):
	toggle_scripts(app)
	add_script(app, "First", "createNotification('one')")
	app.locator("#editor .script-activator").click(button="right")
	app.locator("#context-menu button", has_text="Open Wizard").click()
	assert app.input_value(".script-wizard .script-name") == "First"
	assert code_text(app) == "createNotification('one')"
	app.fill(".script-wizard .script-name", "Second")
	app.select_option(".script-wizard .script-border", "none")
	app.click(".script-wizard .script-save")
	button = app.locator("#editor .script-activator")
	assert button.count() == 1
	assert button.text_content() == "Second"
	assert button.get_attribute("data-script-border") == "none"


def test_errors_and_scope(app):
	toggle_scripts(app)
	# strict mode: no globals leak, the scope is emptied after the run
	add_script(app, "Leak", "scope.kept = 1; leaked = 2;")
	app.locator("#editor .script-activator").click()
	app.wait_for_selector(f"{NOTES} .notification-error")
	assert "'Leak' failed" in notes(app)
	assert app.evaluate("typeof window.leaked") == "undefined"
	assert app.evaluate("Object.keys(scriptScopes).length") == 0
	assert app.evaluate("""async () => {
		const button = document.querySelector('#editor .script-activator');
		button.dataset.script = "scope.a = 1; await new Promise((r) => setTimeout(r, 50)); createNotification('a=' + scope.a);";
		const run = runScript(button);
		const during = Object.values(scriptScopes).map((s) => s.a);
		await run;
		return [during, Object.keys(scriptScopes).length];
	}""") == [[1], 0]
	assert "a=1" in notes(app)
	# the selector of locateHeading has to be a text or a number
	app.evaluate("document.querySelector('#editor .script-activator').dataset.script = 'locateHeading({})'")
	app.locator("#editor .script-activator").click()
	app.wait_for_function("document.querySelector('#notifications-container').innerText.includes('the selector has to be')")


def test_assign_ids_from_the_add_comment_button(app):
	toggle_scripts(app)
	answers = iter(["todo-item", "tasks", "tasks"])
	app.on("dialog", lambda d: d.accept(next(answers)))
	app.locator("#editor").get_by_text("todo", exact=True).hover()
	app.locator(".line-comment-add:visible").click(button="right")
	app.locator("#context-menu button", has_text="Assign ID to item").click()
	app.locator("#editor").get_by_text("todo", exact=True).hover()
	app.locator(".line-comment-add:visible").click(button="right")
	app.locator("#context-menu button", has_text="Assign ID to list").click()
	assert app.evaluate("document.querySelector('#editor ul').dataset.elementId") == "tasks"
	assert app.evaluate("document.querySelector('#editor li[data-checked=false]').dataset.elementId") == "todo-item"
	# ids are unique in the document
	app.locator("#editor").get_by_text("intro", exact=True).hover()
	app.locator(".line-comment-add:visible").click(button="right")
	app.locator("#context-menu button", has_text="Assign ID to line").click()
	assert "already used" in notes(app)
	assert app.evaluate("document.querySelector('#editor h1 + div').dataset.elementId") is None

	add_script(app, "Ids", "createNotification(locateById('todo-item').textContent + ' ' + getListElements('tasks').length + ' ' + locateHeading(2).hText)")
	app.locator("#editor .script-activator").click()
	app.wait_for_function("document.querySelector('#notifications-container').innerText.includes('todo 2 Other')")


def test_help_lists_the_functions_of_the_api_file(app):
	toggle_scripts(app)
	app.click("#tb-btn-script")
	app.click(".script-wizard .script-help-btn")
	app.wait_for_selector(".script-help-modal .script-help-function")
	names = app.locator(".script-help-modal .script-help-function code").all_inner_texts()
	assert names == ["locateHeading(selector, level=null)", "locateById(id)", "getListElements(list=null, textOnly=true)", "checkCheckbox(target)", "uncheckCheckbox(target)", "getDocTitle()", "setDocTitle(title)", "getRandomFromArray(array)", "createNotification(text, type=\"info\", timeout=notificationTimeout, timestamp=false)", "duplicateDocument(documentQuery)"]
	assert "localStorage" in app.locator(".script-help-modal").inner_text()
	# closing the help leaves the wizard open
	app.click(".script-help-modal .section-head .small-btn")
	assert app.locator(".script-wizard").is_visible()


def test_exports_leave_the_buttons_out(app):
	toggle_scripts(app)
	add_script(app, "Gone", "createNotification('x')")
	assert 'class="script-activator"' not in app.evaluate("getDocumntContentToExport()")
	assert "Gone" not in app.evaluate("getContentAsMarkdown(withoutScripts(getDocumentText()))")


def box(page, selector):
	return page.locator(selector).bounding_box()


def test_wizard_and_help_are_movable_windows(app):
	toggle_scripts(app)
	app.evaluate("document.querySelectorAll('.notification-container').forEach((n) => n.remove())")
	app.click("#tb-btn-script")
	# no backdrop: the document stays usable
	assert not app.locator("#overlay").count()
	before = box(app, ".script-wizard")
	head = box(app, ".script-wizard .section-head")
	app.mouse.move(head["x"] + 40, head["y"] + head["height"] / 2)
	app.mouse.down()
	app.mouse.move(head["x"] - 60, head["y"] + head["height"] / 2 + 90, steps=5)
	app.mouse.up()
	after = box(app, ".script-wizard")
	assert (round(after["x"] - before["x"]), round(after["y"] - before["y"])) == (-100, 90)

	# the help opens beside the wizard, both stay open and the code can be typed with the help shown
	app.click(".script-wizard .script-help-btn")
	app.wait_for_selector(".script-help-modal .script-help-function")
	wizard, help = box(app, ".script-wizard"), box(app, ".script-help-modal")
	assert help["x"] >= wizard["x"] + wizard["width"]
	app.click(".script-wizard .script-code")
	app.keyboard.type("createNotification('hi')")
	assert code_text(app) == "createNotification('hi')"
	assert app.locator(".script-help-modal").is_visible()
	# the window clicked last is on top
	z = lambda sel: int(app.eval_on_selector(sel, "(el) => el.style.zIndex"))
	assert z(".script-wizard") > z(".script-help-modal")
	app.click(".script-help-modal h3")
	assert z(".script-help-modal") > z(".script-wizard")

	# dragged far away, the title bar stays on the screen
	head = box(app, ".script-help-modal .section-head")
	app.mouse.move(head["x"] + 40, head["y"] + 10)
	app.mouse.down()
	app.mouse.move(head["x"] + 40, -500, steps=3)
	app.mouse.up()
	assert box(app, ".script-help-modal")["y"] == 0


def test_returned_value_is_shown_as_text(app):
	toggle_scripts(app)
	add_script(app, "Report", "return { done: getListElements(null, false).filter((i) => i.checked).length, texts: getListElements(), html: '<b>bold</b>' }")
	app.locator("#editor .script-activator").click()
	result = app.locator(f"{NOTES} .script-notification-result")
	result.wait_for()
	assert '"done": 1' in result.inner_text()
	assert '"texts": [\n    "done",\n    "todo"\n  ]' in result.inner_text()
	assert '"html": "<b>bold</b>"' in result.inner_text()
	assert not result.locator("b").count()
	# nothing returned: no result
	app.evaluate("document.querySelectorAll('.notification-container').forEach((n) => n.remove())")
	app.evaluate("document.querySelector('#editor .script-activator').dataset.script = 'createNotification(1)'")
	app.locator("#editor .script-activator").click()
	app.wait_for_function("document.querySelector('#notifications-container').innerText.includes('executed')")
	assert not result.count()


@pytest.fixture
def vi_app(app):
	app.evaluate("localStorage.setItem('__viMode__', '1')")
	app.reload()
	app.wait_for_function("window.WriteVi && getActiveTab()?.name === 'plan'")
	return app


def vi_command(page, command):
	page.keyboard.press("Escape")
	page.keyboard.type(":" + command)
	page.keyboard.press("Enter")


def test_vi_script_command(vi_app):
	app = vi_app
	toggle_scripts(app)
	app.locator("#editor").get_by_text("intro", exact=True).click()
	vi_command(app, "script")
	app.wait_for_selector(".script-wizard")
	app.fill(".script-wizard .script-name", "Hello")
	# the code is edited with vi: i to type
	app.click(".script-wizard .script-code")
	app.keyboard.press("Escape")
	app.keyboard.type("ireturn 'hi from vi'")
	app.click(".script-wizard .script-save")
	# at the end of the cursor's line
	assert app.evaluate("document.querySelector('#editor .script-activator').parentElement.textContent") == "introHello"
	# :script name runs it
	app.locator("#editor").get_by_text("end", exact=True).click()
	vi_command(app, "script Hello")
	app.wait_for_function("document.querySelector('#notifications-container').innerText.includes('hi from vi')")


def test_vi_in_the_script_wizard(vi_app):
	app = vi_app
	toggle_scripts(app)
	app.locator("#editor").get_by_text("intro", exact=True).click()
	vi_command(app, "script")
	app.fill(".script-wizard .script-name", "Vi")
	app.click(".script-wizard .script-code")
	mode = lambda: app.evaluate("document.querySelector('#vi-root .vi-mode').dataset.mode")
	app.keyboard.press("Escape")
	assert mode() == "normal"
	# typing letters in NORMAL doesn't change the code
	app.keyboard.type("x")
	assert code_text(app) == ""
	app.keyboard.type("i")
	assert mode() == "insert"
	app.keyboard.type("return 'one'")
	app.keyboard.press("Enter")
	app.keyboard.type("// two")
	# Esc changes the mode, it doesn't close the wizard
	app.keyboard.press("Escape")
	assert mode() == "normal"
	assert app.locator(".script-wizard").is_visible()
	assert code_text(app) == "return 'one'\n// two"
	# vi's own edits: dd deletes the line, u brings it back
	app.keyboard.type("dd")
	assert code_text(app) == "return 'one'"
	app.keyboard.type("u")
	assert code_text(app) == "return 'one'\n// two"
	# q doesn't close it, the mode shows over the wizard
	app.keyboard.type("q")
	assert app.locator(".script-wizard").is_visible()
	assert app.evaluate("document.body.classList.contains('vi-in-window')")
	# :w adds the script
	app.keyboard.type(":w")
	app.keyboard.press("Enter")
	assert not app.locator(".script-wizard").count()
	assert app.locator("#editor .script-activator").get_attribute("data-script") == "return 'one'\n// two"
	app.locator("#editor .script-activator").click()
	app.wait_for_function("document.querySelector('#notifications-container').innerText.includes('one')")
	# :q closes the wizard without saving
	app.locator("#editor .script-activator").click(button="right")
	app.locator("#context-menu button", has_text="Open Wizard").click()
	app.click(".script-wizard .script-code")
	app.keyboard.press("Escape")
	app.keyboard.type("dd:q")
	app.keyboard.press("Enter")
	assert not app.locator(".script-wizard").count()
	assert app.locator("#editor .script-activator").get_attribute("data-script") == "return 'one'\n// two"


def test_new_buttons_are_dashed_by_default(app):
	toggle_scripts(app)
	app.click("#tb-btn-script")
	assert app.input_value(".script-wizard .script-border") == "dashed"


def test_get_random_from_array(app):
	toggle_scripts(app)
	add_script(app, "Pick", """
		const picks = new Set();
		for ( let i = 0; i < 200; i++ ) { picks.add(getRandomFromArray(getListElements())) }
		let thrown = false;
		try { getRandomFromArray("abc") } catch ( err ) { thrown = true }
		return [...picks].sort().join(",") + " " + getRandomFromArray([]) + " " + thrown;
	""")
	app.locator("#editor .script-activator").click()
	app.wait_for_function("document.querySelector('#notifications-container').innerText.includes('done,todo null true')")


CHANGE = "locateById ? editor.querySelector('h1 + div').textContent = 'changed' : 0; getListElements(null, false)[1].element.dataset.checked = 'true'"


def run_change(app):
	app.locator("#editor .script-activator").click()
	app.wait_for_function("document.querySelector('#editor').textContent.includes('changed')")


def state(app):
	return app.evaluate("[document.querySelector('#editor h1 + div').textContent.replace(/Change$/, ''), document.querySelectorAll('#editor li[data-checked=true]').length]")


def test_undo_and_redo_a_scripts_changes(app):
	toggle_scripts(app)
	add_script(app, "Change", CHANGE, after="end")
	run_change(app)
	assert state(app) == ["changed", 2]
	app.keyboard.press("Control+z")
	assert state(app) == ["intro", 1]
	assert app.locator("#editor .script-activator").count() == 1
	app.keyboard.press("Control+Shift+z")
	assert state(app) == ["changed", 2]
	app.keyboard.press("Control+z")
	app.keyboard.press("Control+y")
	assert state(app) == ["changed", 2]
	# the document is marked changed (unsaved tab)
	assert app.locator("#tabs .tab.active.dirty").count() == 1


def test_typing_after_a_script_is_undone_first(app):
	toggle_scripts(app)
	add_script(app, "Change", CHANGE, after="end")
	run_change(app)
	app.locator("#editor").get_by_text("Other", exact=True).click()
	app.keyboard.press("End")
	app.keyboard.type("!")
	assert app.locator("#editor h1").nth(1).text_content() == "Other!"
	app.keyboard.press("Control+z")
	assert app.locator("#editor h1").nth(1).text_content() == "Other"
	assert state(app) == ["changed", 2]
	app.keyboard.press("Control+z")
	assert state(app) == ["intro", 1]


def test_vi_u_undoes_a_scripts_changes(vi_app):
	app = vi_app
	toggle_scripts(app)
	app.locator("#editor").get_by_text("end", exact=True).click()
	vi_command(app, "script")
	app.fill(".script-wizard .script-name", "Change")
	app.click(".script-wizard .script-code")
	app.keyboard.press("Escape")
	app.keyboard.press("i")
	app.keyboard.insert_text(CHANGE)
	app.keyboard.press("Escape")
	app.keyboard.type(":w")
	app.keyboard.press("Enter")
	run_change(app)
	app.click("#editor h1 >> nth=0")
	app.keyboard.press("Escape")
	app.keyboard.type("u")
	assert state(app) == ["intro", 1]
	app.keyboard.press("Control+r")
	assert state(app) == ["changed", 2]


def test_notification_tells_the_document_changed(app):
	toggle_scripts(app)
	add_script(app, "Change", CHANGE, after="end")
	run_change(app)
	app.wait_for_function("document.querySelector('#notifications-container').innerText.includes('It changed the document: Ctrl+Z undoes it')")
	# a script that changes nothing doesn't say so
	app.evaluate("document.querySelectorAll('.notification-container').forEach((n) => n.remove())")
	app.evaluate("document.querySelector('#editor .script-activator').dataset.script = 'createNotification(1)'")
	app.locator("#editor .script-activator").click()
	app.wait_for_function("document.querySelector('#notifications-container').innerText.includes('executed')")
	assert "changed the document" not in notes(app)


def test_get_and_set_the_documents_title(app):
	toggle_scripts(app)
	app.evaluate("localStorage.setItem('__doc__taken', '<div>x</div>')")
	add_script(app, "Rename", """
		const old = getDocTitle();
		let thrown = "";
		try { setDocTitle("taken") } catch ( err ) { thrown = err.message }
		setDocTitle("plan " + getListElements().length);
		return old + " -> " + getDocTitle() + " | " + thrown;
	""")
	app.locator("#editor .script-activator").click()
	app.wait_for_function("document.querySelector('#notifications-container').innerText.includes('plan -> plan 2 | setDocTitle: there is another document named')")
	assert app.input_value("#doc-name") == "plan 2"
	assert app.locator("#tabs .tab.active .tab-name").text_content() == "plan 2"
	# saved under the new name, the old one goes
	app.click("#save-btn")
	assert app.evaluate("[localStorage.getItem('__doc__plan 2') !== null, localStorage.getItem('__doc__plan')]") == [True, None]


def test_get_document_id_from_the_menus(app):
	doc_id = app.evaluate("documentIdOf('plan')")
	app.evaluate("document.querySelectorAll('.notification-container').forEach((n) => n.remove())")
	app.locator("#tabs .tab.active").click(button="right")
	app.locator("#context-menu button", has_text="Get Document Id").click()
	note = app.locator("#notifications-container .notification-container", has_text=doc_id)
	assert note.locator(".document-id").text_content() == doc_id
	# it stays until closed
	app.wait_for_timeout(3500)
	assert note.count() == 1
	note.locator(".small-btn").click()
	app.evaluate("showFileTree()")
	app.locator("#file-tree-list .tree-document", has_text="plan").click(button="right")
	app.locator("#context-menu button", has_text="Get Document Id").click()
	assert app.locator("#notifications-container .document-id").text_content() == doc_id


def test_help_close_button_stays_in_view(app):
	toggle_scripts(app)
	app.set_viewport_size({"width": 1400, "height": 420})
	app.click("#tb-btn-script")
	app.click(".script-wizard .script-help-btn")
	app.wait_for_selector(".script-help-modal .script-help-function")
	content = ".script-help-modal .modal-content"
	assert app.eval_on_selector(content, "(el) => el.scrollHeight > el.clientHeight")
	app.eval_on_selector(content, "(el) => { el.scrollTop = el.scrollHeight }")
	close = app.locator(".script-help-modal .section-head .small-btn")
	box = close.bounding_box()
	assert 0 <= box["y"] and box["y"] + box["height"] <= 420
	close.click()
	assert not app.locator(".script-help-modal").count()


def test_check_and_uncheck_checkboxes(app):
	toggle_scripts(app)
	checked = lambda: app.evaluate("[...document.querySelectorAll('#editor li')].map((li) => li.dataset.checked)")
	assert checked() == ["true", "false"]
	add_script(app, "Check", """
		const [done, todo] = getListElements(null, false);
		const counts = [uncheckCheckbox(done.element), checkCheckbox(todo), checkCheckbox(editor.querySelector("ul"))];
		const errors = [];
		for ( const bad of ["missing", locateHeading(1).element] ) {
			try { checkCheckbox(bad) } catch ( err ) { errors.push(err.message) }
		}
		return counts.join(",") + " | " + errors.join(" | ");
	""")
	app.locator("#editor .script-activator").click()
	app.wait_for_function("document.querySelector('#notifications-container').innerText.includes('1,1,1 | checkCheckbox: no item or list')")
	assert "a list item or a list is needed, not <h1>" in notes(app)
	assert checked() == ["true", "true"]
	# a list of the document by its id: all its checkboxes
	app.evaluate("document.querySelector('#editor ul').dataset.elementId = 'tasks'")
	app.evaluate("document.querySelector('#editor .script-activator').dataset.script = 'return uncheckCheckbox(\"tasks\")'")
	app.locator("#editor .script-activator").click()
	app.wait_for_function("document.querySelector('#notifications-container').innerText.includes('changed the document')")
	assert checked() == ["false", "false"]
	# undone like the scripts' other changes
	app.keyboard.press("Control+z")
	assert checked() == ["true", "true"]
