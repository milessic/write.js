"""Unsaved Script wizard edits require consent on X and Escape, but not Cancel."""
import pytest

from tests.e2e.test_scripting import app, add_script, toggle_scripts  # noqa: F401


def close_wizard(page, action):
	if action == "Escape":
		page.keyboard.press("Escape")
	else:
		page.locator('.script-wizard [aria-label="Close"]').click()


@pytest.mark.parametrize("existing", [False, True])
@pytest.mark.parametrize("field", ["name", "border", "code"])
@pytest.mark.parametrize("action", ["X", "Escape"])
def test_unsaved_changes_require_consent(app, existing, field, action):
	toggle_scripts(app)
	if existing:
		add_script(app, "Original", "return 1")
		app.locator("#editor .script-activator").click(button="right")
		app.locator("#context-menu button", has_text="Open Wizard").click()
	else:
		app.click("#tb-btn-script")
	if field == "border":
		border = app.locator(".script-border")
		other = app.locator(".script-border option").evaluate_all("options => options.find(o => !o.selected).value")
		border.select_option(other)
	else:
		app.locator(f".script-{field}").fill("Changed" if field == "name" else "return 2")
	with app.expect_event("dialog") as prompt:
		# Handle synchronously so the close action can return.
		app.once("dialog", lambda dialog: dialog.dismiss())
		close_wizard(app, action)
	assert prompt.value.type == "confirm"
	assert "without saving" in prompt.value.message
	assert app.locator(".script-wizard").is_visible()
	app.once("dialog", lambda dialog: dialog.accept())
	close_wizard(app, action)
	assert app.locator(".script-wizard").count() == 0
	assert app.locator("#editor .script-activator").count() == int(existing)
	if existing:
		assert app.locator("#editor .script-activator").inner_text() == "Original"
		assert app.locator("#editor .script-activator").get_attribute("data-script") == "return 1"


@pytest.mark.parametrize("action", ["X", "Escape", "Cancel", "Save"])
def test_clean_reverted_cancel_and_save_close_without_prompt(app, action):
	toggle_scripts(app)
	app.click("#tb-btn-script")
	prompts = []
	app.on("dialog", lambda dialog: (prompts.append(dialog.message), dialog.dismiss()))
	app.locator(".script-name").fill("Changed")
	if action in ["X", "Escape"]:
		app.locator(".script-name").fill("")
		close_wizard(app, action)
	else:
		app.locator(".script-code").fill("return 1")
		app.locator(f".script-{action.lower()}").click()
	assert app.locator(".script-wizard").count() == 0
	assert prompts == []
	assert app.locator("#editor .script-activator").count() == int(action == "Save")


@pytest.mark.parametrize("action", ["X", "Escape"])
@pytest.mark.parametrize("revert", [False, True])
def test_unchanged_existing_script_closes_without_prompt(app, action, revert):
	toggle_scripts(app)
	add_script(app, "Original", "return 1")
	app.locator("#editor .script-activator").click(button="right")
	app.locator("#context-menu button", has_text="Open Wizard").click()
	prompts = []
	app.on("dialog", lambda dialog: (prompts.append(dialog.message), dialog.dismiss()))
	if revert:
		app.locator(".script-name").fill("Changed")
		app.locator(".script-border").select_option(index=0)
		app.locator(".script-code").fill("return 2")
		app.locator(".script-name").fill("Original")
		app.locator(".script-border").select_option("dashed")
		app.locator(".script-code").fill("return 1")
	close_wizard(app, action)
	assert app.locator(".script-wizard").count() == 0
	assert prompts == []
