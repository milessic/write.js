from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from routers import auth, web, temp_notebooks
from utils.controller import controller as c
from fastapi.middleware.cors import CORSMiddleware


# FastAPI stuff
app = FastAPI(
    name="writejs",
    docs_url=c.SWAGGER_URL,
    redoc_url=c.REDOC_URL,
    openapi_url=c.OPENAPI_URL,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:8000", "http://localhost:38211", "http://127.0.0.1:38211"],
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
)
# Templates and static files
templates = Jinja2Templates(directory="static")
app.mount("/static", StaticFiles(directory="static"), name="static")

# Routers
# app.include_router(web.router, prefix="", tags=["web"], include_in_schema=False)
app.include_router(web.router, prefix="", tags=["web"], include_in_schema=True)
app.include_router(auth.router, prefix="/api/auth", tags=["Auth"])

# this is temporary, really
app.include_router(temp_notebooks.router, prefix="/api/notebooks", tags=["Notebooks"])
