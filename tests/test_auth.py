import random
import json
import string
from fastapi.testclient import TestClient
from main import app
from utils.auth.utils import decode_token
from utils.controller import Controller, controller
import httpx

client = TestClient(app)

auth_prefix = "/api/auth/"

def generate_username(how_long:int=7):
    return ''.join(random.choice(string.ascii_lowercase) for _ in range(how_long))

c = Controller()

username = generate_username()
email = username + "@test.com"
username2 = username + "us2"
email2 = username2 + "@test.com"
username3 = username + "us3"
email3 = username3 + "@test.com"
valid_password = "ValidPass123!"

invalid_token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0IiwiZXhwIjoxNzM4OTE4OTM4fQ.FLFAIzpZSqUJOrEljLWnGBcnunpMU5CTf37Niw7OrrM"
valid_token = ""

def register_user(username, password, email) -> httpx.Response:
    return client.post(auth_prefix + "register", json={
        "username": username,
        "password": password,
        "email": email
    })

def login_user(login, password) -> httpx.Response:
    return client.post(auth_prefix + "token", data={
            "username": login,
            "password":password 
        },
            headers={"Content-Type":"application/x-www-form-urlencoded"}
        )

# register
def test_register():
    response = register_user(username, valid_password, email)
    assert response.status_code == 200
    assert response.json() == {"message": "registered"}

def test_register_with_existing_username_but_in_other_lettercase():
    response = client.post(auth_prefix + "register", json={
        "username": username.lower(),
        "password": valid_password,
        "email": "w" + email
    })
    assert response.status_code == 400

def test_register_with_existing_email_but_in_other_lettercase():
    response = client.post(auth_prefix + "register", json={
        "username": "wwe"+username.lower(),
        "password": valid_password,
        "email": email.upper()
    })
    assert response.status_code == 400

def test_register_with_existing_username():
    response = client.post(auth_prefix +"register", json={
        "username": username,
        "password": valid_password,
        "email": "q"+email
    })
    assert response.status_code == 400

def test_register_with_existing_email():
    response = client.post(auth_prefix +"register", json={
        "username": "q"+username,
        "password": valid_password,
        "email": email
    })
    assert response.status_code == 400

def test_register_with_too_short_password():
    response = client.post(auth_prefix +"register", json={
        "username": "qw"+username,
        "password": "abc1!",
        "email": "qw"+email
    })
    assert response.status_code == 400

# login
def test_login_with_username_success():
    global valid_token
    response = login_user(username, valid_password)
    resp_json = json.loads(response.text)
    assert "access_token" in resp_json
    assert decode_token(resp_json.get("access_token")).get("sub") == username
    valid_token = resp_json.get("access_token")


def test_email_with_username_success():
    response = client.post(auth_prefix + "register", json={
        "username": username2,
        "password": valid_password,
        "email": email2
    })
    assert response.status_code == 200
    assert response.json() == {"message": "registered"}
    response = client.post(auth_prefix + "token", data={
            "username": email2,
            "password": valid_password
        },
                           headers={"Content-Type":"application/x-www-form-urlencoded"}

                           )
    resp_json = json.loads(response.text)
    assert "access_token" in resp_json
    assert decode_token(resp_json.get("access_token")).get("sub") == username2

def test_tokens_generated_too_quickly():
    response = client.post(auth_prefix + "register", json={
        "username": username3,
        "password": valid_password,
        "email": email3
    })
    assert response.status_code == 200
    assert response.json() == {"message": "registered"}
    result = False
    for i in range(3):
        response = client.post(auth_prefix + "token", data={
                "username": email3,
                "password": valid_password
            },
                               headers={"Content-Type":"application/x-www-form-urlencoded"}

                               )
        resp_json = json.loads(response.text)
        if i == 0:
            assert response.status_code == 200
            assert "access_token" in resp_json
            assert decode_token(resp_json.get("access_token")).get("sub") == username3
            continue
        if response.status_code == 200:
            continue
        assert response.status_code == 400
        assert resp_json.get("detail") == "Access Token already exists! You may be generating it too fast!"
        result = True
        break
    assert result

