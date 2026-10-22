from utils.db.sqlte3_connector import SqLite3Connector
from utils.auth import queries as auth
from utils.docs import queries as docs
from fastapi import status, HTTPException


class DbClient:
    def __init__(
        self,
        database_name: str,
        database_type: str = "sqlite3",
        init_tables_at_start: bool = True,
    ):
        self.database_type = database_type
        self.client = SqLite3Connector(f"{database_name}.db")
        if init_tables_at_start:
            self.create_tables()

    def _execute(self, query, *args) -> list | dict:
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
                self._execute(query)

        # INDEXES
        for f in dir(auth):
            if f.startswith("create_index"):
                query = getattr(auth, f)
                self._execute(query)

        for f in dir(docs):
            if f.startswith("create_table"):
                query = getattr(docs, f)
                self._execute(query)

        for f in dir(docs):
            if f.startswith("create_index"):
                query = getattr(docs, f)
                self._execute(query)

    # USERS - users
    def create_user(self, user_details: dict):
        self._execute(
            auth.create_user_record,
            *[
                user_details["username"],
                user_details["password"],
                user_details["email"],
            ],
        )

    def delete_user(self, username: str, user_id: int):
        self._execute(auth.delete_user, username, user_id)

    def get_user_data(self, login) -> list | None:
        r"returns username, email, password, user_id"
        if len(
            (
                result := self._execute(
                    auth.get_user_data_by_username_or_email, login, login
                )
            )
        ):  # TODO this shuold be reworked a little
            return result[0][0]
        return None

    def update_user_password(self, user_id: int, new_password: str | bytes) -> None:
        self._execute(auth.update_password, new_password, user_id)

    def check_if_username_exists(self, username):
        return bool(self._execute(auth.check_if_username_exists, username)[0][0][0])

    def check_if_email_exists(self, email):
        return bool(self._execute(auth.check_if_email_exists, email)[0][0][0])

    def get_user_id_from_username(self, username) -> int | None:
        if len((result := self._execute(auth.get_user_id_by_username, username))):
            return result[0][0][0]
        return None

    # TOKENS - tokens
    def create_access_token_record(self, access_token: str, user_id: int, expires: int):
        if self._execute(auth.check_if_access_token_exists, access_token)[0][0][0]:
            raise HTTPException(
                400, "Access Token already exists! You may be generating it too fast!"
            )
        self._execute(auth.create_access_token_record, access_token, user_id, expires)

    def create_refresh_token_record(
        self, refresh_token: str, user_id: int, expires: int
    ):
        if self._execute(auth.check_if_refresh_token_exists, refresh_token)[0][0][0]:
            raise HTTPException(
                400, "Refresh Token already exists! You may be generating it too fast!"
            )
        self._execute(auth.create_refresh_token_record, refresh_token, user_id, expires)

    def check_if_access_token_is_active_for_user(
        self, access_token: str, user_id: int, expires: int
    ):
        return bool(
            self._execute(
                auth.check_if_access_token_is_active_for_user,
                access_token,
                user_id,
                expires,
            )[0][0][0]
        )

    def check_if_refresh_token_is_active_for_user(
        self, refresh_token: str, user_id: int, expires: int
    ):
        return self._execute(
            auth.check_if_refresh_token_is_active_for_user,
            refresh_token,
            user_id,
            expires,
        )[0][0][0]

    def get_active_access_tokens_for_user(self, user_id: int, expires: str) -> list:
        if len(
            result := self._execute(
                auth.get_active_access_tokens_for_user, user_id, expires
            )
        ):
            return result[0][0]
        return []

    def get_active_refresh_tokens_for_user(self, user_id: int, expires: str) -> list:
        if len(
            result := self._execute(
                auth.get_active_refresh_tokens_for_user, user_id, expires
            )
        ):
            return result[0][0]
        return []

    def kill_all_access_tokens_for_user(self, user_id: int):
        r"sets all access AND refresh tokens as inactive for given user_id"
        self._execute(auth.kill_all_access_tokens_for_user, user_id)
        self._execute(auth.kill_all_refresh_tokens_for_user, user_id)

    def set_access_token_as_inactive_for_user(self, user_id: int, access_token: str):
        self._execute(auth.set_access_token_as_inactive_for_user, user_id, access_token)

    def set_refresh_token_as_incactive_for_user(self, user_id: int, refresh_token: str):
        self._execute(
            auth.set_refresh_token_as_inactive_for_user, user_id, refresh_token
        )

    def create_forgotten_password_record(
        self, guid: str, expires: int, user_id: int
    ) -> None:
        self._execute(auth.create_forgotten_password_record, guid, expires, user_id)

    def deactivate_forgotten_password_records_for_user(self, user_id: int) -> None:
        self._execute(auth.deactivate_forgotten_password_records_for_user, user_id)

    def check_if_guid_is_valuable_and_not_expired_for_password_reset(
        self, guid: str, expires: int, user_id: int
    ) -> bool:
        if (
            result := self._execute(
                auth.check_if_guid_is_valuable_and_not_expired_for_password_reset,
                guid,
                expires,
                user_id,
            )[0][0][0]
        ) is not None:
            return bool(result)
        return False

    def create_failed_login_record(self, user_id: int, expires: int) -> None:
        self._execute(auth.create_failed_login_record, user_id, expires)

    def get_failed_login_attempts(self, user_id: int, expires: int) -> int:
        return int(
            self._execute(auth.get_failed_login_attempts, user_id, expires)[0][0][0]
        )

    def reset_failed_login_attempts(self, user_id: int) -> None:
        self._execute(auth.reset_failed_login_attempts, user_id)

    # NOTEBOOKS - user_notebooks
    def get_notebooks(self, user_id: int) -> list[dict]:
        rows = self._execute(docs.notebooks["get_for_user"], user_id)
        return [
            {"notebook_id": r[0], "name": r[1], "meta_version": r[2], "created_at": r[3]}
            for r in (rows[0] if rows else [])
        ]

    def create_notebook_for_user(self, user_id: int, name: str) -> int:
        return self._execute(docs.notebooks["insert"], user_id, name)[0][0][0]

    def get_notebook_meta(self, notebook_id: int, user_id: int) -> tuple | None:
        r"returns meta_content, meta_version"
        if len(result := self._execute(docs.notebooks["get_meta"], notebook_id, user_id)):
            return result[0][0]
        return None

    def update_notebook_meta(
        self, notebook_id: int, user_id: int, content: str, base_version: int
    ) -> int | None:
        r"returns the new version, None when base_version is not the current one"
        if len(
            result := self._execute(
                docs.notebooks["update_meta"], content, notebook_id, user_id, base_version
            )
        ):
            return result[0][0][0]
        return None

    # DOCUMENTS - notebook_documents
    def list_notebook_documents(self, notebook_id: int) -> list[dict]:
        rows = self._execute(docs.notebook_documents["list"], notebook_id)
        return [
            {"doc_id": r[0], "name": r[1], "version": r[2], "deleted": bool(r[3]), "updated_at": r[4]}
            for r in (rows[0] if rows else [])
        ]

    def count_notebook_documents(self, notebook_id: int) -> int:
        return int(self._execute(docs.notebook_documents["count"], notebook_id)[0][0][0])

    def get_notebook_document(self, notebook_id: int, doc_id: str) -> dict | None:
        if not len(result := self._execute(docs.notebook_documents["get"], notebook_id, doc_id)):
            return None
        r = result[0][0]
        return {
            "doc_id": r[0], "name": r[1], "content": r[2], "version": r[3], "deleted": bool(r[4]), "updated_at": r[5],
        }

    def save_notebook_document(
        self, notebook_id: int, doc_id: str, name: str, content: str, base_version: int
    ) -> int | None:
        r"creates (base_version 0) or updates a document, returns the new version, None on a version conflict"
        if base_version == 0:
            result = self._execute(docs.notebook_documents["insert"], notebook_id, doc_id, name, content)
        else:
            result = self._execute(
                docs.notebook_documents["update"], name, content, notebook_id, doc_id, base_version
            )
        return result[0][0][0] if len(result) else None

    def delete_notebook_document(self, notebook_id: int, doc_id: str, base_version: int) -> int | None:
        r"leaves a tombstone, returns its version, None on a version conflict"
        if len(result := self._execute(docs.notebook_documents["delete"], notebook_id, doc_id, base_version)):
            return result[0][0][0]
        return None

    # CRON - notebook_crons, notebook_cron_log
    CRON_FIELDS = (
        "cron_id", "doc_id", "script", "cron", "executor", "executor_name", "enabled", "enabled_at", "last_run", "missed",
    )

    def _cron_row(self, r) -> dict:
        cron = dict(zip(self.CRON_FIELDS, r))
        cron["enabled"] = bool(cron["enabled"])
        cron["missed"] = bool(cron["missed"])
        return cron

    def list_notebook_crons(self, notebook_id: int) -> list[dict]:
        rows = self._execute(docs.notebook_crons["list"], notebook_id)
        return [self._cron_row(r) for r in (rows[0] if rows else [])]

    def get_notebook_cron(self, notebook_id: int, cron_id: str) -> dict | None:
        if not len(result := self._execute(docs.notebook_crons["get"], notebook_id, cron_id)):
            return None
        return self._cron_row(result[0][0])

    def save_notebook_cron(self, notebook_id: int, cron: dict) -> None:
        r"creates or replaces a job, cron has every one of CRON_FIELDS"
        self._execute(
            docs.notebook_crons["upsert"],
            notebook_id,
            *[int(cron[f]) if f in ("enabled", "missed") else cron[f] for f in self.CRON_FIELDS],
        )

    def delete_notebook_cron(self, notebook_id: int, cron_id: str) -> bool:
        return bool(len(self._execute(docs.notebook_crons["delete"], notebook_id, cron_id)))

    def list_notebook_cron_log(self, notebook_id: int, limit: int) -> list[dict]:
        rows = self._execute(docs.notebook_cron_log["list"], notebook_id, limit)
        return [
            {"cron_id": r[0], "at": r[1], "ok": bool(r[2]), "message": r[3], "executor_name": r[4]}
            for r in (rows[0] if rows else [])
        ]

    def add_notebook_cron_log(
        self, notebook_id: int, cron_id: str, at: int, ok: bool, message: str, executor_name: str, keep: int
    ) -> None:
        self._execute(docs.notebook_cron_log["insert"], notebook_id, cron_id, at, int(ok), message, executor_name)
        self._execute(docs.notebook_cron_log["trim"], notebook_id, notebook_id, keep)

    # THESE ARE TEMPORARY THINGS!!!!!!!
    # START
    def create_notebook(self, user_id, notebook):
        create_notebooks = {
            "sqlite3": "CREATE TABLE IF NOT EXISTS notebooks( notebook_id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, notebook_content TEXT, created TEXT DEFAULT CURRENT_TIMESTAMP)"
        }
        self._execute(create_notebooks)
        create_notebook = {
            "sqlite3": "INSERT INTO notebooks ( user_id, notebook_content) VALUES ( (?), (?) )"
        }
        self._execute(create_notebook, user_id, notebook)

    def get_notebook(self, user_id: int) -> str:
        get_notebook = {
            "sqlite3": "SELECT notebook_content FROM notebooks WHERE user_id=(?) ORDER BY notebook_id DESC"
        }
        try:
            return self._execute(get_notebook, user_id)[0][0][0]
        except IndexError:
            return None

    def delete_user_content(self, user_id: int):
        delete_notebook = {"sqlite3": "DELETE FROM notebooks WHERE user_id=(?)"}
        self._execute(delete_notebook, user_id)
        self._execute(docs.notebook_documents["delete_for_user"], user_id)
        self._execute(docs.notebook_crons["delete_for_user"], user_id)
        self._execute(docs.notebook_cron_log["delete_for_user"], user_id)
        self._execute(docs.notebooks["delete_for_user"], user_id)

    # END
