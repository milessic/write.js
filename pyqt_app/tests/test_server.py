"""The app's local server (no Qt needed): python3 -m pytest pyqt_app/tests -v"""

import base64
import http.client
import json
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from writejs_app.server import WriteJsServer, jwt_subject, rewrite_set_cookie  # noqa: E402
from writejs_app.settings import AppSettings  # noqa: E402


def make_jwt(sub: str, exp: float) -> str:
    def b64(data: dict) -> str:
        return base64.urlsafe_b64encode(json.dumps(data).encode()).decode().rstrip("=")
    return f"{b64({'alg': 'HS256'})}.{b64({'sub': sub, 'exp': exp})}.signature"


class Upstream(BaseHTTPRequestHandler):
    """The Write.JS server: records what it gets, answers like the auth routes."""
    received = []

    def log_message(self, *args):
        pass

    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("Content-Length") or 0))
        Upstream.received.append((self.command, self.path, dict(self.headers), body))
        self.send_response(303)
        self.send_header("Location", f"http://{self.headers['Host']}/?status=success")
        self.send_header("Set-Cookie", "access_token=abc; Domain=example.com; HttpOnly; Secure; Path=/; SameSite=None")
        self.send_header("Set-Cookie", "refresh_token=def; HttpOnly; Path=/")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        Upstream.received.append((self.command, self.path, dict(self.headers), b""))
        body = json.dumps({"notebooks": []}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


@pytest.fixture
def upstream():
    server = ThreadingHTTPServer(("127.0.0.1", 0), Upstream)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    Upstream.received = []
    yield f"http://127.0.0.1:{server.server_address[1]}"
    server.shutdown()


def start_app(server_url: str = "", **kwargs) -> WriteJsServer:
    settings = AppSettings(server_url=server_url, configured=True)
    app = WriteJsServer(settings, 0, **kwargs)
    app.start()
    return app


def request(app: WriteJsServer, method: str, path: str, body=None, headers=None):
    connection = http.client.HTTPConnection("127.0.0.1", app.server_address[1], timeout=5)
    connection.request(method, path, body=body, headers=headers or {})
    response = connection.getresponse()
    return response, response.read()


def test_index_logged_out():
    app = start_app()
    response, body = request(app, "GET", "/")
    html = body.decode()
    assert response.status == 200
    assert "script2.js" in html and "cloudsync.js" not in html
    assert 'data-theme="writejs"' in html
    assert "static/script.js?v=" in html
    app.shutdown()


def test_index_logged_in():
    app = start_app()
    token = make_jwt("milessic", time.time() + 600)
    _, body = request(app, "GET", "/", headers={"Cookie": f"access_token={token}"})
    html = body.decode()
    assert "cloudsync.js" in html and "script3.js" in html
    assert 'data-user="milessic"' in html
    app.shutdown()


def test_expired_token_is_logged_out():
    assert jwt_subject(make_jwt("milessic", time.time() - 1)) is None
    assert jwt_subject("not a token") is None


def test_static_files_and_traversal():
    app = start_app()
    response, body = request(app, "GET", "/static/script.js?v=1")
    assert response.status == 200 and b"function" in body
    assert "immutable" in response.getheader("Cache-Control")
    assert request(app, "GET", "/static/../main.py")[0].status == 404
    assert request(app, "GET", "/static/%2e%2e/main.py")[0].status == 404
    assert request(app, "GET", "/sw.js")[0].status == 200
    assert request(app, "GET", "/favicon.svg")[0].getheader("Content-Type") == "image/svg+xml"
    app.shutdown()


def test_legal_pages():
    app = start_app()
    for page in ("/privacy", "/terms"):
        response, body = request(app, "GET", page)
        assert response.status == 200 and b"Back to Write.JS" in body
    app.shutdown()


def test_proxy_forwards_and_rewrites_cookies(upstream):
    app = start_app(upstream)
    response, _ = request(app, "POST", "/api/auth/login/submit", body=b"username=a&password=b",
                          headers={"Content-Type": "application/x-www-form-urlencoded", "Cookie": "theme=dark"})
    method, path, headers, body = Upstream.received[0]
    assert (method, path, body) == ("POST", "/api/auth/login/submit", b"username=a&password=b")
    assert headers["Cookie"] == "theme=dark"
    assert response.status == 303
    assert response.getheader("Location") == "/?status=success"
    cookies = response.msg.get_all("Set-Cookie")
    assert cookies[0] == "access_token=abc; HttpOnly; Path=/; SameSite=Lax"
    assert cookies[1] == "refresh_token=def; HttpOnly; Path=/"

    response, body = request(app, "GET", "/api/notebooks")
    assert response.status == 200 and json.loads(body) == {"notebooks": []}
    app.shutdown()


def test_offline_fetch_fails_like_no_network():
    app = start_app("")
    with pytest.raises((http.client.RemoteDisconnected, ConnectionError)):
        request(app, "GET", "/api/notebooks")
    response, body = request(app, "POST", "/api/auth/login/submit", body=b"x=1", headers={"Sec-Fetch-Mode": "navigate"})
    assert response.status == 502 and b"You are offline" in body
    app.shutdown()


def test_mobile_shim_and_download(tmp_path):
    app = start_app(mobile=True, downloads_dir=tmp_path)
    _, body = request(app, "GET", "/")
    assert b"/__writejs_app__/mobile.js" in body
    assert request(app, "GET", "/__writejs_app__/mobile.js")[0].status == 200
    for _ in range(2):
        response, body = request(app, "POST", "/__writejs_app__/download?name=a%2Fb.md", body=b"# hi")
        assert response.status == 200
    assert sorted(p.name for p in tmp_path.iterdir()) == ["a_b (1).md", "a_b.md"]
    app.shutdown()


def test_mobile_settings_page(tmp_path):
    app = start_app(mobile=True)
    app.settings.path = tmp_path / "settings.json"
    assert request(app, "GET", "/__writejs_app__/settings")[0].status == 200
    response, _ = request(app, "POST", "/__writejs_app__/settings", body=b"server_url=writejs.example.com&themes_url=",
                          headers={"Content-Type": "application/x-www-form-urlencoded"})
    assert response.status == 303
    assert json.loads(app.settings.path.read_text())["server_url"] == "https://writejs.example.com"
    app.shutdown()


def test_rewrite_set_cookie():
    assert rewrite_set_cookie("a=1; Secure; domain=x.com; SameSite=None") == "a=1; SameSite=Lax"
