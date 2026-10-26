import json
import os
import threading
from dataclasses import asdict, dataclass, field
from pathlib import Path


@dataclass
class AppSettings:
    """The app's own settings (not Write.JS's, those are in the page's localStorage), kept as settings.json.
    Empty server_url: no cloud, the documents stay on this device. Empty themes_url: the bundled Write.js theme."""

    server_url: str = ""
    themes_url: str = ""
    # the first-run dialog asking for the server has been shown
    configured: bool = False
    path: Path | None = field(default=None, repr=False, compare=False)

    def __post_init__(self):
        self._lock = threading.Lock()

    @classmethod
    def load(cls, path: Path) -> "AppSettings":
        data = {}
        try:
            data = json.loads(path.read_text("utf-8"))
        except (OSError, ValueError):
            pass
        known = {k: v for k, v in data.items() if k in ("server_url", "themes_url", "configured")}
        settings = cls(**known, path=path)
        # the environment wins, e.g. WRITEJS_SERVER=http://localhost:8990 for development
        if os.environ.get("WRITEJS_SERVER") is not None:
            settings.server_url = os.environ["WRITEJS_SERVER"]
            settings.configured = True
        if os.environ.get("WRITEJS_THEMES") is not None:
            settings.themes_url = os.environ["WRITEJS_THEMES"]
        settings.server_url = normalize_url(settings.server_url)
        settings.themes_url = normalize_url(settings.themes_url)
        return settings

    def update(self, **values):
        with self._lock:
            for key, value in values.items():
                if key in ("server_url", "themes_url"):
                    value = normalize_url(value)
                setattr(self, key, value)
            self.save()

    def save(self):
        if self.path is None:
            return
        self.path.parent.mkdir(parents=True, exist_ok=True)
        data = {k: v for k, v in asdict(self).items() if k != "path"}
        self.path.write_text(json.dumps(data, indent=2), "utf-8")


def normalize_url(url: str | None) -> str:
    url = (url or "").strip().rstrip("/")
    if url and "://" not in url:
        url = "https://" + url
    return url
