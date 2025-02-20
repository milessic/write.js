from pydantic import BaseModel
from typing import Optional

class RegisterModel(BaseModel):
    username: str
    email: str
    password: str

class LoginModel(BaseModel):
    login: str
    password: str

class UserInDb(BaseModel):
    username: str
    email: str

class Token(BaseModel):
    access_token: str
    token_type: str

class TokenData(BaseModel):
    username: Optional[str] = None

class UpdatePasswordModel(BaseModel):
    old_password: str
    new_password: str

class ForgotPasswordModel(BaseModel):
    login: str

class DeleteUserModel(BaseModel):
    old_password: str
    are_you_sure: bool

