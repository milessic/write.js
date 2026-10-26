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
# five fields: minute hour day month weekday, each *, numbers, ranges, lists, steps or _ (static/cron.js)
CRON_PATTERN = re.compile(r"^[0-9*,/_-]+( [0-9*,/_-]+){4}$")
MAX_CRON_LOG = 100
MAX_CRONS = 100


class SaveDocumentModel(BaseModel):
    name: str = Field(min_length=1, max_length=MAX_NAME_LENGTH)
    content: str = Field(max_length=MAX_CONTENT_LENGTH)
    base_version: int = Field(ge=0)


class SaveMetaModel(BaseModel):
    content: str = Field(max_length=MAX_CONTENT_LENGTH)
    base_version: int = Field(ge=0)


class FetchDocumentsModel(BaseModel):
    doc_ids: list[str] = Field(max_length=MAX_FETCH)


class SaveCronModel(BaseModel):
    # what isn't given stays as it is; a new job needs doc_id, script and cron
    doc_id: str | None = Field(default=None, max_length=64)
    script: str | None = Field(default=None, min_length=1, max_length=MAX_NAME_LENGTH)
    cron: str | None = Field(default=None, max_length=128)
    executor: str | None = Field(default=None, max_length=64)
    executor_name: str | None = Field(default=None, max_length=128)
    enabled: bool | None = None
    enabled_at: int | None = None
    last_run: int | None = None
    missed: bool | None = None


class CronLogModel(BaseModel):
    cron_id: str = Field(max_length=64)
    at: int
    ok: bool
    message: str = Field(max_length=2048)
    executor_name: str = Field(default="", max_length=128)


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


# cron jobs (static/cron.js): kept apart from the documents and the meta, they don't sync with them
@router.get("/{notebook_id}/crons")
async def list_crons(notebook_id: int, user_id: int = Depends(current_user_id)):
    owned_notebook_meta(notebook_id, user_id)
    return {
        "crons": c.db.list_notebook_crons(notebook_id),
        "log": c.db.list_notebook_cron_log(notebook_id, MAX_CRON_LOG),
    }


@router.put("/{notebook_id}/crons/{cron_id}")
async def save_cron(
    notebook_id: int, cron_id: str, payload: SaveCronModel, user_id: int = Depends(current_user_id)
):
    owned_notebook_meta(notebook_id, user_id)
    current = c.db.get_notebook_cron(notebook_id, valid_doc_id(cron_id))
    if current is None and len(c.db.list_notebook_crons(notebook_id)) >= MAX_CRONS:
        raise HTTPException(400, f"a notebook can have up to {MAX_CRONS} cron jobs")
    cron = current or {
        "cron_id": cron_id, "doc_id": None, "script": None, "cron": None, "executor": "", "executor_name": "",
        "enabled": True, "enabled_at": None, "last_run": None, "missed": False,
    }
    cron.update(payload.model_dump(exclude_unset=True))
    if cron["doc_id"] is None or cron["script"] is None or cron["cron"] is None:
        raise HTTPException(400, "a new cron job needs doc_id, script and cron")
    valid_doc_id(cron["doc_id"])
    if not CRON_PATTERN.match(cron["cron"]):
        raise HTTPException(400, "invalid cron")
    c.db.save_notebook_cron(notebook_id, cron)
    return c.db.get_notebook_cron(notebook_id, cron_id)


@router.delete("/{notebook_id}/crons/{cron_id}")
async def delete_cron(notebook_id: int, cron_id: str, user_id: int = Depends(current_user_id)):
    owned_notebook_meta(notebook_id, user_id)
    if not c.db.delete_notebook_cron(notebook_id, valid_doc_id(cron_id)):
        raise HTTPException(404, "cron job not found")
    return {"cron_id": cron_id}


@router.post("/{notebook_id}/crons/log")
async def add_cron_log(notebook_id: int, payload: CronLogModel, user_id: int = Depends(current_user_id)):
    owned_notebook_meta(notebook_id, user_id)
    c.db.add_notebook_cron_log(
        notebook_id, valid_doc_id(payload.cron_id), payload.at, payload.ok, payload.message,
        payload.executor_name, MAX_CRON_LOG,
    )
    return {"ok": True}
