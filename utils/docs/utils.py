import json
from fastapi import HTTPException
from utils.docs.portfolio import Portfolio

def parse_portfolio_object(obj:str) -> Portfolio:
    try:
        return Portfolio(json.loads(obj))
    except:
        raise HTTPException(500, "Cannot parse portfolio object!")



