"""
Settings > Editor > Open hyperlinks (script.js): "In Write.JS" (the default) leaves links as they always were; "In system
browser" makes the https:// links of the documents and the notifications open in the main browser when Write.JS runs as
an installed app (Add to Dock, Install): a new top-level window without an opener, which the app hands to the browser.
In a browser tab, and for other links, Ctrl/middle clicks and links edited as text, nothing changes.
"""
import pytest

pytest.importorskip("playwright")

DOC = ('<div><a contenteditable="false" href="https://example.com/page" target="about:blank">site</a></div>'
	'<div><a contenteditable="false" href="http://example.com/plain" target="about:blank">plain</a></div>')


@pytest.fixture
def app(browser, server):
	context = browser.new_context(viewport={"width": 1400, "height": 900})
	# no network for the pages the links open
	context.route("https://example.com/**", lambda route: route.fulfill(status=200, content_type="text/html", body="<p>example</p>"))
	context.route("http://example.com/**", lambda route: route.fulfill(status=200, content_type="text/html", body="<p>plain</p>"))
	page = context.new_page()
	page.errors = []
	page.on("pageerror", lambda e: page.errors.append(str(e)))
	page.goto(server)
	page.evaluate("""(doc) => {
		localStorage.clear();
		localStorage.setItem("__userConsent__", "1");
		localStorage.setItem("__doc__plan", doc);
		localStorage.setItem("__lastOpened__", "plan");
	}""", DOC)
	page.reload()
	page.wait_for_function("getActiveTab()?.name === 'plan'")
	page.evaluate("() => { window.__opened = []; window.open = (url, target, features) => { window.__opened.push([url, target, features]); return null } }")
	yield page
	assert page.errors == []
	context.close()


def opened(page):
	return page.evaluate("window.__opened")


def installed(page):
	# as Safari's Add to Dock / an installed Chrome app reports it
	page.evaluate("() => Object.defineProperty(navigator, 'standalone', {value: true, configurable: true})")


def test_setting_in_settings(app):
	app.evaluate("createSettingsModal()")
	assert app.locator('input[name="setting-open-links"][value="app"]').is_checked()
	app.locator('input[name="setting-open-links"][value="browser"]').check()
	assert app.evaluate("localStorage.getItem('__openLinks__')") == "browser"
	app.evaluate("closeAllModals()")


def test_in_write_js_links_are_as_they_were(app):
	installed(app)
	with app.context.expect_page() as popup:
		app.locator("#editor a", has_text="site").click()
	popup.value.close()
	assert opened(app) == []
	assert app.locator(".link-viewer").count() == 0


def test_system_browser_in_the_installed_app(app):
	installed(app)
	app.evaluate("localStorage.setItem('__openLinks__', 'browser')")
	app.locator("#editor a", has_text="site").click()
	assert opened(app) == [["https://example.com/page", "_blank", "noopener,noreferrer"]]


def test_system_browser_changes_nothing_in_a_browser_tab(app):
	app.evaluate("localStorage.setItem('__openLinks__', 'browser')")
	with app.context.expect_page() as popup:
		app.locator("#editor a", has_text="site").click()
	popup.value.close()
	assert opened(app) == []


def test_only_https_links(app):
	installed(app)
	app.evaluate("localStorage.setItem('__openLinks__', 'browser')")
	with app.context.expect_page() as popup:
		app.locator("#editor a", has_text="plain").click()
	popup.value.close()
	assert opened(app) == []


def test_notification_links_too(app):
	installed(app)
	app.evaluate("localStorage.setItem('__openLinks__', 'browser')")
	app.evaluate("scriptApi(document.getElementById('editor')).createNotification('[docs](https://example.com/docs)', 'info', 0)")
	app.locator("#notifications-container a", has_text="docs").click()
	assert opened(app) == [["https://example.com/docs", "_blank", "noopener,noreferrer"]]
