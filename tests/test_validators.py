import pytest
from utils.auth.validators import validate_username, validate_password, validate_email
from utils.db.db_clients import DbClient

class MockDbClient:
    def check_if_username_exists(self, username):
        return username == "existing_user"

    def check_if_email_exists(self, email):
        return email == "taken@example.com"

@pytest.fixture
def db_client():
    return MockDbClient()

def test_validate_username(db_client):
    assert validate_username("new_user", db_client) == ""
    assert validate_username("existing_user", db_client) == "a"
    assert validate_username("invalid@user", db_client) == "s"

def test_validate_password():
    assert validate_password("a5" * 2) == "q"  # Too short
    assert validate_password("a1!" * 11) == "w"  # Too long
    assert validate_password("validPass123") == ""

def test_validate_email(db_client):
    assert validate_email("valid@example.com", db_client) == ""
    assert validate_email("taken@example.com", db_client) == "z"
    assert validate_email("invalid-email", db_client) == "x"

