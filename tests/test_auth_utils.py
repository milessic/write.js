import pytest
from time import time
from utils.auth.utils import *
from utils.controller import Controller
from pydantic import BaseModel

class MockController:
    def __init__(self):
        self.SECRET_KEY = "qwerty"
        self.ALGORITHM = "HS256"
        self.ACCESS_TOKEN_EXPIRES_MINUTES = 15
        self.REFRESH_TOKEN_EXPIRES_MINUTES = 3700
        self.db = MockDbClient()

class MockDbClient:
    def get_user_id_from_username(self, username):
        return 1

    def create_access_token_record(self, access_token, user_id, expires):
        return None

    def create_refresh_token_record(self, refresh_token, user_id, expires):
        return None

class Model(BaseModel):
    login: str
    number: int


class Obj:
    def __init__(self, content):
        self.content = content

    def json(self):
        return self.content

@pytest.fixture
def controller():
    c = Controller()
    db = MockDbClient()
    c.db = db
    return c

def test_hash_password():
    password = "securePassword123"
    hashed = hash_password(password)
    print(hashed)
    assert isinstance(hashed, bytes)
    assert len(hashed) > 30

def test_hash_unhash_password():
    password = "securePassword123"
    hashed = hash_password(password)
    assert isinstance(hashed, bytes)
    assert unhash_password(password, hashed)

def test_json_to_dict():
    assert json_to_dict("""{"\\u0142\\u0105ka": 1}""") == {"łąka": 1}
    assert json_to_dict("""{"chrząśżść":true,"isPies":1,"kamehameha":null}""") == {"chrząśżść":True,"isPies":1,"kamehameha":None}
    assert json_to_dict("""{"items":[[1,2,3],\n[2,3,4,null]]}""") == {"items":[[1,2,3], [2,3,4,None]]}
    assert json_to_dict(Model(login="hello!", number=123)) == {"login": "hello!", "number":123}

def test_generate_jwt_access_token(controller):
    token = generate_access_token("test", controller)
    time_now = int(time())
    expected_expires = time_now + controller.ACCESS_TOKEN_EXPIRES_MINUTES * 60
    assert isinstance(token, str)
    assert decode_token(token, controller).get("sub") == "test"
    assert expected_expires - 10 <= decode_token(token, controller).get("exp") <= expected_expires + 10

def test_generate_and_decode_jwt_refresh_token(controller):
    token = generate_refresh_token("test", controller)
    time_now = int(time())
    expected_expires = time_now + controller.REFRESH_TOKEN_EXPIRES_MINUTES* 60
    assert isinstance(token, str)
    assert decode_token(token, controller).get("sub") == "test"
    assert expected_expires - 10 <= decode_token(token, controller).get("exp") <= expected_expires + 10

def test_verify_access_token_expired_token(controller):
    token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJSZWdpc3RlclJlZ2lzdGVyIiwiZXhwIjoxNzM4NjY3OTQyfQ.S-c9bd58VFyZr_OX1_xHo8A-Lm3RzvgVfLP3y1qDvjg"
    try:
        verify_access_token(token, None, controller) 
        assert False
    except (jwt.exceptions.ExpiredSignatureError , HTTPException):
        assert True
    
