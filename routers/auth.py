from typing import Annotated
from fastapi.responses import RedirectResponse

from fastapi import (
    Depends,
    HTTPException,
    status,
    Form,
    Response,
    APIRouter,
    Request,
    status,
)
from fastapi.security import OAuth2PasswordRequestForm
from utils.auth.models import (
    RegisterModel,
    UpdatePasswordModel,
    ForgotPasswordModel,
    DeleteUserModel,
)
from utils.auth.utils import *
from utils.auth.validators import *
from utils.controller import controller as c
from utils.auth.exceptions import *

from utils.templates.mailing import render_mail

from utils.mailing.mailing import send_mail
from utils.localizations.localizations import localizations


router = APIRouter()


@router.post("/register")
async def register(request: Request, register_model: RegisterModel):
    data_as_dict = json_to_dict(register_model)
    username = data_as_dict.get("username")
    password = data_as_dict.get("password")
    email = data_as_dict.get("email")
    errors = []
    # username
    if err := validate_username(username, c.db):
        errors.append(generate_username_response(err, request))
    # email
    if err := validate_email(email, c.db):
        print("errors", errors)
        errors.append(generate_email_response(err, request))
    # password
    if err := validate_password(password):
        errors.append(generate_password_response(err, request))
    print(errors)
    if len(errors):
        raise HTTPException(status_code=400, detail=errors)
    # hash password
    data_as_dict["password"] = hash_password(password)
    c.db.create_user(
        data_as_dict
    )  # FIXME it doens't check if mail and username is unique, ``errors`` are empty :'(

    return {"message": "registered"}


@router.get("/user/logout")
async def logout(request: Request, response: Response):
    response = RedirectResponse("/?logout=1", status_code=status.HTTP_303_SEE_OTHER)
    response.delete_cookie(key="access_token")
    token = request.cookies.get("access_token")
    response.delete_cookie(key="access_token")
    if token is not None:
        if user_id := c.db.get_user_id_from_username(
            decode_token(token).get("sub", "")
        ):
            c.db.set_access_token_as_inactive_for_user(user_id, token)
    return response


@router.get("/user/logout/all")
async def logout_from_all(request: Request, response: Response):
    response = RedirectResponse("/?logout=all", status_code=status.HTTP_303_SEE_OTHER)
    response.delete_cookie(key="access_token")
    token = request.cookies.get("access_token")
    response.delete_cookie(key="access_token")
    if token is not None:
        if user_id := c.db.get_user_id_from_username(
            decode_token(token).get("sub", "")
        ):
            c.db.kill_all_access_tokens_for_user(user_id)
    return response


@router.post("/token")
async def login(
    request: Request, form_data: Annotated[OAuth2PasswordRequestForm, Depends()]
):
    # validate inputs
    errors = []
    user_data = c.db.get_user_data(form_data.username)
    if user_data is None:
        raise InvalidUsernameOrEmail(request)
    user_id = user_data[3]
    username = user_data[0]

    # check if user can login
    check_if_user_can_login(user_id=user_id)  # raises exception if they cannot login

    # check if password is correct
    if not unhash_password(form_data.password, user_data[2]):
        # add new failed attempt
        c.db.create_failed_login_record(
            user_id=user_id,
            expires=get_epoch_now(minutes=c.FORGOTTEN_PASSWORD_EXPIRES_MINUTES),
        )
        raise InvalidPassword()

    # reset failed attempts
    c.db.reset_failed_login_attempts(user_id=user_id)
    # generate bearer
    access_token = generate_access_token(username, request)
    refresh_token = generate_refresh_token(username, request)
    return {"access_token": access_token, "refresh_token": refresh_token}


@router.post("/token/refresh")
async def get_refresh_token_api(
    request: Request,
    response: Response,
    payload: dict = Depends(get_access_token_or_return_to_homepage),
):
    if payload.get("return_to_homepage"):
        return RedirectResponse("/", status.HTTP_303_SEE_OTHER)
    login = payload.get("sub")
    user_id = c.db.get_user_id_from_username(login)

    if login is not None and user_id is not None:
        # generate new tokens
        access_token = generate_access_token(login, request)
        access_token_expires = get_epoch_now(minutes=c.ACCESS_TOKEN_EXPIRES_MINUTES)

        refresh_token = generate_refresh_token(login, request)
        refresh_token_expires = get_epoch_now(minutes=c.REFRESH_TOKEN_EXPIRES_MINUTES)

        # invalidate old tokens
        old_access_token = request.cookies.get("access_token")
        old_refresh_token = request.cookies.get("refresh_token")

        if old_access_token:
            c.db.set_access_token_as_inactive_for_user(user_id, old_access_token)
        if old_refresh_token:
            c.db.set_access_token_as_inactive_for_user(user_id, old_refresh_token)

        # set new tokens
        # TODO make this a function
        access_cookie_expires = c.ACCESS_TOKEN_EXPIRES_MINUTES * 60
        refresh_cookie_expires = c.REFRESH_TOKEN_EXPIRES_MINUTES * 60
        response.set_cookie(
            key="access_token",
            value=access_token,
            httponly=True,
            max_age=access_cookie_expires,
            expires=access_cookie_expires,
        )
        response.set_cookie(
            key="refresh_token",
            value=refresh_token,
            httponly=True,
            max_age=refresh_cookie_expires,
            expires=refresh_cookie_expires,
        )
        return {
            "access_token": access_token,
            "refresh_token": refresh_token,
            "access_token_expires": access_token_expires,
            "refresh_token_expires": refresh_token_expires,
        }
    return RedirectResponse("/?logout=1", 303)


