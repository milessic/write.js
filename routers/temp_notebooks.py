from fastapi import Response, Request, APIRouter, Depends, HTTPException
from pydantic import BaseModel
from utils.auth.utils import get_access_token, json_to_dict
from utils.controller import controller as c

# this is not proper code, but it's just for testing the auth and working on frontend

router = APIRouter()

class CreateNotebookModel(BaseModel):
    json_content: str

@router.get("/notebook")
async def get_notebook(request:Request, token_data:dict=Depends(get_access_token)):
    if ( sub := token_data.get("sub") ) is not None\
    and ( user_id := c.db.get_user_id_from_username(sub) ) is not None:
        content = c.db.get_notebook(user_id)
        if content is None:
            raise HTTPException(404, "no notebook for user")
        return {"json_content": content}
    raise HTTPException(401,"nope")

@router.post("/notebook", status_code=201)
async def post_notebook(payload:CreateNotebookModel, token_data:dict=Depends(get_access_token)):
    if ( sub := token_data.get("sub") ) is None:
        raise HTTPException(401,"sub nope")
    if ( content := json_to_dict(payload).get("json_content") ) is None:
        raise HTTPException(400,"content nope")
    if ( user_id := c.db.get_user_id_from_username(sub) ) is None:
        raise HTTPException(400,"user_id nope")
    c.db.create_notebook( user_id, content )
    return {"content": "ok"}

