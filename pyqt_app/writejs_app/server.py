"""The local server the app's web view loads Write.JS from (no Qt here, so it runs on every platform and in tests).

- "/", "/privacy", "/terms", "/favicon.svg", "/sw.js" and "/static/..." are rendered from static/ like routers/web.py does
- everything else ("/api/...") is passed to the Write.JS server from the settings, with its cookies rewritten
  for this origin, so the page talks to the cloud exactly as it does in a browser
- "/__writejs_app__/..." is the app's own: the running instance check and, on mobile, saving downloads
"""

import base64
import hashlib
import json
import mimetypes
import re
import socket
import threading
import time
import urllib.parse
import urllib.request
from email.utils import formatdate
from http import HTTPStatus
from http.client import HTTPConnection, HTTPSConnection, HTTPException
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Callable

from jinja2 import Environment, FileSystemLoader, select_autoescape

from . import paths
from .settings import AppSettings

APP_PATH = "/__writejs_app__"
DEFAULT_THEME = "writejs"
THEME_COOKIE = "theme"
# hop-by-hop headers and the ones the proxy sets itself
_SKIP_REQUEST_HEADERS = {"host", "connection", "keep-alive", "proxy-connection", "te", "trailer", "transfer-encoding",
                         "upgrade", "accept-encoding", "origin", "referer", "content-length"}
_SKIP_RESPONSE_HEADERS = {"connection", "keep-alive", "proxy-connection", "te", "trailer", "transfer-encoding",
                          "upgrade", "content-length", "set-cookie", "server", "date"}


def _repo_constant(relative: str, name: str, default: str) -> str:
    """A constant of the web server (e.g. the themes version), read from its source when the repo is around,
    so the app doesn't drift from it; the default is used in a bundled app."""
    try:
        source = (paths.REPO_DIR / relative).read_text("utf-8")
    except OSError:
        return default
    match = re.search(rf'^{name}\s*=\s*"([^"]*)"', source, re.M)
    return match.group(1) if match else default


THEMES_VERSION = _repo_constant("utils/themes.py", "THEMES_VERSION", "1.12.0")
LEGAL_UPDATED = _repo_constant("routers/web.py", "LEGAL_UPDATED", "2026-10-12")


class Themes:
    """utils/themes.py for the themes server from the app settings: the registry is the allow-list of themes,
    cached for ten minutes, retried a minute after a failure."""

    def __init__(self, settings: AppSettings):
        self.settings = settings
        self._registry = None
        self._url = None
        self._fetched_at = 0.0
        self._failed_at = 0.0
        self._lock = threading.Lock()

    def registry(self) -> dict | None:
        url = self.settings.themes_url
        if not url:
            return None
        with self._lock:
            if url != self._url:
                self._url, self._registry, self._fetched_at, self._failed_at = url, None, 0.0, 0.0
            now = time.monotonic()
            if self._registry is not None and now - self._fetched_at < 600:
                return self._registry
            if self._failed_at and now - self._failed_at < 60:
                return self._registry
            try:
                request = urllib.request.Request(f"{url}/api/themes", headers={"User-Agent": "write.js"})
                with urllib.request.urlopen(request, timeout=3) as response:
                    self._registry = json.load(response)
                self._fetched_at, self._failed_at = now, 0.0
            except (OSError, ValueError):
                self._failed_at = now
            return self._registry

    def context(self, requested: str | None) -> dict:
        registry = self.registry()
        keys = {t["key"] for t in registry["themes"]} if registry else {DEFAULT_THEME}
        theme = requested if requested in keys else DEFAULT_THEME
        url = self.settings.themes_url
        backup = f"static/themes/{DEFAULT_THEME}.css?v={THEMES_VERSION}"
        return {
            "theme": theme,
            "themes_available": registry is not None,
            "themes_url": url,
            "themes_version": THEMES_VERSION,
            "theme_stylesheet": f"{url}/css/bundle/{theme}.css?v={THEMES_VERSION}" if registry else backup,
            "theme_backup_stylesheet": backup,
            "default_theme": DEFAULT_THEME,
        }


def jwt_subject(token: str | None) -> str | None:
    """The user of an access token that has not expired. Its signature can only be checked by the Write.JS server,
    which does so on every /api call; here it only decides which scripts the page loads, as in routers/web.py."""
    if not token:
        return None
    try:
        payload_b64 = token.split(".")[1]
        payload = json.loads(base64.urlsafe_b64decode(payload_b64 + "=" * (-len(payload_b64) % 4)))
    except (IndexError, ValueError):
        return None
    if payload.get("exp") is not None and payload["exp"] < time.time():
        return None
    return payload.get("sub") or ""


