from fastapi.responses import FileResponse
from fastapi.routing import APIRouter
from fastapi.templating import Jinja2Templates
from fastapi import Request, HTTPException
from pathlib import Path

from utils.auth.utils import verify_access_token
from utils.themes import theme_context, THEME_COOKIE

templates = Jinja2Templates(directory="static")

router = APIRouter()
STATIC_DIR = Path(__file__).parent.parent / "static"


@router.get("/", response_class=FileResponse)
async def read_index(request: Request):
    """Serve the index.html file."""
    try:
        verify_access_token(request.cookies.get("access_token"), request)
        is_authenticated = True
    except HTTPException as e:
        if e.status_code != 401:
            raise
        is_authenticated = False

    return templates.TemplateResponse(
        "index.html",
        {
            "request": request,
            "is_authenticated": is_authenticated,
            **theme_context(request.cookies.get(THEME_COOKIE)),
        },
    )


@router.get("/favicon.svg", response_class=FileResponse)
async def read_favicon():
    """Serve the favicon.svg file."""
    return STATIC_DIR / "favicon.svg"


@router.get("/sw.js", response_class=FileResponse)
async def read_service_worker():
    """Serve the service worker from the root, so its scope covers the whole app."""
    return FileResponse(
        STATIC_DIR / "sw.js",
        media_type="application/javascript",
        headers={"Cache-Control": "no-cache"},
    )
