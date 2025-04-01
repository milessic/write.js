import json
from utils.docs.models import PortfolioUpdateModel

class PortfolioDocument:
    def __init__(self, doc_id:str|int, doc_data:dict): 
        self.doc_id:int = int(float(doc_id))
        self.share:int = int(float(doc_data["share"]))
        self.dir:str = doc_data["dir"]
        self.name:str = doc_data["name"]
        self.created_at:str = doc_data["created_at"]
        self.versions:list = doc_data["versions"]

    @property
    def doc_content(self) -> dict:
        return {
                    "share": self.share,
                    "dir": self.dir,
                    "name": self.name,
                    "created_at": self.created_at,
                    "versions": self.versions,
                }


class Portfolio:
    def __init__(self, obj:dict):
        self.docs = {PortfolioDocument(k,v) for k,v in obj.items()}

    def is_doc_exists(self, doc_id:int) -> bool:
        for d in self.docs:
            if d.doc_id == doc_id:
                return True
        return False

    def return_as_json(self):
        dict_data = {d.doc_id:d.doc_content for d in self.docs}
        return json.dumps(dict_data)

    def add_new_document(self, update_obj:PortfolioUpdateModel):
        self.docs.add(
                PortfolioDocument(
                    update_obj.doc_id,
                    {
                        "share": update_obj.share,
                        "dir": update_obj.dir,
                        "name": update_obj.name,
                        "created_at": update_obj.created_at,
                        "versions": update_obj.version,
                    }
                    )
                )

    def update_document(self, update_obj:PortfolioUpdateModel):
        for d in self.docs:
            if d.doc_id == update_obj.doc_id:
                if (v:=update_obj.__dict__.get("share")):
                    d.share = v
                if (v:=update_obj.__dict__.get("dir")):
                    d.dir = v
                if (v:=update_obj.__dict__.get("name")):
                    d.name= v
                d.versions.append(update_obj.version)
                return