# endpoint with auth
def test_check_endpoint_with_auth_via_cookie():
    response = client.post(auth_prefix + "token", data={
            "username": username,
            "password": valid_password
        },
            headers={"Content-Type":"application/x-www-form-urlencoded"}
        )
    resp_json = json.loads(response.text)
    assert "access_token" in resp_json
    access_token = resp_json.get("access_token")
    assert decode_token(access_token).get("sub") == username

    # check /auth/me - 200
    resp_auth_me = client.get(auth_prefix + "me", cookies={"access_token":access_token})
    assert resp_auth_me.status_code == 200

    # check /auth/me - 401
    resp_auth_me = client.get(auth_prefix + "me")
    assert resp_auth_me.status_code == 401



# password reset
def test_reset_password_new_password_is_too_short():
    # reset password
    resp_reset_password = client.post(auth_prefix + "user/password/update", json={
            "old_password": valid_password,
            "new_password": "abcd"
        },
            headers={"Content-Type":"application/json"},
            cookies={"access_token": valid_token}
        )

    assert resp_reset_password.status_code == 400
    assert json.loads(json.loads(resp_reset_password.text).get("detail"))[0] == c.locales.get_with_request("txt_errors_password_too_short", None).format(c.PASSWORD_MIN_LEN)

def test_reset_password_old_password_is_not_correct():
    # reset password
    resp_reset_password = client.post(auth_prefix + "user/password/update", json={
            "old_password": "abcdef",
            "new_password": "abcddsadasd"
        },
            headers={"Content-Type":"application/json"},
            cookies={"access_token": valid_token}
        )

    assert resp_reset_password.status_code == 401
    assert json.loads(resp_reset_password.text).get("detail").startswith("Cannot change password!")
def test_reset_password_invalid_token():
    resp_reset_password = client.post(auth_prefix + "user/password/update", json={
            "old_password": valid_password,
            "new_password": "abcd123123"
        },
            headers={"Content-Type":"application/json"},
            cookies={"access_token": invalid_token}
        )
    assert resp_reset_password.status_code == 401
    assert json.loads(resp_reset_password.text).get('detail') == "Invalid or expired token"
def test_reset_password_200():
    global valid_password
    # reset password
    new_password = "qwerty123"
    resp_reset_password = client.post(auth_prefix + "user/password/update", json={
            "old_password": valid_password,
            "new_password": new_password
        },
            headers={"Content-Type":"application/json"},
            cookies={"access_token": valid_token}
        )

    assert resp_reset_password.status_code == 200
    assert json.loads(resp_reset_password.text).get("msg") == controller.locales.get_with_request("txt_password_changed", None)
    valid_password = new_password

# Failed attempts
def test_user_cannot_login_after_n_failed_attempts():
    # create user
    username = generate_username()
    resp_create_user = register_user(
            username=username,
            password=valid_password,
            email = f"{username}@text.com"
            )
    assert resp_create_user.status_code == 200

    # login n times with wrong password
    max_iterations = c.MAX_LOGIN_ATTEMPTS
    for i in range(max_iterations):
        resp = login_user(username, "abdef123")
        if i != max_iterations :
            assert resp.status_code == 401
            continue
        # expect proper exception
        assert resp.status_code == 400

def test_failed_login_attempts_counter_resets_after_successfull_login():
    # create user
    username = generate_username()
    resp_create_user = register_user(
            username=username,
            password=valid_password,
            email = f"{username}@text.com"
            )
    assert resp_create_user.status_code == 200

    # login n times with wrong password
    max_iterations = c.MAX_LOGIN_ATTEMPTS - 1
    for _ in range(2):
        for i in range(max_iterations):
            resp = login_user(username, "abdef123")
            assert resp.status_code == 401
        login_user(username, valid_password)

