
import json
from utils.docs.models import PortfolioUpdateModel
from utils.controller import controller as c

class Document:
    def __init__(self, doc_id:str|None=None):
        self.doc_id = doc_id
    
    def create(self, doc_name:str, share_type_id:int, dir:str, content, user_id):
        c.db.create_document(
                doc_name=doc_name,
                share_type_id=share_type_id,
                user_id=user_id,
                content=content,
                dir=dir
                )

    def get_compressed_content(self) -> str:
        self._validate_doc_id('get_content')
        raise NotImplementedError

    def get_decompressed_content(self) -> str:
        self._validate_doc_id('get_content')
        raise NotImplementedError

    def update(self, *, content=None, doc_name=None, share_type_id=None, dir=None):
        self._validate_doc_id("update")
        c.db.update_document(self.doc_id, share_type_id=share_type_id, doc_name=doc_name,content=content, dir=dir)

    def _validate_doc_id(self, msg):
        if self.doc_id is None:
            raise AssertionError("This action is not allowed when doc_id is None! " + msg)