@router.get("/me")
async def get_my_details(request: Request, payload: dict = Depends(get_access_token)):
    login = payload.get("sub")
    if login is None:
        raise HTTPException(500, "Could not proceed credentials")
    user = c.db.get_user_data(login)
    if user is None:
        raise HTTPException(
            500,
            {
                "msg": c.locales.get_with_request(
                    "txt_error_user_not_found_500", request
                )
            },
        )
    return {"username": user[0], "email": user[1]}


@router.post("/login/submit", include_in_schema=False)
async def submit_login_form(
    request: Request,
    response: Response,
    username: str = Form(),
    password: str = Form(),
):
    # perform login
    login_form = OAuth2PasswordRequestForm(username=username, password=password)
    try:
        login_resp = await login(request, login_form)

    # Handle login errors
    except InvalidUsernameOrEmail:
        return RedirectResponse(
            "/?status=failure&message=invaliduseroremail",
            status_code=status.HTTP_303_SEE_OTHER,
        )
    except InvalidPassword:
        return RedirectResponse(
            f"/?status=failure&message=invalidpassword&login={username}",
            status_code=status.HTTP_303_SEE_OTHER,
        )
    except UserIsBlocked:
        return RedirectResponse(
            f"/?status=failure&message=userisblocked&login={username}",
            status_code=status.HTTP_303_SEE_OTHER,
        )
    except Exception as err:
        print(str(err))
        return RedirectResponse(
            f"/?status=unknownfailure",
            status_code=status.HTTP_303_SEE_OTHER,
        )

    # authenticate user and return homepage
    access_token = login_resp.get("access_token")
    refresh_token = login_resp.get("refresh_token")
    if access_token and refresh_token:
        response = RedirectResponse(
            "/?msg=loginsuccess",
            status_code=status.HTTP_303_SEE_OTHER,
        )
        # TODO make this a function
        access_cookie_expires = c.ACCESS_TOKEN_EXPIRES_MINUTES * 60
        refresh_cookie_expires = c.REFRESH_TOKEN_EXPIRES_MINUTES * 60
        response.set_cookie(
            key="access_token",
            value=access_token,
            httponly=True,
            max_age=access_cookie_expires,
            expires=access_cookie_expires,
        )
        response.set_cookie(
            key="refresh_token",
            value=refresh_token,
            httponly=True,
            max_age=refresh_cookie_expires,
            expires=refresh_cookie_expires,
        )
    else:
        return {"msg", "ERROR"}
    return response


@router.post("/register/submit", include_in_schema=False)
async def submit_register_form(
    username: str = Form(),
    email: str = Form(),
    password: str = Form(),
):
    register_model = RegisterModel(
        **{"username": username, "email": email, "password": password}
    )
    try:
        register_response = await register(register_model)
    except Exception as e:
        print("ERR on submit" + str(type(e)) + str(e))
        errors = ""
        if "Username" in str(e):
            errors += "username=alreadytaken&"
        if "Email" in str(e):
            errors += "email=alreadytaken&"
        if "Password" in str(e):
            errors += "password=invalid"
        if errors:
            errors = errors.removesuffix("&")
            return RedirectResponse(
                f"/register?status=failure&{errors}",
                status_code=status.HTTP_303_SEE_OTHER,
            )
        return RedirectResponse(
            f"/register?status=unknownfailure", status_code=status.HTTP_303_SEE_OTHER
        )
    if register_response.get("message") == "registered":
        return RedirectResponse(
            f"/?status=success&username={username}",
            status_code=status.HTTP_303_SEE_OTHER,
        )


@router.get("/logout", include_in_schema=False)
async def ui_logout(request: Request, response: Response):
    response = RedirectResponse("/", status_code=status.HTTP_303_SEE_OTHER)
    token = request.cookies.get("access_token")
    response.delete_cookie(key="access_token")
    response.delete_cookie(key="refresh_token")
    if token is not None:
        if user_id := c.db.get_user_id_from_username(
            decode_token(token).get("sub", "")
        ):
            c.db.set_access_token_as_inactive_for_user(user_id, token)
    return response


