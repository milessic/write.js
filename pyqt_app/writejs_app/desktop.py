"""Write.JS on macOS and Linux (and Windows): the web app in a QWebEngineView, with the browser's parts
it relies on done natively: downloads, new windows, closing with unsaved edits, links to other sites."""

import sys
from pathlib import Path

from PyQt6.QtCore import QEvent, QObject, QSettings, QStandardPaths, Qt, QTimer, QUrl, pyqtSignal
from PyQt6.QtGui import QAction, QDesktopServices, QIcon, QKeySequence
from PyQt6.QtWebEngineCore import (QWebEngineDownloadRequest, QWebEnginePage, QWebEnginePermission,
                                   QWebEngineProfile, QWebEngineSettings)
from PyQt6.QtWebEngineWidgets import QWebEngineView
from PyQt6.QtWidgets import (QApplication, QDialog, QDialogButtonBox, QFileDialog, QFormLayout, QLabel, QLineEdit,
                             QMainWindow, QMessageBox, QVBoxLayout)

from . import APP_NAME, ORGANIZATION, PORT, paths
from .server import WriteJsServer, activate_running, is_running
from .settings import AppSettings, normalize_url

IS_MAC = sys.platform == "darwin"


class App(QObject):
    # from the server's thread: another launch asked for a window
    activate_requested = pyqtSignal()

    def __init__(self, qt_app: QApplication, settings: AppSettings, server: WriteJsServer, data_dir: Path):
        super().__init__()
        self.qt_app = qt_app
        self.settings = settings
        self.server = server
        self.windows: list[MainWindow] = []
        self.devtools: list[QWebEngineView] = []
        self.activate_requested.connect(self.activate)
        qt_app.installEventFilter(self)

        # a named profile keeps localStorage (the documents), cookies (the login) and the service worker on disk
        self.profile = QWebEngineProfile("writejs", qt_app)
        self.profile.setPersistentStoragePath(str(data_dir / "webengine"))
        self.profile.setCachePath(str(data_dir / "cache"))
        self.profile.setPersistentCookiesPolicy(QWebEngineProfile.PersistentCookiesPolicy.AllowPersistentCookies)
        self.profile.setHttpUserAgent(self.profile.httpUserAgent() + " WriteJsApp/1")
        self.profile.downloadRequested.connect(self.download)
        web = self.profile.settings()
        for attribute in (QWebEngineSettings.WebAttribute.LocalStorageEnabled,
                          QWebEngineSettings.WebAttribute.JavascriptCanOpenWindows,
                          QWebEngineSettings.WebAttribute.JavascriptCanAccessClipboard,
                          QWebEngineSettings.WebAttribute.JavascriptCanPaste,
                          QWebEngineSettings.WebAttribute.FullScreenSupportEnabled):
            web.setAttribute(attribute, True)

    def eventFilter(self, watched, event) -> bool:
        """Quitting (Cmd+Q, the Dock, logging out): Qt stops at the first window that doesn't close at once, here every
        window asks its page (unsaved edits) and the app ends when the last one has closed."""
        if watched is self.qt_app and event.type() == QEvent.Type.Quit and self.windows:
            for view in list(self.devtools):
                view.close()
            for window in list(self.windows):
                window.close()
            return True
        return super().eventFilter(watched, event)

    @property
    def origin(self) -> QUrl:
        return QUrl(self.server.origin + "/")

    def is_local(self, url: QUrl) -> bool:
        return url.scheme() in ("http", "https") and url.host() == "127.0.0.1" and url.port() == self.server.server_address[1]

    def new_window(self, url: QUrl | None = None) -> "MainWindow":
        window = MainWindow(self, url or self.origin)
        self.windows.append(window)
        window.show()
        return window

    def activate(self):
        window = next((w for w in self.windows if w.isVisible()), None) or self.new_window()
        window.setWindowState(window.windowState() & ~Qt.WindowState.WindowMinimized)
        window.raise_()
        window.activateWindow()

    def download(self, download: QWebEngineDownloadRequest):
        """Export, Export as Markdown and the notebook backup: saved where the user picks."""
        folder = download.downloadDirectory() or QStandardPaths.writableLocation(QStandardPaths.StandardLocation.DownloadLocation)
        parent = QApplication.activeWindow()
        path, _ = QFileDialog.getSaveFileName(parent, "Save", str(Path(folder) / download.downloadFileName()))
        if not path:
            download.cancel()
            return
        download.setDownloadDirectory(str(Path(path).parent))
        download.setDownloadFileName(Path(path).name)
        download.accept()

    def show_devtools(self, page: QWebEnginePage):
        view = QWebEngineView()
        view.setWindowTitle(f"Developer Tools - {APP_NAME}")
        view.setPage(QWebEnginePage(self.profile, view))
        page.setDevToolsPage(view.page())
        view.resize(1000, 700)
        view.show()
        self.devtools.append(view)
        view.destroyed.connect(lambda: self.devtools.remove(view) if view in self.devtools else None)
        view.setAttribute(Qt.WidgetAttribute.WA_DeleteOnClose)

    def edit_settings(self, parent=None, first_run=False) -> bool:
        dialog = SettingsDialog(self.settings, parent, first_run)
        if dialog.exec() != QDialog.DialogCode.Accepted:
            if first_run:
                self.settings.update(configured=True)
            return False
        changed = (dialog.server_url != self.settings.server_url, dialog.themes_url != self.settings.themes_url)
        self.settings.update(server_url=dialog.server_url, themes_url=dialog.themes_url, configured=True)
        if any(changed):
            # the page decides on load whether it is logged in and which theme it has
            for window in self.windows:
                window.view.reload()
        return True


