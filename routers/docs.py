from typing import Annotated

from fastapi import Depends, HTTPException, status, Form, Response, APIRouter, Request, status
from utils.auth.utils import get_access_token
from utils.auth.validators import *
from utils.controller import controller as c
from utils.auth.exceptions import *

from utils.docs.utils import *
from utils.docs.models import PortfolioUpdateModel

from utils.templates.mailing import render_mail

from utils.mailing.mailing import send_mail
from utils.localizations.localizations import localizations


router = APIRouter()

@router.get("/portfolio")
async def get_portfolio(request:Request, response:Response, auth_payload:dict = Depends(get_access_token)):
    r"GET /api/documents/ - returns document portfolio with names, created and bimber of chunks"
    login = auth_payload.get("sub")
    if login is None:
        raise HTTPException(500, "Could not proceed credentials")
    user = c.db.get_user_data(login)
    if user is None:
        raise HTTPException(500, "User error")
    portfolio = c.db.get_portfolio(user[3])
    if portfolio:
        return portfolio
    raise HTTPException(404, "Documents portfolio not found for given user!")
    
@router.post("/portfolio")
async def post_portfolio(doc:PortfolioUpdateModel, auth_payload:dict = Depends(get_access_token)):
    return_msg = ""
    # user stuff
    login = auth_payload.get("sub")
    if login is None:
        raise HTTPException(500, "Could not proceed credentials")
    user = c.db.get_user_data(login)
    if user is None:
        raise HTTPException(500, "User error")
    user_id = user[3]
    # get and validate portfolio
    portfolio_json = c.db.get_portfolio(user_id)
    if not portfolio_json:
        raise HTTPException(404, "Documents portfolio not found for given user!")
    portfolio = parse_portfolio_object(portfolio_json)

    # update portfolio
    if portfolio.is_doc_exists(doc.doc_id):
        # update
        portfolio.update_document(doc)
        return_msg = "updated"
    else:
        # create new document
        portfolio.add_new_document(doc)
        return_msg = "created"

    # save portfolio
    c.db.update_portfolio(user_id, portfolio.return_as_json())

    return {"msg": f"{return_msg}"}








