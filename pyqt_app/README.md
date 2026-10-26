# Write.JS app (PyQt)
Write.JS as an app for macOS, Linux, Android and iOS. It shows the web app from `../static` unchanged, so it looks and works exactly like Write.JS in a browser, every feature included, and it follows the web app with no work: a change in `static/` is in the app the next time it starts (or is built).

## How it works
```
 Qt window ── web view ──► http://127.0.0.1:38211  (writejs_app/server.py, in the app)
                              ├─ /, /privacy, /terms   rendered from static/*.html (Jinja2, like routers/web.py)
                              ├─ /static/..., /sw.js   static/
                              └─ /api/...              ──► the Write.JS server from the app settings
```
- the page, its `localStorage` (the documents), its cookies (the login) and its service worker belong to one fixed local origin; the port is fixed because the documents belong to it (`main.py` already lists it in its CORS origins)
- `/api` goes to the Write.JS server set in the app, cookies are rewritten for the local origin (no `Domain`, no `Secure`), so login, cloud sync, Notebook Cron and the account work as in the browser
- with no server set, or when it can't be reached, `fetch` fails as it does without network: the app works offline and syncs when the server is back, as the web app does
- whether the page is logged in is read from the `access_token` cookie (its expiry, not its signature, which only the server can check, and does on every `/api` call)
- themes: the bundled Write.js theme, or a milessic-themes server set in the app settings

### Desktop (`writejs_app/desktop.py`, PyQt6 + QtWebEngine, i.e. Chromium)
The parts of a browser the web app relies on are done natively:
- **downloads** (Export, Export as Markdown, notebook backup): a save dialog
- **Open in New Window** and `target="_blank"`: a new app window; other sites, `mailto:`: the system's browser / mail app
- **closing** a window or quitting asks the page first, so unsaved edits get the same warning as in a browser
- clipboard (code block copy button, checklist copy/paste), full screen, Ctrl+P / `window.print()` saves a PDF
- window size and zoom are remembered; one app at a time, starting it again shows the open window
- macOS: menu bar with Preferences, New Window, Edit (Cmd+C/V/Z...) and View; Linux: no menu bar (the window is only Write.JS), shortcuts:

| | Linux | macOS |
|---|---|---|
| App settings (Write.JS server, themes server) | Ctrl+, | Cmd+, |
| New window | Ctrl+Shift+N | Cmd+Shift+N |
| Reload | Ctrl+Shift+R | Cmd+Shift+R |
| Zoom in / out / reset | Ctrl+= / Ctrl+- / Ctrl+0 | Cmd+= / Cmd+- / Cmd+0 |
| Full screen | F11 | Ctrl+Cmd+F |
| Developer tools | Ctrl+Shift+I | Cmd+Alt+I |

The first start asks for the Write.JS server (empty: offline only).

### Mobile (`writejs_app/mobile.py`, QML + QtWebView, i.e. WKWebView / Android WebView)
- full screen web view; the page uses Write.JS's own mobile layout (drawer, tap and hold menus, touch checklists)
- **downloads**: native web views can't download blob links, `writejs_app/mobile_shim.js` (added to the page only on mobile) sends the file to the app, which saves it in its documents: *Files > On My iPhone > Write.JS* on iOS, the app's `Documents` folder on Android
- **App settings** (the Write.JS server) is added at the end of the menu, and shown on the first start
- pyqtdeploy freezes the files into Qt resources; they are copied to the app's data on start, so the server can read them

## Run from source (desktop)
```
cd pyqt_app
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
python -m writejs_app                     # or: python main.py
WRITEJS_SERVER=http://localhost:8990 python -m writejs_app   # against a local Write.JS server (see ../README.md)
python -m writejs_app --mobile            # the mobile app, on the desktop (QtWebEngine instead of QtWebView)
```
Environment: `WRITEJS_SERVER`, `WRITEJS_THEMES` (override the app settings), `WRITEJS_STATIC` (another `static/`).
The app's data: `~/.local/share/milessic/Write.JS` (Linux), `~/Library/Application Support/milessic/Write.JS` (macOS): `settings.json` and the browser profile (`webengine/`, the documents are in its local storage).

