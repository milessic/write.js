"""Entry point for PyInstaller and pyqtdeploy: `python main.py` is `python -m writejs_app`."""

import sys

from writejs_app.__main__ import run

if __name__ == "__main__":
    sys.exit(run())
