import json
import time
import urllib.request

from utils.controller import controller as c

THEMES_URL = c.MILESSIC_THEMES
THEMES_VERSION = "1.8.0"
DEFAULT_THEME = "writejs"
THEME_COOKIE = "theme"
# served from static/ when the themes server is unreachable
BACKUP_STYLESHEET = f"static/themes/{DEFAULT_THEME}.css?v={THEMES_VERSION}"

_RETRY_AFTER_SECONDS = 60
_registry = None
_registry_failed_at = None


def registry() -> dict | None:
    """Theme registry from the milessic-themes server, cached in the process.
    Returns None when the server is not configured or unreachable (retried after a minute)."""
    global _registry, _registry_failed_at
    if _registry is not None or not THEMES_URL:
        return _registry
    if _registry_failed_at and time.monotonic() - _registry_failed_at < _RETRY_AFTER_SECONDS:
        return None
    try:
        with urllib.request.urlopen(f"{THEMES_URL}/api/themes", timeout=3) as response:
            _registry = json.load(response)
    except (OSError, ValueError):
        _registry_failed_at = time.monotonic()
    return _registry


def theme_keys() -> set[str]:
    reg = registry()
    return {t["key"] for t in reg["themes"]} if reg else {DEFAULT_THEME}


def resolve_theme(key: str | None) -> str:
    """The registry is the allow-list; anything else falls back to the default theme."""
    return key if key in theme_keys() else DEFAULT_THEME


def theme_context(requested: str | None) -> dict:
    """Template variables for rendering the theme into the page."""
    theme = resolve_theme(requested)
    available = registry() is not None
    return {
        "theme": theme,
        "themes_available": available,
        "themes_url": THEMES_URL,
        "themes_version": THEMES_VERSION,
        "theme_stylesheet": (
            f"{THEMES_URL}/css/bundle/{theme}.css?v={THEMES_VERSION}"
            if available
            else BACKUP_STYLESHEET
        ),
        "theme_backup_stylesheet": BACKUP_STYLESHEET,
        "default_theme": DEFAULT_THEME,
    }
