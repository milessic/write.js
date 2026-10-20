import re

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from utils.auth.utils import get_access_token
from utils.controller import controller as c

# Notebooks and their documents, synced document by document (static/cloudsync.js).
# Every user has a "Default" notebook, created on first use. Writes carry the version the client
# last saw (base_version, 0 for a new document); a stale one is answered with 409 and the current version.

router = APIRouter()

DEFAULT_NOTEBOOK_NAME = "Default"
# the client keeps whole notebooks in localStorage (~5M characters), a single document can't be bigger
MAX_CONTENT_LENGTH = 6 * 1024 * 1024
MAX_NAME_LENGTH = 512
MAX_FETCH = 200
DOC_ID_PATTERN = re.compile(r"^[0-9a-fA-F-]{8,64}$")


class SaveDocumentModel(BaseModel):
    name: str = Field(min_length=1, max_length=MAX_NAME_LENGTH)
    content: str = Field(max_length=MAX_CONTENT_LENGTH)
    base_version: int = Field(ge=0)


class SaveMetaModel(BaseModel):
    content: str = Field(max_length=MAX_CONTENT_LENGTH)
    base_version: int = Field(ge=0)


class FetchDocumentsModel(BaseModel):
    doc_ids: list[str] = Field(max_length=MAX_FETCH)


def current_user_id(token_data: dict = Depends(get_access_token)) -> int:
    if (sub := token_data.get("sub")) is None or (
        user_id := c.db.get_user_id_from_username(sub)
    ) is None:
        raise HTTPException(401, "user not found")
    return user_id


def user_notebooks(user_id: int) -> list[dict]:
    if not (notebooks := c.db.get_notebooks(user_id)):
        c.db.create_notebook_for_user(user_id, DEFAULT_NOTEBOOK_NAME)
        notebooks = c.db.get_notebooks(user_id)
    return notebooks


def owned_notebook_meta(notebook_id: int, user_id: int) -> tuple:
    if (meta := c.db.get_notebook_meta(notebook_id, user_id)) is None:
        raise HTTPException(404, "notebook not found")
    return meta


def valid_doc_id(doc_id: str) -> str:
    if not DOC_ID_PATTERN.match(doc_id):
        raise HTTPException(400, "invalid document id")
    return doc_id


def conflict(current: dict | None) -> JSONResponse:
    return JSONResponse(
        status_code=409,
        content={
            "detail": "version conflict",
            "version": current["version"] if current else 0,
            "deleted": current["deleted"] if current else False,
        },
    )


@router.get("")
async def list_notebooks(user_id: int = Depends(current_user_id)):
    return {"notebooks": user_notebooks(user_id)}


@router.get("/{notebook_id}/documents")
async def list_documents(notebook_id: int, user_id: int = Depends(current_user_id)):
    "what the notebook holds, without the contents: versions to compare with the last sync"
    _, meta_version = owned_notebook_meta(notebook_id, user_id)
    documents = c.db.list_notebook_documents(notebook_id)
    # never synced document by document, but there is a notebook from before: the client moves it
    legacy = not documents and not meta_version and c.db.get_notebook(user_id) is not None
    return {
        "notebook_id": notebook_id,
        "meta_version": meta_version,
        "documents": documents,
        "legacy": legacy,
    }


@router.post("/{notebook_id}/documents/fetch")
async def fetch_documents(
    notebook_id: int, payload: FetchDocumentsModel, user_id: int = Depends(current_user_id)
):
    owned_notebook_meta(notebook_id, user_id)
    documents = [c.db.get_notebook_document(notebook_id, valid_doc_id(d)) for d in payload.doc_ids]
    return {"documents": [d for d in documents if d is not None]}


@router.get("/{notebook_id}/documents/{doc_id}")
async def get_document(notebook_id: int, doc_id: str, user_id: int = Depends(current_user_id)):
    owned_notebook_meta(notebook_id, user_id)
    if (document := c.db.get_notebook_document(notebook_id, valid_doc_id(doc_id))) is None:
        raise HTTPException(404, "document not found")
    return document


@router.put("/{notebook_id}/documents/{doc_id}")
async def save_document(
    notebook_id: int, doc_id: str, payload: SaveDocumentModel, user_id: int = Depends(current_user_id)
):
    owned_notebook_meta(notebook_id, user_id)
    version = c.db.save_notebook_document(
        notebook_id, valid_doc_id(doc_id), payload.name, payload.content, payload.base_version
    )
    if version is None:
        return conflict(c.db.get_notebook_document(notebook_id, doc_id))
    return {"doc_id": doc_id, "version": version}


@router.delete("/{notebook_id}/documents/{doc_id}")
async def delete_document(
    notebook_id: int, doc_id: str, base_version: int, user_id: int = Depends(current_user_id)
):
    owned_notebook_meta(notebook_id, user_id)
    if (current := c.db.get_notebook_document(notebook_id, valid_doc_id(doc_id))) is None:
        raise HTTPException(404, "document not found")
    if current["deleted"]:
        return {"doc_id": doc_id, "version": current["version"]}
    if (version := c.db.delete_notebook_document(notebook_id, doc_id, base_version)) is None:
        return conflict(current)
    return {"doc_id": doc_id, "version": version}


@router.get("/{notebook_id}/meta")
async def get_meta(notebook_id: int, user_id: int = Depends(current_user_id)):
    content, version = owned_notebook_meta(notebook_id, user_id)
    return {"content": content, "version": version}


@router.put("/{notebook_id}/meta")
async def save_meta(notebook_id: int, payload: SaveMetaModel, user_id: int = Depends(current_user_id)):
    _, current_version = owned_notebook_meta(notebook_id, user_id)
    if (
        version := c.db.update_notebook_meta(notebook_id, user_id, payload.content, payload.base_version)
    ) is None:
        return JSONResponse(
            status_code=409, content={"detail": "version conflict", "version": current_version}
        )
    return {"version": version}
