from utils.db.sqlte3_connector import SqLite3Connector
from utils.auth import queries as auth
from utils.docs import queries as docs
from fastapi import status, HTTPException

default_user_settings = """{"autosave":2,"formatting":1,"darkmode":0,"left_widget":0,"right_widget":0,"fullpage_content":0,"markdown_export":0,"flashcards_enabled":1,"default_doc":0,"keep_session":1,"session":[],"lang":"__"}"""

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

        for f in dir(docs):
            if f.startswith("create_table"):
                query = getattr(docs, f)
                self._execute(query)

    # USERS - users
    def create_user(self, user_details:dict):
        self._execute(auth.create_user_record, *[user_details["username"], user_details["password"], user_details["email"]])
        # create portfolio
        user_id = u[3] if (u:=self.get_user_data(user_details["username"])) else None
        if user_id is None:
            raise HTTPException(500, "user creation error!")
        self._execute(docs.portfolios["insert"], user_id, "[]")
        self._execute(docs.user_settings["insert"], user_id, default_user_settings)

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

    # PORTFOLIO
    def get_portfolio(self, user_id) -> str:
        try:
            return self._execute(docs.portfolios["select"], user_id)[0][0][0]
        except:
            return ""

    def update_portfolio(self, user_id, portfolio_object):
        self._execute(docs.portfolios["update"], portfolio_object, user_id)

    # DOCUMENTS
    def create_document(self, doc_name:str, share_type_id:int, content:str, dir:str, user_id:int):
        self._execute(docs.documents["insert"], doc_name, share_type_id, content, dir, user_id)

    def get_document_share_type(self, doc_id) -> int:
        content = int(float(self._execute(docs.documents["select_share_type"], doc_id)[0][0]))
        if isinstance(content, str):
            return content
        raise HTTPException(404, f"Err12339a Didn't find document with id {doc_id}")

    def get_document_name(self, doc_id) -> str:
        content = self._execute(docs.documents["select_name"], doc_id)[0][0]
        if isinstance(content, str):
            return content
        raise HTTPException(404, f"Err12339b Didn't find document with id {doc_id}")

    def get_document_content(self, doc_id) -> str:
        content = self._execute(docs.documents["select_content"], doc_id)[0][0][0]
        if content:
            return content
        raise HTTPException(404, f"Err12339c Didn't find document with id {doc_id}")

    def get_documents_info_for_portfolio(self, user_id) -> str:
        content = self._execute(docs.documents["select_for_portfolio"], user_id)[0]
        if content:
            return content
        raise HTTPException(404, f"Err12339c Didn't find portfolio with id {user_id}")

    def update_document(self, doc_id:str, *, share_type_id=None, doc_name=None, content=None, dir=None):
        if share_type_id is not None:
            self._execute(docs.documents["update_share_type_id"], share_type_id, doc_id)
        if content is not None:
            self._execute(docs.documents["update_content"], content, doc_id)
        if dir is not None:
            self._execute(docs.documents["update_dir"], content, dir)
        if doc_name is not None:
            self._execute(docs.documents["update_name"], doc_name, doc_id)
            return
        assert any([(share_type_id is not None),(doc_name is not None),(content is not None)]), "ERR84901, Both share_type_id and co_name are None!"

    # --- this is handled by create_user()
    # def crete_user_settings(self, username:str, settings_object:str):
    #     user_id = self.get_user_id_from_username(username)
    #     self._execute(docs.documents["insert"], user_id, settings_object)

    def update_user_settings(self, *, user_id=None, username=None, settings_object:str):
        if user_id is None:
            assert username is not None, "ERR8014 username and user_id are Nones!"
            user_id = self.get_user_id_from_username(username)
        self._execute(docs.documents["insert"], user_id, settings_object)


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
