import hashlib
from pathlib import Path

STATIC_DIR = Path(__file__).parent.parent / "static"

# path -> (mtime, hash), rehashed only when the file changes on disk
_hashes: dict[str, tuple[float, str]] = {}


def static_url(path: str) -> str:
    """URL of a file in static/ versioned by its content, so every change gets a new URL
    and browsers (Safari especially) and the service worker never serve an old copy."""
    file = STATIC_DIR / path
    mtime = file.stat().st_mtime
    cached = _hashes.get(path)
    if cached is None or cached[0] != mtime:
        cached = (mtime, hashlib.md5(file.read_bytes()).hexdigest()[:10])
        _hashes[path] = cached
    return f"static/{path}?v={cached[1]}"
