import os
import socket
import subprocess
import sys
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture(scope="session")
def server():
	# the app on a free port, like run_server.sh
	with socket.socket() as s:
		s.bind(("127.0.0.1", 0))
		port = s.getsockname()[1]
	process = subprocess.Popen([sys.executable, "-m", "uvicorn", "main:app", "--port", str(port)], cwd=ROOT,
		stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
	url = f"http://127.0.0.1:{port}/"
	for _ in range(100):
		try:
			socket.create_connection(("127.0.0.1", port), timeout=.1).close()
			break
		except OSError:
			time.sleep(.1)
	yield url
	process.terminate()
	process.wait()


@pytest.fixture(scope="session")
def browser():
	from playwright.sync_api import sync_playwright
	with sync_playwright() as p:
		# E2E_BROWSER=webkit runs them in Safari's engine
		browser = getattr(p, os.environ.get("E2E_BROWSER", "chromium")).launch()
		yield browser
		browser.close()


@pytest.fixture(scope="session")
def app_page(browser, server):
	# one page for all the tests: the app with storage consent, vi mode on and a saved document open
	# WebKit grants the clipboard without these permissions, and doesn't know them
	permissions = [] if browser.browser_type.name == "webkit" else ["clipboard-read", "clipboard-write"]
	context = browser.new_context(viewport={"width": 1400, "height": 900}, permissions=permissions)
	page = context.new_page()
	page.errors = []
	page.on("pageerror", lambda e: page.errors.append(str(e) + " @ " + (e.stack or "")))
	page.goto(server)
	page.evaluate("""() => {
		localStorage.clear();
		localStorage.setItem("__userConsent__", "1");
		localStorage.setItem("__viMode__", "1");
		localStorage.setItem("__doc__test", "<div>test</div>");
	}""")
	page.reload()
	page.wait_for_function("window.WriteVi")
	page.click("#editor")
	page.keyboard.press("Escape")
	page.keyboard.type(":e test")
	page.keyboard.press("Enter")
	yield page
	context.close()


@pytest.fixture
def page(app_page):
	app_page.errors.clear()
	yield app_page
	assert app_page.errors == []
