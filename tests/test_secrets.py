import random
import string
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)

prefix = "/api/secrets"
password = "ValidPass123!"


def login(test_client, username):
    test_client.post("/api/auth/register", json={"username": username, "password": password, "email": username + "@test.com"})
    token = test_client.post(
        "/api/auth/token",
        data={"username": username, "password": password},
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    ).json()["access_token"]
    test_client.headers["Authorization"] = f"Bearer {token}"


username = "".join(random.choice(string.ascii_lowercase) for _ in range(9))


def setup_module():
    login(client, username)


def names_and_values(test_client=client):
    return [(s["name"], s["value"]) for s in test_client.get(prefix).json()["secrets"]]


def test_requires_login():
    assert TestClient(app).get(prefix).status_code == 401
    assert TestClient(app).put(f"{prefix}/API_KEY", json={"value": "x"}).status_code == 401


def test_secret_lifecycle():
    assert names_and_values() == []
    assert client.put(f"{prefix}/API_KEY", json={"value": "abc"}).json() == {"name": "API_KEY"}
    assert client.put(f"{prefix}/OTHER", json={"value": ""}).status_code == 200
    assert names_and_values() == [("API_KEY", "abc"), ("OTHER", "")]
    # the value can be updated
    client.put(f"{prefix}/API_KEY", json={"value": "new"})
    assert names_and_values() == [("API_KEY", "new"), ("OTHER", "")]
    # and the secret deleted
    assert client.delete(f"{prefix}/API_KEY").status_code == 200
    assert client.delete(f"{prefix}/API_KEY").status_code == 404
    assert names_and_values() == [("OTHER", "")]
    client.delete(f"{prefix}/OTHER")


def test_invalid_names_and_values():
    for name in ["1abc", "with-dash", "a" * 65, "sp%20ace"]:
        assert client.put(f"{prefix}/{name}", json={"value": "x"}).status_code == 400, name
    assert client.put(f"{prefix}/OK", json={}).status_code == 422
    from routers.secrets import MAX_SECRET_LENGTH
    assert client.put(f"{prefix}/OK", json={"value": "x" * (MAX_SECRET_LENGTH + 1)}).status_code == 422


def test_secrets_are_per_account():
    client.put(f"{prefix}/MINE", json={"value": "secret"})
    other = TestClient(app)
    login(other, username + "sec")
    assert names_and_values(other) == []
    assert other.delete(f"{prefix}/MINE").status_code == 404
    assert names_and_values() == [("MINE", "secret")]
    client.delete(f"{prefix}/MINE")
