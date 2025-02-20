from fastapi import HTTPException, Request
from utils.localizations.localizations import localizations



class InvalidUsernameOrEmail(HTTPException):
    def __init__(self, request:Request|None=None):
        super().__init__(401, localizations.get_with_request("txt_error_login_or_email_doesnt_exist", request))

class InvalidPassword(HTTPException):
    def __init__(self, request:Request|None=None):
        super().__init__(401, localizations.get_with_request("txt_error_inavlid_password", request))

class UserIsBlocked(HTTPException):
    def __init__(self, request:Request|None=None):
        super().__init__(401, localizations.get_with_request("txt_error_user_is_blocked", request))

