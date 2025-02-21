from utils.db.sqlte3_connector import SqLite3Connector
from utils.auth import queries as auth
from fastapi import status, HTTPException


class DbClient():
    def __init__(self, database_name:str, database_type:str="sqlite3", init_tables_at_start:bool=True):
        self.database_type = database_type
        self.client = SqLite3Connector(f"{database_name}.db")
        if init_tables_at_start:
            self.create_tables()

    def _execute(self, query, *args) -> list|dict:
        output = self.client.execute(query[self.database_type], *args)
        try:
            if str(output[0][0]).startswith("ERROR:"):
                raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, output)
            return output
        except IndexError:
            return []

    def create_tables(self):
        r"creates tables and indexes"

        # TABLES
        ## auth
        for f in dir(auth):
            if f.startswith("create_table"):
                query = getattr(auth, f)
                self._execute(
                        query
                        )

        # INDEXES
        for f in dir(auth):
            if f.startswith("create_index"):
                query = getattr(auth, f)
                self._execute(
                        query
                        )

    # USERS - users
    def create_user(self, user_details:dict):
        self._execute(auth.create_user_record, *[user_details["username"], user_details["password"], user_details["email"]])

    def delete_user(self, username:str, user_id:int):
        self._execute(auth.delete_user, username, user_id) 

    def get_user_data(self, login) -> list | None:
        r"returns username, email, password, user_id"
        if len(( result := self._execute(auth.get_user_data_by_username_or_email, login, login))): # TODO this shuold be reworked a little
            return result[0][0]
        return None

    def update_user_password(self, user_id:int, new_password:str|bytes) -> None:
        self._execute(auth.update_password, new_password, user_id)

    def check_if_username_exists(self, username):
        return bool( self._execute(auth.check_if_username_exists, username)[0][0][0] )

    def check_if_email_exists(self, email):
        return bool( self._execute(auth.check_if_email_exists, email)[0][0][0] )

    def get_user_id_from_username(self, username) -> int | None:
        if len(( result := self._execute(auth.get_user_id_by_username, username) )): 
            return result[0][0][0]
        return None

    # TOKENS - tokens
    def create_access_token_record(self, access_token:str, user_id:int, expires:int):
        if (self._execute(auth.check_if_access_token_exists, access_token)[0][0][0]):
            raise HTTPException(400, "Access Token already exists! You may be generating it too fast!")
        self._execute(auth.create_access_token_record, access_token, user_id, expires)

    def create_refresh_token_record(self, refresh_token:str, user_id:int, expires:int):
        if (self._execute(auth.check_if_refresh_token_exists, refresh_token)[0][0][0]):
            raise HTTPException(400, "Refresh Token already exists! You may be generating it too fast!")
        self._execute(auth.create_refresh_token_record, refresh_token, user_id, expires)

    def check_if_access_token_is_active_for_user(self, access_token:str, user_id:int, expires:int):
        return bool(self._execute(auth.check_if_access_token_is_active_for_user, access_token, user_id, expires)[0][0][0])

    def check_if_refresh_token_is_active_for_user(self, refresh_token:str, user_id:int, expires:int):
        return (self._execute(auth.check_if_refresh_token_is_active_for_user, refresh_token, user_id, expires)[0][0][0])

    def get_active_access_tokens_for_user(self, user_id:int, expires:str) -> list:
        if len( result := self._execute(auth.get_active_access_tokens_for_user, user_id, expires)):
            return result[0][0]
        return []

    def get_active_refresh_tokens_for_user(self, user_id:int, expires:str) -> list:
        if len( result := self._execute(auth.get_active_refresh_tokens_for_user, user_id, expires)):
            return result[0][0]
        return []

    def kill_all_access_tokens_for_user(self, user_id:int):
        r"sets all access AND refresh tokens as inactive for given user_id"
        self._execute(auth.kill_all_access_tokens_for_user, user_id)
        self._execute(auth.kill_all_refresh_tokens_for_user, user_id)

    def set_access_token_as_inactive_for_user(self, user_id:int, access_token:str):
        self._execute(auth.set_access_token_as_inactive_for_user, user_id, access_token)

    def set_refresh_token_as_incactive_for_user(self, user_id:int, refresh_token:str):
        self._execute(auth.set_refresh_token_as_inactive_for_user, user_id, refresh_token)

    def create_forgotten_password_record(self, guid:str, expires:int, user_id:int) -> None:
        self._execute(auth.create_forgotten_password_record, guid, expires, user_id)

    def deactivate_forgotten_password_records_for_user(self, user_id:int) -> None:
        self._execute(auth.deactivate_forgotten_password_records_for_user, user_id)

    def check_if_guid_is_valuable_and_not_expired_for_password_reset(self, guid:str, expires:int, user_id:int) -> bool:
        if (result := self._execute(auth.check_if_guid_is_valuable_and_not_expired_for_password_reset, guid, expires, user_id)[0][0][0]) is not None:
            return bool(result)
        return False

    def create_failed_login_record(self, user_id:int, expires:int) -> None:
        self._execute(auth.create_failed_login_record, user_id, expires)

    def get_failed_login_attempts(self, user_id:int, expires:int) -> int:
        return int(self._execute(auth.get_failed_login_attempts, user_id, expires)[0][0][0])

    def reset_failed_login_attempts(self, user_id:int) -> None:
        self._execute(auth.reset_failed_login_attempts, user_id)


    # THESE ARE TEMPORARY THINGS!!!!!!!
    # START
    def create_notebook(self, user_id, notebook):
        create_notebooks = {"sqlite3":"CREATE TABLE IF NOT EXISTS notebooks( notebook_id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, notebook_content TEXT, created TEXT DEFAULT CURRENT_TIMESTAMP)"}
        self._execute(create_notebooks)
        create_notebook = {"sqlite3": "INSERT INTO notebooks ( user_id, notebook_content) VALUES ( (?), (?) )"}
        self._execute(create_notebook, user_id, notebook)
    def get_notebook(self, user_id:int) -> str:
        get_notebook = {"sqlite3": "SELECT notebook_content FROM notebooks WHERE user_id=(?) ORDER BY notebook_id DESC"}
        try:
            return self._execute(get_notebook, user_id)[0][0][0]
        except IndexError:
            return None
    def delete_user_content(self, user_id:int):
        delete_notebook = {"sqlite3":"DELETE FROM notebooks WHERE user_id=(?)"}
        self._execute(delete_notebook, user_id)
    # END
