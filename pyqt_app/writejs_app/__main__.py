import sys


def run() -> int:
    argv = [a for a in sys.argv if a != "--mobile"]
    try:
        from PyQt6.QtCore import QSysInfo
    except ImportError:
        from PyQt5.QtCore import QSysInfo
    mobile = "--mobile" in sys.argv or QSysInfo.productType() in ("android", "ios")
    if mobile:
        from .mobile import main
    else:
        from .desktop import main
    return main(argv)


if __name__ == "__main__":
    sys.exit(run())