## Build
### macOS and Linux
PyInstaller, on the system the app is for (it doesn't cross-compile):
```
pip install -r requirements.txt pyinstaller pillow
python build_desktop.py
```
- macOS: `dist/Write.JS.app` (to distribute it, sign and notarize it: `codesign --deep -s "Developer ID Application: ..." dist/Write.JS.app`, then `xcrun notarytool`)
- Linux: `dist/Write.JS/Write.JS`, and `dist/writejs.desktop` for the launcher (`cp dist/writejs.desktop ~/.local/share/applications/`)
- about 500 MB unpacked, most of it Chromium (QtWebEngine)

### Android and iOS
With [pyqtdeploy](https://www.riverbankcomputing.com/software/pyqtdeploy/) 3.3, which builds **Qt 5.12 - 5.15 and Python 3.7 - 3.11 only** (it rejects Qt 6), so the mobile app is PyQt5 / Qt 5.15 / Python 3.10; `mobile.py` and the server run on both PyQt5 and PyQt6. Android: Android SDK + NDK r21 and a JDK; iOS: macOS with Xcode.
1. `pip install pyqtdeploy==3.3.0`
2. put the source archives next to `mobile/sysroot.toml`: `Python-3.10.8.tgz`, `qt-everywhere-src-5.15.2.tar.xz`, `openssl-1.1.1w.tar.gz`, `zlib-*.tar.gz`, `PyQt5-5.15.10.tar.gz`, the `PyQt5_sip` sdist and the two wheels named in the file (`pip download --no-deps jinja2==3.1.4`, `pip download --no-deps --only-binary :all: --platform manylinux2014_x86_64 --python-version 3.10 markupsafe==2.1.5`)
3. build the sysroot: `pyqtdeploy-sysroot --target android-64 mobile/sysroot.toml` (or `--target ios-64`); Qt is built from source, with QtWebView and without QtWebEngine
4. create the project with the pyqtdeploy GUI, `pyqtdeploy mobile/writejs.pdt`:
   - *Application Source*: main script `main.py`, application package: `writejs_app` (with `qml/` and `mobile_shim.js`) and `../static` as `static` (so they are `:/writejs_app` and `:/static`); entry point `writejs_app.__main__:run`
   - *PyQt Modules*: QtCore, QtGui, QtNetwork, QtQml, QtQuick
   - *Standard Library*: `http.server`, `http.client`, `socketserver`, `ssl`, `json`, `hashlib`, `mimetypes`, `email.utils`, `urllib`, `dataclasses`, `threading`
   - *Other Packages*: Jinja2, MarkupSafe from the sysroot
   - *Other Extension Modules* / qmake: `QT += webview quick qml`
5. `pyqtdeploy-build --target android-64 mobile/writejs.pdt`, then `cd build-android-64 && qmake && make && make apk` (iOS: `qmake` makes an Xcode project)
6. let the web view load the app's own server:
   - Android: `mobile/android/res/xml/network_security_config.xml` into the package source (`ANDROID_PACKAGE_SOURCE_DIR`), and `android:networkSecurityConfig="@xml/network_security_config"` on the manifest's `<application>`
   - iOS: the keys of `mobile/ios/Info.plist.keys` into the Info.plist (`QMAKE_INFO_PLIST`)

Not built or tried on a phone yet (no SDK in the environment it was written in): the mobile code path was run on Linux with PyQt5 / Qt 5.15 and the files frozen into Qt resources as pyqtdeploy does. To check on a device: importing a file (`<input type="file">`), which depends on the platform web view's file picker.

## Tests
```
python3 -m pytest pyqt_app/tests -v      # the local server: pages, static files, the /api proxy and its cookies, offline, mobile downloads
```
