import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from routers.notebooks import current_user_id
from utils.controller import controller as c

# Script secrets (static/secrets.js): the account's secrets flagged "synced", which scripts read with secret()
# (static/scriptapi.js) on every device of the user. The others never leave the browser they were added in.
# A secret is its name and its value; a write replaces the value, the last write wins.

router = APIRouter()

# like the client's scriptSecretNamePattern (static/secrets.js)
SECRET_NAME_PATTERN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,63}$")
MAX_SECRET_LENGTH = 64 * 1024
MAX_SECRETS = 200


class SaveSecretModel(BaseModel):
    value: str = Field(max_length=MAX_SECRET_LENGTH)


def valid_secret_name(name: str) -> str:
    if not SECRET_NAME_PATTERN.match(name):
        raise HTTPException(400, "invalid secret name")
    return name


@router.get("")
async def list_secrets(user_id: int = Depends(current_user_id)):
    return {"secrets": c.db.list_script_secrets(user_id)}


@router.put("/{name}")
async def save_secret(name: str, payload: SaveSecretModel, user_id: int = Depends(current_user_id)):
    valid_secret_name(name)
    if not c.db.script_secret_exists(user_id, name) and c.db.count_script_secrets(user_id) >= MAX_SECRETS:
        raise HTTPException(400, f"an account can have up to {MAX_SECRETS} synced secrets")
    c.db.save_script_secret(user_id, name, payload.value)
    return {"name": name}


@router.delete("/{name}")
async def delete_secret(name: str, user_id: int = Depends(current_user_id)):
    if not c.db.delete_script_secret(user_id, valid_secret_name(name)):
        raise HTTPException(404, "secret not found")
    return {"name": name}
