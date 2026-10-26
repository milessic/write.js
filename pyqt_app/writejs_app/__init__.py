"""Write.JS as a native app: the web app from static/, served by a local server and shown in a Qt web view.

The local server (server.py) renders the same page as routers/web.py and passes /api to the Write.JS server
set in the app settings, so the page, its storage and its cookies live on one fixed local origin.
"""

APP_NAME = "Write.JS"
ORGANIZATION = "milessic"
# fixed, because localStorage (the documents) belongs to the origin; listed in main.py's CORS origins
PORT = 38211
