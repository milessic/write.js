import os
import sys
from pathlib import Path

PACKAGE_DIR = Path(__file__).parent
REPO_DIR = PACKAGE_DIR.parent.parent


def static_dir() -> Path:
    """The web app's files: WRITEJS_STATIC, the copy bundled by PyInstaller / pyqtdeploy, or the repo's static/."""
    if os.environ.get("WRITEJS_STATIC"):
        return Path(os.environ["WRITEJS_STATIC"])
    bundled = getattr(sys, "_MEIPASS", None)
    if bundled and (Path(bundled) / "static").is_dir():
        return Path(bundled) / "static"
    if (PACKAGE_DIR / "static").is_dir():
        return PACKAGE_DIR / "static"
    return REPO_DIR / "static"


def icon_path() -> Path:
    return static_dir() / "icons" / "icon-512.png"
