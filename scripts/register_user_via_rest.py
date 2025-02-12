try:
    from requests import get, post, Response
except ImportError:
    print("Install 'requests' first! pip -m install requests")
try:
    from getpass import getpass
    def password_input(msg):
        return getpass(msg)
except ImportError:
    getpass_not_working = input("Do you agree to use visible password input? [Y]es / [N]o\n> ")
    if getpass_not_working.lower().startswith('y'):
        def password_input(msg):
            return input(msg)
    else:
        print("Then first import getpass! pip -m install getpass")
try:
    import readline
except:
    pass

default_url = "http://localhost:8990"
register_endpoint = "/api/auth/register"
token_endpoint = "/api/auth/token"
user_info_endpoint = "/api/auth/me"

url = input(f"insert url (default - press ENTER - '{default_url}'\n> ")
if not url:
    url = default_url
username = input("username:\n> ")
email = input("email:\n> ")
password = password_input("password:\n> ")

# register user
resp_register = post(url + register_endpoint, json={"username": username, "email":email, "password":password})
print("=== REGISTER RESPONSE no auth- should be 401")
print(f"status: {resp_register.status_code}")
print(f"response:")
print(resp_register.json())


if (resp_register.status_code == 200):
    # login, get token
    resp_login = post(url + token_endpoint, data={"username": username, "password":password})
    print("=== TOKEN RESPONSE")
    print(f"status: {resp_login.status_code}")
    print("response:")
    print(resp_login.json())

    # user info
    resp_info = get(url + user_info_endpoint)
    print("=== USER INFO RESPONSE")
    print(f"status: {resp_info.status_code}")
    print("response:")
    print(resp_info.json())

    print("\n")
    resp_info2 = get(url + user_info_endpoint, headers={"Bearer": resp_login.json().get("access_token")} )
    print("=== USER INFO RESPONSE with auth- should be 200")
    print(f"status: {resp_info2.status_code}")
    print(f"response:")
    print(resp_info2.json())



