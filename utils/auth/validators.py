import json
import re
from utils.db.db_clients import DbClient
from utils.controller import controller as c
from fastapi import Request

def validate_username(username, db_client:DbClient) -> str:
    r"""returns string with errors
    a - already exists
    s - username contains not-valid character # TODO
    """
    err = ""
    if db_client.check_if_username_exists(username):
        return "a"
    if "@" in username:
        err += "s"
    return err



def validate_password(password) -> str:
    r"""returns string with errors
    q - too short 
    w - too long  
    e - no number   # TODO
    r - no special sign  # TODO
    t - invalid characters  # TODO
    """
    err_str = ""
    if len(password) < c.PASSWORD_MIN_LEN:
        err_str += "q"
    if len(password) > c.PASSWORD_MAX_LEN:
        err_str += "w"
    return err_str

def validate_email(email, db_client) -> str:
    r"""returns string with errors
    z - already exists
    x - email has improper format
    c - something is wrong # TODO
    """
    err = ""
    if db_client.check_if_email_exists(email):
        return "z"
    if not re.match(r"[^@]+@[^@]+\.[^@]+", email):
        err += "x"
    return err

def generate_username_response(errors:str, request:Request):
    if not(errors):
        raise ValueError(c.locales.get_with_request("txt_errors_unexpected_errors", request))
    errors_list = []
    for letter in errors:
        match letter:
            case "a":
                errors_list.append(c.locales.get_with_request("txt_errors_username_is_already_taken", request))
            case "s":
                errors_list.append(c.locales.get_with_request("txt_errors_username_invalid_characters", request))
            case _:
                errors_list.append(c.locales.get_with_request("txt_errors_username_some_other_problem".format(errors), request))
        return errors_list

def generate_password_response(errors:str, request:Request):
    if not(errors):
        raise ValueError(c.locales.get_with_request("txt_errors_unexpected_errors", request))
    errors_list = []
    for letter in str(errors):
        match letter:
            case "q":
                errors_list.append(c.locales.get_with_request("txt_errors_password_too_short", request).format(c.PASSWORD_MIN_LEN))
            case "w":
                errors_list.append(c.locales.get_with_request("txt_errors_password_too_long", request).format(c.PASSWORD_MAX_LEN))
            case _:
                errors_list.append(c.locales.get_with_request("txt_errors_password_some_other_problem".format(errors), request))
        return json.dumps(errors_list)

def generate_email_response(errors:str, request:Request):
    if not(errors):
        raise ValueError(c.locales.get_with_request("txt_errors_unexpected_errors", request))
    errors_list = []
    for letter in errors:
        match letter:
            case "z":
                errors_list.append(c.locales.get_with_request("txt_errors_email_taken", request))
            case "x":
                errors_list.append(c.locales.get_with_request("txt_errors_email_invalid", request))
            case _:
                errors_list.append(c.locales.get_with_request("txt_errors_email_some_other_problem".format(errors), request))
        return errors_list