class SettingsDialog(QDialog):
    def __init__(self, settings: AppSettings, parent=None, first_run=False):
        super().__init__(parent)
        self.setWindowTitle(f"{APP_NAME} Settings")
        layout = QVBoxLayout(self)
        intro = QLabel(
            "Documents are kept on this device. To log in and sync them with the cloud, set the Write.JS server "
            "(e.g. https://writejs.example.com); leave it empty to use the app offline only."
            if first_run else
            "The Write.JS server used for the account and cloud sync, and the milessic-themes server for themes. "
            "Empty: offline only / the bundled Write.js theme."
        )
        intro.setWordWrap(True)
        layout.addWidget(intro)
        form = QFormLayout()
        self.server = QLineEdit(settings.server_url)
        self.server.setPlaceholderText("https://writejs.example.com")
        self.themes = QLineEdit(settings.themes_url)
        self.themes.setPlaceholderText("optional, e.g. http://mbs.local:9312")
        form.addRow("Write.JS server", self.server)
        form.addRow("Themes server", self.themes)
        layout.addLayout(form)
        buttons = QDialogButtonBox(QDialogButtonBox.StandardButton.Save | QDialogButtonBox.StandardButton.Cancel)
        buttons.accepted.connect(self.accept)
        buttons.rejected.connect(self.reject)
        layout.addWidget(buttons)
        self.resize(520, self.sizeHint().height())

    @property
    def server_url(self) -> str:
        return normalize_url(self.server.text())

    @property
    def themes_url(self) -> str:
        return normalize_url(self.themes.text())


class Page(QWebEnginePage):
    def __init__(self, app: App, parent=None):
        super().__init__(app.profile, parent)
        self.app = app
        self.permissionRequested.connect(self.on_permission)

    def acceptNavigationRequest(self, url: QUrl, type, is_main_frame: bool) -> bool:
        if self.app.is_local(url) or url.scheme() in ("about", "data", "blob", "devtools", "chrome", "qrc"):
            return True
        # other sites (mailto:, the themes attribution, the password reset mail's server...) in the system's apps
        if type == QWebEnginePage.NavigationType.NavigationTypeLinkClicked or is_main_frame:
            QDesktopServices.openUrl(url)
            return False
        return True

    def createWindow(self, type) -> QWebEnginePage:
        # target="_blank" and window.open: where it goes is known with its first navigation
        return PopupProbe(self.app, self)

    def on_permission(self, permission: QWebEnginePermission):
        allowed = {QWebEnginePermission.PermissionType.ClipboardReadWrite,
                   QWebEnginePermission.PermissionType.Notifications}
        if permission.permissionType() in allowed and self.app.is_local(permission.origin()):
            permission.grant()
        else:
            permission.deny()


