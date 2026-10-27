"""
Script secrets (secrets.js): a synced secret goes to every device of the account, a local one stays in its browser.
A local secret can be made synced, not the other way round; scripts read them with secret() (scriptapi.js).
"""
import pytest

pytest.importorskip("playwright")

from tests.e2e.test_cloud_sync import open_device, register, sync


@pytest.fixture(scope="module")
def devices(browser, server):
	user = register(server)
	a = open_device(browser, server, user)
	b = open_device(browser, server, user)
	yield a, b
	assert a.errors == [] and b.errors == []
	a.context.close()
	b.context.close()


def secrets(page):
	return page.evaluate("readScriptSecrets()")


def open_modal(page):
	page.evaluate("openScriptSecretsModal()")
	return page.locator(".script-secrets-modal")


def add(page, name, value, synced):
	modal = open_modal(page)
	modal.locator(".script-secret-new-name").fill(name)
	modal.locator(".script-secret-new-value").fill(value)
	modal.locator(".script-secret-new-synced").set_checked(synced)
	modal.locator(".script-secret-add button[type=submit]").click()
	modal.locator(f".script-secret[data-name={name}]").wait_for()


def test_synced_and_local_secrets(devices):
	a, b = devices
	add(a, "TOKEN", "abc", True)
	add(a, "LOCAL_ONLY", "here", False)
	sync(b)
	b.wait_for_function("readScriptSecrets().TOKEN")
	assert secrets(b) == {"TOKEN": {"value": "abc", "synced": True}}
	assert b.evaluate("scriptSecret('TOKEN')") == "abc"
	# a synced secret can't be made local again
	row = open_modal(b).locator(".script-secret[data-name=TOKEN]")
	assert row.locator(".script-secret-synced").is_checked() and row.locator(".script-secret-synced").is_disabled()
	# its value changes everywhere
	row.locator(".script-secret-value").fill("changed")
	row.locator(".script-secret-save").click()
	b.wait_for_function("readScriptSecrets().TOKEN.value === 'changed'")
	sync(a)
	a.wait_for_function("readScriptSecrets().TOKEN.value === 'changed'")
	assert secrets(a)["LOCAL_ONLY"] == {"value": "here", "synced": False}


def test_a_local_secret_made_synced(devices):
	a, b = devices
	add(a, "LATER", "v", False)
	sync(b)
	assert "LATER" not in secrets(b)
	a.once("dialog", lambda d: d.accept())
	open_modal(a).locator(".script-secret[data-name=LATER] .script-secret-synced").check()
	a.wait_for_function("readScriptSecrets().LATER.synced")
	assert open_modal(a).locator(".script-secret[data-name=LATER] .script-secret-synced").is_disabled()
	sync(b)
	b.wait_for_function("readScriptSecrets().LATER")
	assert secrets(b)["LATER"] == {"value": "v", "synced": True}


def test_a_deleted_synced_secret_goes_everywhere(devices):
	a, b = devices
	add(a, "GONE", "x", True)
	sync(b)
	b.wait_for_function("readScriptSecrets().GONE")
	a.once("dialog", lambda d: d.accept())
	open_modal(a).locator(".script-secret[data-name=GONE] .script-secret-delete").click()
	a.wait_for_function("!readScriptSecrets().GONE")
	sync(b)
	b.wait_for_function("!readScriptSecrets().GONE")
	# never with the notebook's settings in the cloud
	assert "__scriptSecrets__" not in a.evaluate("collectMeta()")