@router.get("/token")
async def get_token_expiry_date(request: Request):
    token_data = decode_token(request.cookies.get("access_token"))
    return {"access_token_expires": token_data.get("exp")}


@router.post("/user/password/update")
async def update_password(
    request: Request,
    payload: UpdatePasswordModel,
    token_data: dict = Depends(get_access_token),
):
    # verify login and get user_id
    if (
        (login := token_data.get("sub")) is not None
        and (user_data := c.db.get_user_data(login)) is not None
        and (new_password := json_to_dict(payload).get("new_password")) is not None
        and (old_password := json_to_dict(payload).get("old_password")) is not None
    ):
        # validate old password
        old_password_from_db = user_data[2]
        if not (unhash_password(old_password, old_password_from_db)):
            raise HTTPException(
                401,
                c.locales.get_with_request("txt_error_cannot_change_password", request),
            )
        # validate new password
        if errors := validate_password(new_password):
            raise HTTPException(400, generate_password_response(errors, request))
        # update password
        user_id = user_data[3]
        c.db.update_user_password(user_id, hash_password(new_password))
        return {"msg": c.locales.get_with_request("txt_password_changed", request)}
    raise HTTPException(
        400, c.locales.get_with_request("txt_password_changed", request)
    )


@router.get("/user/password/reset/{user_id}/{guid}")
async def reset_password(user_id: int, guid: str, request: Request):
    # check if guid exsits in db and is active
    if not c.db.check_if_guid_is_valuable_and_not_expired_for_password_reset(
        guid, get_epoch_now(), user_id
    ):
        return RedirectResponse("/?status=failure&message=forgotpassworderror", 303)
    # generate new password
    new_password = generate_random_password()
    hashed_password = hash_password(new_password)

    # set new password in database
    c.db.update_user_password(user_id, hashed_password)

    # deactivate all guids for password reset
    c.db.deactivate_forgotten_password_records_for_user(user_id)

    # return login page with new password as query to make frontend handle this
    return RedirectResponse(f"/?newpassword={new_password}", 303)


@router.post("/forgot-password")
async def forgot_password_api(request: Request, payload: ForgotPasswordModel):
    # get user data
    payload_dict = json_to_dict(payload)
    if (login := payload_dict.get("login")) is None:
        raise HTTPException(
            400,
            c.locales.get_with_request(
                "txt_error_username_or_email_has_to_be_provided", request
            ),
        )
    user_data = c.db.get_user_data(login)
    if user_data is None:
        raise HTTPException(
            404,
            c.locales.get_with_request(
                "txt_error_user_has_not_been_found", request
            ).format(login),
        )
    user_id = user_data[3]
    user_email = user_data[1]
    user_username = user_data[0]

    # generate forgotten password record
    guid = generate_guid()
    expires = get_epoch_now(minutes=c.FORGOTTEN_PASSWORD_EXPIRES_MINUTES)
    c.db.create_forgotten_password_record(guid, expires, user_id)

    # render mail contents
    reset_link = f"{c.HOST}/api/auth/user/password/reset/{user_id}/{guid}"
    translations = c.locales.get_all_from_lang_with_request(request)
    content = render_mail(
        "forgot_password.html",
        {
            "username": user_username,
            "user_id": user_id,
            "reset_link": reset_link,
            **translations,
        },
    )

    # Send mail
    # TODO add to queue instead of sending mail from here
    await send_mail("Write.JS - Forgot Password", user_email, content)

    # kill all user's sesions
    c.db.kill_all_access_tokens_for_user(user_id)

    return {"msg": c.locales.get_with_request("txt_mail_sent", request)}


@router.post("/delete", status_code=204)
async def delete_user(
    response: Response,
    request: Request,
    payload: DeleteUserModel,
    token_data: dict = Depends(get_access_token),
):
    data = json_to_dict(payload)
    user_data = c.db.get_user_data(token_data.get("sub"))
    is_user_sure = data.get("are_you_sure")
    if user_data is None:
        raise HTTPException(
            400,
            c.locales.get_with_request(
                "txt_errors_user_delete_cannot_read_user_data", request
            ),
        )
    username, password, user_id = user_data[0], user_data[2], user_data[3]

    if is_user_sure and unhash_password(data.get("old_password"), password):
        # delete user
        c.db.delete_user(username, user_id)
        # delete notebooks and all other things
        c.db.delete_user_content(user_id)
        response.delete_cookie("refresh_token")
        response.delete_cookie("access_token")
        return {"detail": "deleted"}

    if not is_user_sure:
        raise HTTPException(
            400,
            c.locales.get_with_request(
                "txt_errors_user_delete_user_is_not_sure", request
            ),
        )
    raise HTTPException(
        400,
        c.locales.get_with_request("txt_errors_user_delete_wrong_password", request),
    )


# TODO implement 2FA
