from fastapi import FastAPI
from fastapi.responses import FileResponse
from pathlib import Path

app = FastAPI()

"""
from starlette.middleware.base import BaseHTTPMiddleware
class DisableCacheMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        response = await call_next(request)
        if request.url.path.startswith("/static/"):
            response.headers["Cache-Control"] = "no-store"
        return response

app.add_middleware(DisableCacheMiddleware)

"""

# Base directory for static files
STATIC_DIR = Path(__file__).parent / "static"

@app.get("/", response_class=FileResponse)
async def read_index():
    """Serve the index.html file."""
    return STATIC_DIR / "index.html"

@app.get("/styles.css", response_class=FileResponse)
async def read_styles():
    return STATIC_DIR / "styles.css"

@app.get("/script.js", response_class=FileResponse)
async def read_scriptx():
    return STATIC_DIR / "script.js"

@app.get("/favicon.svg", response_class=FileResponse)
async def read_favicon():
    """Serve the favicon.svg file."""
    return STATIC_DIR / "favicon.svg"