class PopupProbe(QWebEnginePage):
    """The page of a window the web app opens: the Write.JS document window (Open in New Window) or the legal
    pages become a window of the app, anything else opens in the system browser."""

    def __init__(self, app: App, parent):
        super().__init__(app.profile, parent)
        self.app = app

    def acceptNavigationRequest(self, url: QUrl, type, is_main_frame: bool) -> bool:
        if self.app.is_local(url):
            self.app.new_window(url)
        elif url.scheme() not in ("about",):
            QDesktopServices.openUrl(url)
        else:
            return True
        QTimer.singleShot(0, self.deleteLater)
        return False


class MainWindow(QMainWindow):
    def __init__(self, app: App, url: QUrl):
        super().__init__()
        self.app = app
        self.closing = False
        self.setAttribute(Qt.WidgetAttribute.WA_DeleteOnClose)
        self.setWindowTitle(APP_NAME)
        self.view = QWebEngineView(self)
        self.page = Page(app, self.view)
        self.view.setPage(self.page)
        self.setCentralWidget(self.view)
        self.view.titleChanged.connect(lambda title: self.setWindowTitle(title or APP_NAME))
        self.page.windowCloseRequested.connect(self.close_now)
        self.page.fullScreenRequested.connect(self.full_screen)
        self.page.printRequested.connect(self.print_pdf)
        self.page.renderProcessTerminated.connect(self.render_process_terminated)
        self.setup_actions()
        self.restore()
        self.view.load(url)

    def setup_actions(self):
        """macOS: the menu bar (outside the window). Linux / Windows: only shortcuts, so the window looks like
        Write.JS and nothing more; Ctrl+, opens the app's settings."""
        actions = {
            "settings": (("Preferences…" if IS_MAC else "App Settings…"), QKeySequence("Ctrl+,"), lambda: self.app.edit_settings(self)),
            "new_window": ("New Window", QKeySequence("Ctrl+Shift+N"), lambda: self.app.new_window()),
            "reload": ("Reload", QKeySequence("Ctrl+Shift+R"), self.view.reload),
            "zoom_in": ("Zoom In", QKeySequence("Ctrl+="), lambda: self.zoom(0.1)),
            "zoom_out": ("Zoom Out", QKeySequence("Ctrl+-"), lambda: self.zoom(-0.1)),
            "zoom_reset": ("Actual Size", QKeySequence("Ctrl+0"), lambda: self.zoom(None)),
            "full_screen": ("Toggle Full Screen", QKeySequence("Ctrl+Meta+F" if IS_MAC else "F11"), self.toggle_full_screen),
            "devtools": ("Developer Tools", QKeySequence("Ctrl+Alt+I" if IS_MAC else "Ctrl+Shift+I"), lambda: self.app.show_devtools(self.page)),
        }
        created = {}
        for key, (label, shortcut, slot) in actions.items():
            action = QAction(label, self)
            action.setShortcut(shortcut)
            action.setShortcutContext(Qt.ShortcutContext.WindowShortcut)
            action.triggered.connect(slot)
            self.addAction(action)
            created[key] = action
        if not IS_MAC:
            self.menuBar().hide()
            return
        created["settings"].setMenuRole(QAction.MenuRole.PreferencesRole)
        app_menu = self.menuBar().addMenu(APP_NAME)
        app_menu.addAction(created["settings"])
        file_menu = self.menuBar().addMenu("File")
        file_menu.addAction(created["new_window"])
        close = QAction("Close Window", self)
        close.setShortcut(QKeySequence.StandardKey.Close)
        close.triggered.connect(self.close)
        file_menu.addAction(close)
        # Cmd+C / Cmd+V / Cmd+Z reach the page through the Edit menu on macOS
        edit_menu = self.menuBar().addMenu("Edit")
        for label, web_action, shortcut in (
            ("Undo", QWebEnginePage.WebAction.Undo, QKeySequence.StandardKey.Undo),
            ("Redo", QWebEnginePage.WebAction.Redo, QKeySequence.StandardKey.Redo),
            (None, None, None),
            ("Cut", QWebEnginePage.WebAction.Cut, QKeySequence.StandardKey.Cut),
            ("Copy", QWebEnginePage.WebAction.Copy, QKeySequence.StandardKey.Copy),
            ("Paste", QWebEnginePage.WebAction.Paste, QKeySequence.StandardKey.Paste),
            ("Select All", QWebEnginePage.WebAction.SelectAll, QKeySequence.StandardKey.SelectAll),
        ):
            if label is None:
                edit_menu.addSeparator()
                continue
            action = QAction(label, self)
            action.setShortcut(shortcut)
            action.triggered.connect(lambda _=False, a=web_action: self.page.triggerAction(a))
            edit_menu.addAction(action)
        view_menu = self.menuBar().addMenu("View")
        for key in ("reload", None, "zoom_in", "zoom_out", "zoom_reset", None, "full_screen", "devtools"):
            view_menu.addSeparator() if key is None else view_menu.addAction(created[key])

    # window state
    def restore(self):
        geometry = QSettings().value("window/geometry")
        if geometry is None or not self.restoreGeometry(geometry):
            self.resize(1280, 820)
        if len(self.app.windows) > 0:
            # windows after the first one a little lower right, not on top of it
            self.move(self.pos().x() + 32 * len(self.app.windows), self.pos().y() + 32 * len(self.app.windows))
        zoom = QSettings().value("window/zoom", 1.0, type=float)
        self.view.setZoomFactor(zoom)

    def zoom(self, step: float | None):
        factor = 1.0 if step is None else min(3.0, max(0.3, round(self.view.zoomFactor() + step, 2)))
        for window in self.app.windows:
            window.view.setZoomFactor(factor)
        QSettings().setValue("window/zoom", factor)

    def toggle_full_screen(self):
        self.showNormal() if self.isFullScreen() else self.showFullScreen()

    def full_screen(self, request):
        request.accept()
        self.showFullScreen() if request.toggleOn() else self.showNormal()

    def print_pdf(self):
        """Ctrl+P / window.print(): the document as a PDF."""
        name = (self.view.title() or APP_NAME).replace("/", "_") + ".pdf"
        folder = QStandardPaths.writableLocation(QStandardPaths.StandardLocation.DocumentsLocation)
        path, _ = QFileDialog.getSaveFileName(self, "Save as PDF", str(Path(folder) / name), "PDF (*.pdf)")
        if path:
            self.page.printToPdf(path)

    # closing: the page's beforeunload (unsaved edits) is asked first, as when a browser tab is closed
    def closeEvent(self, event):
        if self.closing:
            QSettings().setValue("window/geometry", self.saveGeometry())
            if self in self.app.windows:
                self.app.windows.remove(self)
            if not self.app.windows:
                for view in list(self.app.devtools):
                    view.close()
            event.accept()
            return
        event.ignore()
        self.page.triggerAction(QWebEnginePage.WebAction.RequestClose)

    def close_now(self):
        self.closing = True
        self.close()

    def render_process_terminated(self, status, code):
        if self.closing:
            return
        if status == QWebEnginePage.RenderProcessTerminationStatus.NormalTerminationStatus:
            return
        # a crashed page can't answer beforeunload; it is reloaded, what was saved is in localStorage
        QTimer.singleShot(500, self.view.reload)


