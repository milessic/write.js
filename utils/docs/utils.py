import json
from fastapi import HTTPException
from utils.docs.portfolio import Portfolio
from utils.controller import controller as c

def parse_portfolio_object(obj:str) -> Portfolio:
    try:
        return Portfolio(json.loads(obj))
    except:
        raise HTTPException(500, "Cannot parse portfolio object!")

def update_portfolio_via_user_id(user_id) -> Portfolio:
    docs = c.db.get_documents_info_for_portfolio(user_id)
    print(docs)
    obj = {}
    for d in docs:
        obj[d[0]] = {
                "share": d[1],
                "dir": d[2],
                "name": d[3],
                "created_at": d[4]
                }
    portfolio = Portfolio(obj, user_id)
    portfolio.save()
    return portfolio



