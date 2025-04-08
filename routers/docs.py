from typing import Annotated

from fastapi import Depends, HTTPException, status, Form, Response, APIRouter, Request, status
from utils.auth.utils import get_access_token, parse_auth_payload_and_return_login
from utils.auth.validators import *
from utils.controller import controller as c
from utils.auth.exceptions import *

from utils.docs.utils import *
from utils.docs.models import PortfolioUpdateModel, DocumentCreateModel, DocumentUpdateModel
from utils.docs.document import Document

from utils.templates.mailing import render_mail

from utils.mailing.mailing import send_mail
from utils.localizations.localizations import localizations

from utils.zlib_util.zlib_util import decompress, compress

router = APIRouter()

@router.get("/portfolio")
async def get_portfolio(request:Request, response:Response, auth_payload:dict = Depends(get_access_token)):
    r"GET /api/documents/ - returns document portfolio with names, created and bimber of chunks"
    login, user_id = parse_auth_payload_and_return_login(auth_payload)
    portfolio = c.db.get_portfolio(user_id)
    if portfolio:
        return parse_portfolio_object(portfolio).return_as_dict()
    raise HTTPException(404, "Documents portfolio not found for given user!")
    
@router.post("/portfolio")
async def post_portfolio(doc:PortfolioUpdateModel, auth_payload:dict = Depends(get_access_token)):
    # This may be an ednpoint for future iterations?
    return_msg = ""
    # user stuff
    login, user_id = parse_auth_payload_and_return_login(auth_payload)
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

    return {"msg": str(return_msg)}


@router.get("document/{doc_id}")
async def get_doc_latest(doc_id, auth_payload:dict = Depends(get_access_token)):
    # get user data
    login, user_id = parse_auth_payload_and_return_login(auth_payload)
    # get document
    content = c.db.get_document_content(doc_id)
    decompressed = decompress(content)
    return decompressed
    # return document
    raise NotImplementedError()

@router.post("document")
async def create_document(doc_data:DocumentCreateModel, auth_payload:dict = Depends(get_access_token)):
    #raise NotImplementedError("add check for name in dir and name")
    # get user data
    login, user_id = parse_auth_payload_and_return_login(auth_payload)
    # create document
    document = Document()
    document.create(user_id=user_id, **doc_data.__dict__)
    # update portfolio
    portfolio = update_portfolio_via_user_id(user_id)
    # return portfolio
    return portfolio.return_as_dict()
    raise NotImplementedError()

@router.put("document")
async def update_document(doc_id, doc_data:DocumentUpdateModel, auth_payload:dict = Depends(get_access_token)):
    # get user data
    login, user_id = parse_auth_payload_and_return_login(auth_payload)
    # update document
    document = Document(doc_id)
    document.update(**doc_data.__dict__)
    # update portfolio
    update_portfolio_via_user_id(user_id)
    # return portfolio
    portfolio = c.db.get_portfolio(user_id)
    return portfolio
    raise NotImplementedError()




