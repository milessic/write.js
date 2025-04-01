from pydantic import BaseModel
from typing import Optional


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