def rewrite_set_cookie(header: str) -> str:
    """A cookie of the Write.JS server for the local origin: no Domain, no Secure (http://127.0.0.1)."""
    parts = [p.strip() for p in header.split(";")]
    kept = [parts[0]]
    for part in parts[1:]:
        name = part.split("=", 1)[0].strip().lower()
        if name in ("domain", "secure"):
            continue
        if name == "samesite" and part.split("=", 1)[-1].strip().lower() == "none":
            part = "SameSite=Lax"
        kept.append(part)
    return "; ".join(kept)


class WriteJsServer(ThreadingHTTPServer):
    daemon_threads = True
    # True (HTTPServer's default): a relaunch right after quitting binds despite the old connections in TIME_WAIT;
    # on macOS / Linux a second app still can't listen on the port while one does

    def __init__(self, settings: AppSettings, port: int, static: Path | None = None, mobile: bool = False,
                 downloads_dir: Path | None = None, on_activate: Callable[[], None] | None = None):
        self.settings = settings
        self.static = static or paths.static_dir()
        self.mobile = mobile
        self.downloads_dir = downloads_dir
        self.on_activate = on_activate
        self.themes = Themes(settings)
        self.jinja = Environment(loader=FileSystemLoader(str(self.static)), autoescape=select_autoescape(["html"]))
        self.jinja.globals["static_url"] = self.static_url
        self._hashes: dict[str, tuple[float, str]] = {}
        super().__init__(("127.0.0.1", port), Handler)

    @property
    def origin(self) -> str:
        return f"http://127.0.0.1:{self.server_address[1]}"

    def static_url(self, path: str) -> str:
        """utils/static_files.py: a static file's URL versioned by its content."""
        file = self.static / path
        mtime = file.stat().st_mtime
        cached = self._hashes.get(path)
        if cached is None or cached[0] != mtime:
            cached = (mtime, hashlib.md5(file.read_bytes()).hexdigest()[:10])
            self._hashes[path] = cached
        return f"static/{path}?v={cached[1]}"

    def start(self) -> threading.Thread:
        thread = threading.Thread(target=self.serve_forever, name="writejs-server", daemon=True)
        thread.start()
        return thread


