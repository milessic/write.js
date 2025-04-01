from fastapi import  FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from routers import auth, web, temp_notebooks, docs
from utils.controller import controller as c



# FastAPI stuff
app = FastAPI(
        name="writejs",
        docs_url=c.SWAGGER_URL,
        redoc_url=c.REDOC_URL,
        openapi_url=c.OPENAPI_URL
        )

# Templates and static files
templates = Jinja2Templates(directory="static")
app.mount("/static", StaticFiles(directory="static"), name="static")

# Routers
#app.include_router(web.router, prefix="", tags=["web"], include_in_schema=False)
app.include_router(web.router, prefix="", tags=["web"], include_in_schema=True)
app.include_router(auth.router, prefix="/api/auth", tags=["Auth"])
app.include_router(docs.router, prefix="/api/docs", tags=["Docs"])

# this is temporary, really
app.include_router(temp_notebooks.router, prefix="/api/notebooks", tags=["Notebooks"])

