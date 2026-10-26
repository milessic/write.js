"""Write.JS on Android and iOS: the page in the platform's web view through QML's QtWebView (WKWebView,
Android WebView), the local server in the same process. Built with pyqtdeploy, see pyqt_app/README.md.

`python -m writejs_app --mobile` runs it on a desktop with QtWebEngine instead, to try it out."""

from pathlib import Path

import os
import shutil

try:
    from PyQt6.QtCore import QDirIterator, QFile, QStandardPaths, QUrl
    from PyQt6.QtGui import QGuiApplication, QIcon
    from PyQt6.QtQml import QQmlApplicationEngine
    QT5 = False
except ImportError:
    # pyqtdeploy, the way to Android and iOS, builds Qt 5 only
    from PyQt5.QtCore import QDirIterator, QFile, QStandardPaths, QUrl
    from PyQt5.QtGui import QGuiApplication, QIcon
    from PyQt5.QtQml import QQmlApplicationEngine
    QT5 = True

from . import APP_NAME, ORGANIZATION, PORT, paths
from .server import WriteJsServer, is_running
from .settings import AppSettings


def _web_view() -> tuple[str, str]:
    """The QML import and type of the web view: QtWebView where it is built in (phones), else QtWebEngine."""
    try:
        if QT5:
            from PyQt5.QtWebEngine import QtWebEngine as QtWebEngineQuick
        else:
            from PyQt6.QtWebEngineQuick import QtWebEngineQuick
    except ImportError:
        return "import QtWebView" + (" 1.15" if QT5 else ""), "WebView"
    # needs to run before the application exists
    QtWebEngineQuick.initialize()
    return "import QtWebEngine" + (" 1.10" if QT5 else ""), "WebEngineView"


def _extract_resources(target: Path):
    """pyqtdeploy freezes the package and static/ into Qt resources (":/..."), which the server's file reads and
    Jinja can't open: they are copied to the app's data, again on every start, so an update brings its own files."""
    package = str(paths.PACKAGE_DIR)
    if not package.startswith(":"):
        return
    shutil.rmtree(target, ignore_errors=True)
    subdirectories = getattr(QDirIterator, "Subdirectories", None) or QDirIterator.IteratorFlag.Subdirectories
    for resources, name in ((":/static", "static"), (package, "writejs_app")):
        iterator = QDirIterator(resources, subdirectories)
        while iterator.hasNext():
            source = iterator.next()
            if not iterator.fileInfo().isFile() or source.endswith((".py", ".pyc")):
                continue
            file = QFile(source)
            if not file.open(getattr(QFile, "ReadOnly", None) or QFile.OpenModeFlag.ReadOnly):
                continue
            destination = target / name / source[len(resources):].lstrip("/")
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(bytes(file.readAll()))
            file.close()
    paths.PACKAGE_DIR = target / "writejs_app"
    os.environ["WRITEJS_STATIC"] = str(target / "static")


def main(argv: list[str]) -> int:
    web_import, web_type = _web_view()
    qt_app = QGuiApplication(argv)
    qt_app.setApplicationName(APP_NAME)
    qt_app.setOrganizationName(ORGANIZATION)
    data_dir = Path(QStandardPaths.writableLocation(QStandardPaths.StandardLocation.AppDataLocation))
    data_dir.mkdir(parents=True, exist_ok=True)
    downloads = Path(QStandardPaths.writableLocation(QStandardPaths.StandardLocation.DocumentsLocation))
    settings = AppSettings.load(data_dir / "settings.json")
    _extract_resources(data_dir / "bundled")
    if paths.icon_path().is_file():
        qt_app.setWindowIcon(QIcon(str(paths.icon_path())))

    server = None
    try:
        server = WriteJsServer(settings, PORT, mobile=True, downloads_dir=downloads)
        server.start()
    except OSError:
        # only when tried on a desktop next to the desktop app: its server is used
        if not is_running(PORT):
            raise
    url = QUrl(f"http://127.0.0.1:{PORT}/" if settings.configured else f"http://127.0.0.1:{PORT}/__writejs_app__/settings")
    if not settings.configured:
        settings.update(configured=True)

    qml = (paths.PACKAGE_DIR / "qml" / "Main.qml").read_text("utf-8")
    qml = qml.replace("WEBVIEW_IMPORT", web_import).replace("WEBVIEW_TYPE", web_type)
    qml = qml.replace(" QT_VERSION", " 2.15" if QT5 else "")
    engine = QQmlApplicationEngine()
    engine.rootContext().setContextProperty("appUrl", url)
    engine.loadData(qml.encode("utf-8"), QUrl.fromLocalFile(str(paths.PACKAGE_DIR / "qml" / "Main.qml")))
    if not engine.rootObjects():
        return 1
    code = qt_app.exec()
    if server:
        server.shutdown()
    return code
