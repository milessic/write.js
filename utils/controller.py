from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from utils.db.db_clients import DbClient
from utils.localizations.localizations import localizations
import os
from dotenv import dotenv_values

class Controller:
    def __init__(self):
        self.env_file_path = os.path.dirname(os.path.abspath(os.path.dirname(__file__)))
        self.config = dotenv_values(".env")

        self.HOST = str()
        self.SECRET_KEY = str()
        self.ALGORITHM = str()
        self.ACCESS_TOKEN_EXPIRES_MINUTES = int()
        self.REFRESH_TOKEN_EXPIRES_MINUTES = int()
        self.FORGOTTEN_PASSWORD_EXPIRES_MINUTES = int()
        self.MAX_LOGIN_ATTEMPTS = int()

        self.SWAGGER_URL = str()
        self.REDOC_URL = str()
        self.OPENAPI_URL = str()

        self.PASSWORD_MIN_LEN = int()
        self.PASSWORD_MAX_LEN = int()

        self.load_env_variables()
        self.oauth2_scheme = OAuth2PasswordBearer(tokenUrl="api/auth/token")
        self.db = DbClient("writejs_auth.sqlite")
        self.locales = localizations


    def load_env_variables(self):
        try:
            self.HOST = self.config.get("HOST")
            self.SECRET_KEY = self.config.get("SECRET_KEY")# TODO load from .env
            self.ALGORITHM = self.config.get("ALGORITHM")
            self.ACCESS_TOKEN_EXPIRES_MINUTES = int(float(str(self.config.get("ACCESS_TOKEN_EXPIRES_MINUTES"))))
            self.REFRESH_TOKEN_EXPIRES_MINUTES = int(float(str(self.config.get("REFRESH_TOKEN_EXPIRES_MINUTES"))))
            self.FORGOTTEN_PASSWORD_EXPIRES_MINUTES = int(float(str(self.config.get("FORGOTTEN_PASSWORD_EXPIRES_MINUTES"))))
            self.MAX_LOGIN_ATTEMPTS = int(float(str(self.config.get("MAX_LOGIN_ATTEMPTS"))))
            self.SWAGGER_URL = self.config.get("SWAGGER_URL")
            self.REDOC_URL = self.config.get("REDOC_URL")
            self.OPENAPI_URL = self.config.get("OPENAPI_URL")
            self.PASSWORD_MIN_LEN = int(float(str(self.config.get("PASSWORD_MIN_LEN")))) 
            self.PASSWORD_MAX_LEN = int(float(str(self.config.get("PASSWORD_MAX_LEN")))) 
        except Exception as e:
            raise AttributeError(f".env file not found or doens't have proper key=values - {e}")

        return

controller = Controller()