def data_location() -> Path:
    return Path(QStandardPaths.writableLocation(QStandardPaths.StandardLocation.AppDataLocation))


def main(argv: list[str]) -> int:
    qt_app = QApplication(argv)
    qt_app.setApplicationName(APP_NAME)
    qt_app.setApplicationDisplayName(APP_NAME)
    qt_app.setOrganizationName(ORGANIZATION)
    qt_app.setDesktopFileName("writejs")
    if paths.icon_path().is_file():
        qt_app.setWindowIcon(QIcon(str(paths.icon_path())))

    data_dir = data_location()
    data_dir.mkdir(parents=True, exist_ok=True)
    settings = AppSettings.load(data_dir / "settings.json")

    holder: dict[str, App] = {}
    try:
        server = WriteJsServer(settings, PORT, on_activate=lambda: holder["app"].activate_requested.emit())
    except OSError:
        # one app at a time: its documents and its browser profile are the same
        if is_running(PORT) and activate_running(PORT):
            return 0
        QMessageBox.critical(None, APP_NAME, f"{APP_NAME} can't start: port {PORT} is used by another program.")
        return 1
    server.start()
    app = holder["app"] = App(qt_app, settings, server, data_dir)
    if not settings.configured:
        app.edit_settings(first_run=True)
    app.new_window()
    code = qt_app.exec()
    server.shutdown()
    return code
