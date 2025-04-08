from pydantic import BaseModel
from typing import Optional

class DocumentCreateModel(BaseModel):
    doc_name: str
    dir: str
    share_type_id: int
    content: str

class DocumentUpdateModel(BaseModel):
    doc_name: Optional[str] = None
    dir : Optional[str] = None
    share_type_id: Optional[str] = None
    content: Optional[str] = None

class DocumentModel(BaseModel):
    r"""For create and update"""
    # documents
    doc_id: int | None
    doc_name: str
    doc_created_at: str
    share_type_id: int

    # revisions
    version_id: int
    content: str
    revision_created_at: str


class PortfolioUpdateModel(BaseModel):
    doc_id: int
    share: Optional[int] = None
    created_at: Optional[str] = None
    dir: Optional[str] = None
    name: Optional[str] = None
    version: str

if __name__ == "__main__":
    p = PortfolioUpdateModel(doc_id=123, share=2, version="123")
    print(p.__dict__.get("version"))
