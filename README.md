# FastAPI template with working auth
This is a template for [FastAPI](https://fastapi.tiangolo.com/) project with authorization and localizations

### Table of contents
1. About Project
2. Environment Setup
3. Testing

# About project
## Project Structure
```
.
├── routers
├── scripts
├── templates/
│   └── mailing
├── tests
├── ui
└── utils/
    ├── auth
    ├── db
    ├── localizations
    ├── mailing
    └── templates
```

## Authorization
- project uses jwt access tokens + refresh tokens that are also stored in Database


## Localizations
- Translation files are stored as ``json`` files under ``utils/localizations/translations/``
- to create new empty translation file, run ``utils/localizations/generate_new_translation_file.py``
- to test your translation configuration, run test ``tests/test_localizations.py``
- no need to reload server after update on existing ``json`` file, there is an observer that reloads translations when it detects changes in ``*.json`` files under translations directory


# Environment setup
1. install python3
2. create venv
3. install ``requirements.txt``
4. create ``.env`` file:
```
HOST= host, e.g. localhost:8000

SECRET_KEY= secure secret
ALGORITHM=HS256 or any other
ACCESS_TOKEN_EXPIRES_MINUTES=30
REFRESH_TOKEN_EXPIRES_MINUTES=1200

FORGOTTEN_PASSWORD_EXPIRES_MINUTES=60
MAX_LOGIN_ATTEMPTS=5

MAILING_ACCOUNT_EMAIL= your-smtp@mail.com
MAILING_ACCOUNT_PASSWORD= pasword to mail that will be used for SMTP
MAILING_SMTP_SERVER= smtp server
MAILING_SMTP_PORT= smtp port
MAILING_SMTP_TIMEOUT= smtp timeout

SWAGGER_URL=/docs or comment to disable
REDOC_URL=/redoc or comment to disable
OPENAPI_URL=/openapi.json or comment to disable

PASSWORD_MIN_LEN=7
PASSWORD_MAX_LEN=32
```
4. run as uvicorn ``python3 -m uvicorn main:app --reload --host 0.0.0.0 --port 8990``, you can change host or port for your needs


# Testing
### Unit tests
You can run tests with [pytest](https://docs.pytest.org/en/stable/) - ``python3 -m pytest -v``

### Web app
There is a register/login/logout/token fetching interface ready to go, setup to work with ``/`` endpoint. Just go to ``http://localhost:8990`` after following steps described under __Environment setup__ and you will be able to test all functionalities.

### Swagger
There is also the ``Swagger`` interface located under ``/docs`` endpoint

### CLI register/login
To test the login/register/token functionalities you can do it via web application, accessible from ``localhost:port`` leveraging browser authentication functionality (via auth cookie) or via REST calls, you can use scripts placed under ``./scripts/`` directory, e.g. ``./scripts/register_user_via_rest.py/`` that use ``requests`` library (which is not included in ``requirements.txt`` file.

