"""Bundle the web frontend for the Tauri app (src-tauri) into build/app.

The web page is rendered per request by routers/web.py; the app has no server to render it,
so this renders static/index.html once with the app context and copies static/ next to it.

    WRITEJS_API_BASE=https://writejs.example.com python3 scripts/build_app.py
"""

import json
import os
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STATIC = ROOT / "static"
OUT = ROOT / "build" / "app"
SHOWDOWN = ROOT / "node_modules" / "showdown" / "dist" / "showdown.min.js"
DEFAULT_API_BASE = "http://localhost:8090"  # run_dev.sh

try:
    from jinja2 import Environment, FileSystemLoader
except ImportError:
    # Tauri runs this with the system python; fall back to the project's venv
    venv_python = ROOT / ".venv" / "bin" / "python"
    if venv_python.exists() and Path(sys.prefix).resolve() != venv_python.parent.parent.resolve():
        os.execv(venv_python, [str(venv_python), *sys.argv])
    raise


def main():
    api_base = os.environ.get("WRITEJS_API_BASE", DEFAULT_API_BASE).rstrip("/")

    shutil.rmtree(OUT, ignore_errors=True)
    shutil.copytree(STATIC, OUT / "static", ignore=shutil.ignore_patterns("index.html", ".DS_Store"))
    shutil.copy(STATIC / "favicon.svg", OUT / "favicon.svg")

    # bundle showdown so markdown works offline; the web page keeps using the CDN
    showdown_src = None
    if SHOWDOWN.exists():
        (OUT / "static" / "vendor").mkdir(exist_ok=True)
        shutil.copy(SHOWDOWN, OUT / "static" / "vendor" / "showdown.min.js")
        showdown_src = "static/vendor/showdown.min.js"
    else:
        print("build_app: node_modules/showdown missing (npm install), using the CDN", file=sys.stderr)

    (OUT / "static" / "app-config.js").write_text(
        f"window.WRITEJS_APP = {json.dumps({'apiBase': api_base})};\n"
    )

    env = Environment(loader=FileSystemLoader(STATIC), autoescape=True)
    html = env.get_template("index.html").render(
        native_app=True,
        is_authenticated=False,
        showdown_src=showdown_src,
        # no themes server in the app (yet): the bundled default theme
        theme="writejs",
        themes_available=False,
    )
    (OUT / "index.html").write_text(html)
    print(f"build_app: {OUT.relative_to(ROOT)} (API: {api_base})")


if __name__ == "__main__":
    main()