class Handler(BaseHTTPRequestHandler):
    server: WriteJsServer
    protocol_version = "HTTP/1.1"
    server_version = "WriteJsApp"

    def log_message(self, format, *args):
        pass

    # routing
    def do_GET(self):
        self._route()

    def do_HEAD(self):
        self._route()

    def do_POST(self):
        self._route()

    def do_PUT(self):
        self._route()

    def do_PATCH(self):
        self._route()

    def do_DELETE(self):
        self._route()

    def do_OPTIONS(self):
        self._route()

    def _route(self):
        url = urllib.parse.urlsplit(self.path)
        path = url.path
        try:
            if path.startswith(APP_PATH):
                return self._app(path[len(APP_PATH):], url.query)
            if self.command in ("GET", "HEAD"):
                if path == "/":
                    return self._index()
                if path in ("/privacy", "/terms"):
                    return self._legal(path[1:])
                if path == "/favicon.svg":
                    return self._file(self.server.static / "favicon.svg", url.query)
                if path == "/sw.js":
                    return self._file(self.server.static / "sw.js", url.query, cache="no-cache")
                if path.startswith("/static/"):
                    return self._static(path[len("/static/"):], url.query)
            self._proxy()
        except (BrokenPipeError, ConnectionResetError):
            self.close_connection = True

    # responses
    def _send(self, status: int, body: bytes, content_type: str, headers: list[tuple[str, str]] = ()):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        for name, value in headers:
            self.send_header(name, value)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _cookies(self) -> SimpleCookie:
        cookies = SimpleCookie()
        try:
            cookies.load(self.headers.get("Cookie", ""))
        except Exception:
            pass
        return cookies

    def _cookie(self, name: str) -> str | None:
        morsel = self._cookies().get(name)
        return urllib.parse.unquote(morsel.value) if morsel else None

    def _render(self, template: str, context: dict) -> bytes:
        html = self.server.jinja.get_template(template).render(
            request=None, **self.server.themes.context(self._cookie(THEME_COOKIE)), **context
        )
        if self.server.mobile and template == "index.html":
            html = html.replace("</body>", f'<script src="{APP_PATH}/mobile.js"></script>\n</body>', 1)
        return html.encode("utf-8")

    def _index(self):
        username = jwt_subject(self._cookie("access_token"))
        body = self._render("index.html", {"is_authenticated": username is not None, "username": username or ""})
        self._send(200, body, "text/html; charset=utf-8", [("Cache-Control", "no-cache")])

    def _legal(self, page: str):
        body = self._render(f"legal/{page}.html", {"updated": LEGAL_UPDATED})
        self._send(200, body, "text/html; charset=utf-8", [("Cache-Control", "no-cache")])

    def _static(self, relative: str, query: str):
        root = self.server.static.resolve()
        file = (root / urllib.parse.unquote(relative)).resolve()
        if root not in file.parents:
            return self._send(404, b"Not Found", "text/plain")
        cache = "public, max-age=31536000, immutable" if "v" in urllib.parse.parse_qs(query) else "no-cache"
        self._file(file, query, cache)

    def _file(self, file: Path, query: str, cache: str | None = None):
        if not file.is_file():
            return self._send(404, b"Not Found", "text/plain")
        if cache is None:
            cache = "public, max-age=31536000, immutable" if "v" in urllib.parse.parse_qs(query) else "no-cache"
        stat = file.stat()
        etag = f'"{int(stat.st_mtime)}-{stat.st_size}"'
        headers = [("Cache-Control", cache), ("ETag", etag), ("Last-Modified", formatdate(stat.st_mtime, usegmt=True))]
        if self.headers.get("If-None-Match") == etag:
            self.send_response(304)
            for name, value in headers:
                self.send_header(name, value)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        content_type = mimetypes.guess_type(file.name)[0] or "application/octet-stream"
        if file.suffix == ".webmanifest":
            content_type = "application/manifest+json"
        if content_type.startswith("text/") or content_type in ("application/javascript", "application/json"):
            content_type += "; charset=utf-8"
        self._send(200, file.read_bytes(), content_type, headers)

    # the app's own endpoints
    def _app(self, path: str, query: str):
        if path == "" and self.command == "GET":
            return self._send(200, json.dumps({"app": "writejs"}).encode(), "application/json")
        if path == "/activate" and self.command == "POST":
            # a second launch: the running app shows itself instead
            if self.server.on_activate:
                self.server.on_activate()
            return self._send(204, b"", "text/plain")
        if path == "/mobile.js" and self.command == "GET":
            return self._file(paths.PACKAGE_DIR / "mobile_shim.js", "", "no-cache")
        if path == "/download" and self.command == "POST" and self.server.downloads_dir is not None:
            return self._save_download(query)
        if path == "/settings" and self.server.mobile:
            return self._settings_page()
        self._send(404, b"Not Found", "text/plain")

    def _settings_page(self):
        """The app's settings on mobile (desktop has a dialog): the Write.JS server and the themes server."""
        settings = self.server.settings
        if self.command == "POST":
            length = int(self.headers.get("Content-Length") or 0)
            form = urllib.parse.parse_qs(self.rfile.read(length).decode("utf-8"), keep_blank_values=True)
            settings.update(server_url=form.get("server_url", [""])[0], themes_url=form.get("themes_url", [""])[0],
                            configured=True)
            return self._send(303, b"", "text/plain", [("Location", "/")])
        body = (
            "<!DOCTYPE html><html data-theme='writejs'><head><meta charset='UTF-8'>"
            "<meta name='viewport' content='width=device-width, initial-scale=1.0'>"
            f"<link rel='stylesheet' href='/{self.server.static_url('themes/writejs.css')}'>"
            f"<link rel='stylesheet' href='/{self.server.static_url('styles.css')}'><title>App settings - Write.JS</title></head>"
            "<body class='app'><header class='topbar'><a class='btn' href='/'>← Back to Write.JS</a></header>"
            "<div class='container'><section class='card'><h1>App settings</h1>"
            "<p class='muted'>Documents are kept on this device. To log in and sync them, set the Write.JS server; "
            "leave it empty to use the app offline only.</p>"
            f"<form class='stack' method='POST' action='{APP_PATH}/settings'>"
            "<label>Write.JS server<input type='url' name='server_url' placeholder='https://writejs.example.com' "
            f"value='{_escape(settings.server_url)}' autocapitalize='off'></label>"
            "<label>Themes server (optional)<input type='url' name='themes_url' "
            f"value='{_escape(settings.themes_url)}' autocapitalize='off'></label>"
            "<button class='btn primary' type='submit'>Save</button></form></section></div></body></html>"
        ).encode("utf-8")
        self._send(200, body, "text/html; charset=utf-8", [("Cache-Control", "no-cache")])

    def _save_download(self, query: str):
        """Mobile web views can't download a blob link, mobile_shim.js posts it here and it is saved
        to the app's documents (shown in Files on iOS, Documents on Android)."""
        name = urllib.parse.parse_qs(query).get("name", ["download"])[0]
        name = re.sub(r'[\\/:*?"<>|\x00-\x1f]', "_", name).strip(". ") or "download"
        length = int(self.headers.get("Content-Length") or 0)
        data = self.rfile.read(length)
        folder = self.server.downloads_dir
        folder.mkdir(parents=True, exist_ok=True)
        target = folder / name
        stem, suffix, n = target.stem, target.suffix, 1
        while target.exists():
            target = folder / f"{stem} ({n}){suffix}"
            n += 1
        target.write_bytes(data)
        self._send(200, json.dumps({"path": str(target)}).encode(), "application/json")

    # the Write.JS server
    def _proxy(self):
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else None
        base = urllib.parse.urlsplit(self.server.settings.server_url) if self.server.settings.server_url else None
        if base is None or not base.netloc:
            return self._unreachable("No Write.JS server is set, the app works offline")

        headers = {k: v for k, v in self.headers.items() if k.lower() not in _SKIP_REQUEST_HEADERS}
        headers["Host"] = base.netloc
        headers["X-Forwarded-For"] = "127.0.0.1"
        if body is not None:
            headers["Content-Length"] = str(len(body))
        connection_class = HTTPSConnection if base.scheme == "https" else HTTPConnection
        connection = connection_class(base.netloc, timeout=30)
        try:
            connection.request(self.command, base.path.rstrip("/") + self.path, body=body, headers=headers)
            response = connection.getresponse()
            data = response.read()
        except (OSError, HTTPException) as e:
            return self._unreachable(f"The Write.JS server {base.geturl()} can't be reached ({e})")
        finally:
            connection.close()

        self.send_response(response.status, response.reason)
        origin = f"{base.scheme}://{base.netloc}"
        for name, value in response.getheaders():
            lower = name.lower()
            if lower in _SKIP_RESPONSE_HEADERS:
                continue
            if lower == "location" and value.startswith(origin):
                value = value[len(origin):] or "/"
            if lower == "access-control-allow-origin":
                continue
            self.send_header(name, value)
        for cookie in response.msg.get_all("Set-Cookie") or []:
            self.send_header("Set-Cookie", rewrite_set_cookie(cookie))
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)

    def _unreachable(self, reason: str):
        if self.headers.get("Sec-Fetch-Mode") == "navigate":
            # a form (login, logout) sent while offline: a page with the way back instead of the browser's error
            body = (
                "<!DOCTYPE html><html data-theme='writejs'><head><meta charset='UTF-8'>"
                "<meta name='viewport' content='width=device-width, initial-scale=1.0'>"
                "<link rel='stylesheet' href='/static/themes/writejs.css'><title>Offline - Write.JS</title></head>"
                "<body class='app'><div class='container'><section class='card'><h1>You are offline</h1>"
                f"<p>{_escape(reason)}.</p><p><a class='btn primary' href='/'>Back to Write.JS</a></p>"
                "</section></div></body></html>"
            ).encode("utf-8")
            return self._send(502, body, "text/html; charset=utf-8")
        # fetch() fails as it does without network, so the page behaves as in an offline browser
        self.close_connection = True
        try:
            self.connection.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass


def _escape(text: str) -> str:
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("'", "&#39;").replace('"', "&quot;")


def is_running(port: int) -> bool:
    """Whether the Write.JS app already serves this port (another instance), not some other program."""
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}{APP_PATH}", timeout=2) as response:
            return json.load(response).get("app") == "writejs"
    except (OSError, ValueError):
        return False


def activate_running(port: int) -> bool:
    try:
        request = urllib.request.Request(f"http://127.0.0.1:{port}{APP_PATH}/activate", data=b"", method="POST")
        with urllib.request.urlopen(request, timeout=2):
            return True
    except OSError:
        return False
