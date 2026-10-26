import QtQuick QT_VERSION
import QtQuick.Window QT_VERSION
WEBVIEW_IMPORT

// Write.JS on Android / iOS: the page in the platform's web view (WKWebView, Android WebView), full screen.
// mobile.py fills in the placeholders: Qt 5 (pyqtdeploy builds) or Qt 6, QtWebView on a phone or QtWebEngine
// when the mobile build is tried on a desktop.
Window {
    id: root
    visible: true
    visibility: Qt.platform.os === "android" || Qt.platform.os === "ios" ? Window.FullScreen : Window.Windowed
    width: 420
    height: 860
    title: "Write.JS"
    color: "#2c2c2c"

    WEBVIEW_TYPE {
        anchors.fill: parent
        url: appUrl
    }
}
