"""Builds the desktop app with PyInstaller, on the system it is run on (PyInstaller doesn't cross-compile):
- macOS: dist/Write.JS.app
- Linux: dist/Write.JS/ (run dist/Write.JS/Write.JS), plus dist/writejs.desktop for a launcher

    pip install -r requirements.txt pyinstaller pillow
    python build_desktop.py
"""

import shutil
import sys
from pathlib import Path

import PyInstaller.__main__

HERE = Path(__file__).parent
REPO = HERE.parent
SEP = ";" if sys.platform == "win32" else ":"


def main():
    args = [
        str(HERE / "main.py"),
        "--name", "Write.JS",
        "--windowed",
        "--noconfirm",
        "--clean",
        "--distpath", str(HERE / "dist"),
        "--workpath", str(HERE / "build"),
        "--specpath", str(HERE / "build"),
        "--icon", str(REPO / "static" / "icons" / "icon-512.png"),
        # the web app, and the package's own files next to its modules
        "--add-data", f"{REPO / 'static'}{SEP}static",
        "--add-data", f"{HERE / 'writejs_app' / 'mobile_shim.js'}{SEP}writejs_app",
        "--add-data", f"{HERE / 'writejs_app' / 'qml'}{SEP}writejs_app/qml",
        "--exclude-module", "PyQt6.QtWebEngineQuick",
        "--osx-bundle-identifier", "com.milessic.writejs",
    ]
    PyInstaller.__main__.run(args)
    if sys.platform.startswith("linux"):
        desktop = HERE / "dist" / "writejs.desktop"
        target = HERE / "dist" / "Write.JS"
        shutil.copy(REPO / "static" / "icons" / "icon-512.png", target / "writejs.png")
        desktop.write_text(
            "[Desktop Entry]\nType=Application\nName=Write.JS\nComment=Create, edit and manage documents, also offline\n"
            f"Exec={target / 'Write.JS'}\nIcon={target / 'writejs.png'}\nCategories=Office;TextEditor;\n"
            "StartupWMClass=writejs\nTerminal=false\n"
        )
        print(f"Linux: {target / 'Write.JS'}; to add it to the launcher: cp {desktop} ~/.local/share/applications/")


if __name__ == "__main__":
    main()
