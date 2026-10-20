import random
import string
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)

prefix = "/api/notebooks"
username = "".join(random.choice(string.ascii_lowercase) for _ in range(9))
password = "ValidPass123!"
doc_id = "0b6c7f5e-1d2a-4c3b-8e9f-a1b2c3d4e5f6"


def setup_module():
    client.post("/api/auth/register", json={"username": username, "password": password, "email": username + "@test.com"})
    token = client.post(
        "/api/auth/token",
        data={"username": username, "password": password},
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    ).json()["access_token"]
    client.headers["Authorization"] = f"Bearer {token}"


def default_notebook_id():
    notebooks = client.get(prefix).json()["notebooks"]
    assert [n["name"] for n in notebooks] == ["Default"]
    return notebooks[0]["notebook_id"]


def test_every_user_has_one_default_notebook():
    first = default_notebook_id()
    assert default_notebook_id() == first


def test_requires_login():
    assert TestClient(app).get(prefix).status_code == 401


def test_new_notebook_is_empty():
    response = client.get(f"{prefix}/{default_notebook_id()}/documents").json()
    assert response["documents"] == []
    assert response["meta_version"] == 0
    assert response["legacy"] is False


def test_document_lifecycle():
    nid = default_notebook_id()
    url = f"{prefix}/{nid}/documents/{doc_id}"
    # create
    response = client.put(url, json={"name": "first", "content": "abc", "base_version": 0})
    assert response.status_code == 200 and response.json()["version"] == 1
    # creating it again is a conflict
    response = client.put(url, json={"name": "first", "content": "xyz", "base_version": 0})
    assert response.status_code == 409 and response.json()["version"] == 1
    # update against the current version
    response = client.put(url, json={"name": "renamed", "content": "abcd", "base_version": 1})
    assert response.json()["version"] == 2
    # a stale version is a conflict and nothing changes
    response = client.put(url, json={"name": "stale", "content": "old", "base_version": 1})
    assert response.status_code == 409 and response.json()["version"] == 2
    document = client.get(url).json()
    assert (document["name"], document["content"], document["version"]) == ("renamed", "abcd", 2)
    # listed without the content
    listed = client.get(f"{prefix}/{nid}/documents").json()["documents"]
    assert listed == [{"doc_id": doc_id, "name": "renamed", "version": 2, "deleted": False, "updated_at": listed[0]["updated_at"]}]
    # fetched in bulk
    fetched = client.post(f"{prefix}/{nid}/documents/fetch", json={"doc_ids": [doc_id, "ffffffff-0000"]}).json()
    assert [d["content"] for d in fetched["documents"]] == ["abcd"]
    # delete against a stale version is a conflict
    assert client.delete(url, params={"base_version": 1}).status_code == 409
    response = client.delete(url, params={"base_version": 2})
    assert response.json()["version"] == 3
    # a tombstone stays, so other devices learn about the delete
    document = client.get(url).json()
    assert document["deleted"] is True and document["content"] is None
    # and the document can come back
    response = client.put(url, json={"name": "back", "content": "q", "base_version": 3})
    assert response.json()["version"] == 4


def test_invalid_document_id():
    nid = default_notebook_id()
    response = client.put(f"{prefix}/{nid}/documents/not%20an%20id", json={"name": "x", "content": "", "base_version": 0})
    assert response.status_code == 400


def test_meta_versions():
    nid = default_notebook_id()
    url = f"{prefix}/{nid}/meta"
    assert client.get(url).json() == {"content": None, "version": 0}
    assert client.put(url, json={"content": "m1", "base_version": 0}).json() == {"version": 1}
    response = client.put(url, json={"content": "m2", "base_version": 0})
    assert response.status_code == 409 and response.json()["version"] == 1
    assert client.get(url).json() == {"content": "m1", "version": 1}


def test_other_users_notebook_is_not_found():
    other = TestClient(app)
    name = username + "other"
    other.post("/api/auth/register", json={"username": name, "password": password, "email": name + "@test.com"})
    token = other.post(
        "/api/auth/token",
        data={"username": name, "password": password},
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    ).json()["access_token"]
    other.headers["Authorization"] = f"Bearer {token}"
    assert other.get(f"{prefix}/{default_notebook_id()}/documents").status_code == 404
    assert other.get(f"{prefix}/{default_notebook_id()}/meta").status_code == 404