# test delete user
def test_delete_user_is_not_deleted_if_wrong_password_is_provided():
    # create user
    username = generate_username()
    resp_create_user = register_user(
            username=username,
            password=valid_password,
            email = f"{username}@test.com"
            )
    assert resp_create_user.status_code == 200

    # get token
    token_resp = login_user(username, valid_password)
    assert token_resp.status_code == 200
    
    # try to delete user
    delete_resp = client.post(auth_prefix + "delete", json={
        "old_password": valid_password + "abc",
        "are_you_sure": True
        },
        headers={"Content-Type":"application/json"},
        cookies={"access_token": valid_token}
        )
    assert delete_resp.status_code == 400
    assert delete_resp.text == "{" + f'''"detail":"{c.locales.get_with_request("txt_errors_user_delete_wrong_password", None)}"''' + "}"

def test_delete_user_is_not_deleted_if_user_is_not_sure():
    # create user
    username = generate_username()
    resp_create_user = register_user(
            username=username,
            password=valid_password,
            email = f"{username}@test.com"
            )
    assert resp_create_user.status_code == 200

    # get token
    token_resp = login_user(username, valid_password)
    assert token_resp.status_code == 200
    
    # try to delete user
    delete_resp = client.post(auth_prefix + "delete", json={
        "old_password": valid_password,
        "are_you_sure": False
        },
        headers={"Content-Type":"application/json"},
        cookies={"access_token": valid_token}
        )
    assert delete_resp.status_code == 400
    assert delete_resp.text == "{" + f'''"detail":"{c.locales.get_with_request("txt_errors_user_delete_user_is_not_sure", None)}"''' + "}"

def test_delete_user_401_if_token_not_provided():
    # create user
    username = generate_username()
    resp_create_user = register_user(
            username=username,
            password=valid_password,
            email = f"{username}@test.com"
            )
    assert resp_create_user.status_code == 200

    
    # try to delete user
    delete_resp = client.post(auth_prefix + "delete", json={
        "old_password": valid_password,
        "are_you_sure": False
        },
        headers={"Content-Type":"application/json"},
        )
    assert delete_resp.status_code == 401
    assert delete_resp.text == "{" + f'''"detail":"{c.locales.get_with_request("txt_error_jwt_token_not_provided", None)}"''' + "}"


def test_delete_user_is_deleted():
    # create user
    username_for_deletion = generate_username()

    
    # try to delete user
    delete_resp = client.post(auth_prefix + "delete", json={
        "old_password": valid_password,
        "are_you_sure": False
        },
        headers={"Content-Type":"application/json"},
        )
    assert delete_resp.status_code == 401
    assert delete_resp.text == "{" + f'''"detail":"{c.locales.get_with_request("txt_error_jwt_token_not_provided", None)}"''' + "}"
    resp_create_user = register_user(
            username=username_for_deletion,
            password=valid_password,
            email = f"{username_for_deletion}@test.com"
            )
    assert resp_create_user.status_code == 200

    # get token
    token_resp = login_user(username_for_deletion, valid_password)
    token_for_deletion = token_resp.json().get("access_token")
    assert token_for_deletion is not None
    assert token_resp.status_code == 200
    
    # delete user
    delete_resp = client.post(auth_prefix + "delete", json={
        "old_password": valid_password,
        "are_you_sure": True
        },
        headers={"Content-Type":"application/json"},
        cookies={"access_token": token_for_deletion}
        )
    assert delete_resp.status_code == 204
    assert delete_resp.text == ''

    token_resp_after_delete = login_user(username_for_deletion, valid_password)
    assert token_resp_after_delete.status_code == 401
    assert token_resp_after_delete.text == "{" + f'''"detail":"{c.locales.get_with_request("txt_error_login_or_email_doesnt_exist", None)}"''' + "}"

