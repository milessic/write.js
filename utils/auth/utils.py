import bcrypt
import uuid
from typing import Annotated
import json
import jwt
from typing import Optional
from datetime import timedelta, datetime, UTC
from fastapi.responses import RedirectResponse
from fastapi import HTTPException, Cookie, Depends, Header, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from utils.controller import controller as c
from utils.controller import Controller
from string import ascii_lowercase, ascii_uppercase, ascii_letters
from random import SystemRandom, choice
from pydantic import BaseModel

from utils.auth.exceptions import *



def hash_password(string:str):
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(bytes(string, encoding="utf-8"),salt)

def unhash_password(password, hash) -> bool:
    return bcrypt.checkpw(bytes(password, encoding='utf-8'), hash)
    

def json_to_dict(obj:BaseModel|str):
    if isinstance(obj, BaseModel):
        return json.loads(obj.model_dump_json())
    return json.loads(obj)

def generate_access_token(sub:str, request:Request, controller:Controller=c):
    expire = datetime.now(UTC) + timedelta(minutes=controller.ACCESS_TOKEN_EXPIRES_MINUTES)
    jwt_data = {"sub": sub, "exp": expire}
    token = jwt.encode(jwt_data, controller.SECRET_KEY)
    user_id = controller.db.get_user_id_from_username(sub)
    if user_id is None:
        raise HTTPException(500, {"msg": c.locales.get_with_request("txt_error_jwt_user_not_found", request).format(sub)})
    controller.db.create_access_token_record(token, user_id, get_epoch_now() + 60*controller.ACCESS_TOKEN_EXPIRES_MINUTES)
    return token

def generate_refresh_token(sub:str, request, controller:Controller=c):
    expire = datetime.now(UTC) + timedelta(minutes=controller.REFRESH_TOKEN_EXPIRES_MINUTES)
    jwt_data = {"sub": sub, "exp": expire}
    token = jwt.encode(jwt_data, controller.SECRET_KEY)
    user_id = controller.db.get_user_id_from_username(sub)
    if user_id is None:
        raise HTTPException(500, {"msg": c.locales.get_with_request("txt_error_jwt_user_not_found", request).format(sub)})
    controller.db.create_refresh_token_record(token, user_id, get_epoch_now() + 60*controller.REFRESH_TOKEN_EXPIRES_MINUTES)
    return token


def decode_token(token, controller:Controller=c):
    return jwt.decode(token,controller.SECRET_KEY, algorithms=[controller.ALGORITHM])

async def get_access_token(
        request:Request,
        access_token: str = Cookie(None),
        authorization: HTTPAuthorizationCredentials = Depends(HTTPBearer(auto_error=False)),
        Bearer: Annotated[str|None, Header()]=None,
        ):

    token = None
    # Prefer Authorization header if provided
    if authorization and authorization.scheme.lower() == "bearer":
        token = authorization.credentials
    elif access_token:
        token = access_token
    elif Bearer:
        token = Bearer
    if not token:
        raise HTTPException(status_code=401, detail=c.locales.get_with_request("txt_error_jwt_token_not_provided", request))
    return verify_access_token(token, request)

async def get_access_token_or_return_to_homepage(
        request:Request,
        refresh_token: str = Cookie(None),
        authorization: HTTPAuthorizationCredentials = Depends(HTTPBearer(auto_error=False)),
        Bearer: Annotated[str|None, Header()]=None,
        ):

    token = None
    # Prefer Authorization header if provided
    if authorization and authorization.scheme.lower() == "bearer":
        token = authorization.credentials
    elif refresh_token:
        token = refresh_token 
    elif Bearer:
        token = Bearer
    if not token:
        raise HTTPException(status_code=401, detail=c.locales.get_with_request("txt_error_jwt_token_not_provided", request))
    try:
        return verify_jwt_token(token, "refresh", request)
    except HTTPException:
        return {"return_to_homepage": True}

async def get_refresh_token(
        request:Request,
        refresh_token: str = Cookie(None),
        authorization: HTTPAuthorizationCredentials = Depends(HTTPBearer(auto_error=False)),
        Bearer: Annotated[str|None, Header()]=None,
        ):

    token = None
    # Prefer Authorization header if provided
    if authorization and authorization.scheme.lower() == "bearer":
        token = authorization.credentials
    elif refresh_token:
        token = refresh_token 
    elif Bearer:
        token = Bearer
    if not token:
        raise HTTPException(status_code=401, detail=c.locales.get_with_request("txt_error_jwt_token_not_provided", request))
    return verify_jwt_token(token, "refresh", request)


def verify_access_token(token: str|None, request:Request, controller:Controller=c):
    if token is None:
        raise HTTPException(status_code=401, detail=controller.locales.get_with_request("txt_error_jwt_invalid_or_expired_token", request))
    return verify_jwt_token(token, "access", request, controller)

def verify_jwt_token(token:str, scenario:str, request:Request, controller:Controller=c):
    try:
        payload = jwt.decode(token, c.SECRET_KEY, algorithms=[c.ALGORITHM])
        sub = payload.get('sub')
        user_id = c.db.get_user_id_from_username(sub)
        if user_id is None:
            raise HTTPException(500, {"msg": c.locales.get_with_request("txt_error_jwt_user_not_found", request).format(sub)})
        if scenario.startswith("access") and \
                not c.db.check_if_access_token_is_active_for_user(
                    token, 
                    user_id=user_id,
                    expires=get_epoch_now()
                ):
            raise jwt.exceptions.ExpiredSignatureError()
        elif scenario.startswith("refresh") and \
                not (x := c.db.check_if_refresh_token_is_active_for_user(
                    token, 
                    user_id=user_id,
                    expires=get_epoch_now())
                ):
            raise jwt.exceptions.ExpiredSignatureError()
        return payload  
    except jwt.exceptions.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail=controller.locales.get_with_request("txt_error_jwt_invalid_or_expired_token", request))

def get_epoch_now(**timedeltas) -> int:
    return int((datetime.now() + timedelta(**timedeltas)).timestamp())

def generate_guid() -> str:
    return str(uuid.uuid4())

def generate_random_password() -> str:
    return "".join(SystemRandom().choice(ascii_letters + ascii_uppercase + ascii_lowercase) for _ in range(10))

def check_if_user_can_login(user_id:int, controller:Controller=c) -> None:
    expires = get_epoch_now()
    # check if account is blocked due to maximum invalid attempts
    
    if ( controller.db.get_failed_login_attempts(user_id, expires) > controller.MAX_LOGIN_ATTEMPTS ) :
        raise UserIsBlocked()

