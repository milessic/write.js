# CREATE TABLE#!S
create_table_documents = {
    "sqlite3": """
    CREATE TABLE IF NOT EXISTS documents (
        doc_id INTEGER PRIMARY KEY AUTOINCREMENT UNIQUE,
        doc_name TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        share_type_id INTEGER NOT NULL,
        FOREIGN KEY (share_type_id) REFERENCES share_types(share_type_id) 
    );
    """
}

create_table_revisions = {
    "sqlite3": """
    CREATE TABLE IF NOT EXISTS revisions (
        revision_id INTEGER PRIMARY KEY AUTOINCREMENT UNIQUE,
        doc_version INTEGER NOT NULL,
        content BLOB,
        doc_id INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (doc_id) REFERENCES documents(doc_id) ON DELETE CASCADE
    );
    """
}

create_table_share_types = {
    "sqlite3": """

    CREATE TABLE IF NOT EXISTS share_types (
        share_type_id INTEGER PRIMARY KEY AUTOINCREMENT UNIQUE,
        share_type_description TEXT NOT NULL
    );
    """
}

create_table_accesses = {
    "sqlite3": """

    CREATE TABLE IF NOT EXISTS accesses (
        user_id INTEGER NOT NULL,
        document_id INTEGER NOT NULL,
        access_type_id INTEGER NOT NULL,
        FOREIGN KEY (document_id) REFERENCES documents(doc_id) ON DELETE CASCADE,
        FOREIGN KEY (access_type_id) REFERENCES acess_types(access_type_id)
    );

    """
}

create_table_access_types = {
    "sqlite3": """
    CREATE TABLE IF NOT EXISTS access_types (
        access_type_id INTEGER PRIMARY KEY AUTOINCREMENT UNIQUE,
        access_type_name TEXT NOT NULL
    );


    """
}

create_table_chunks = {
    "sqlite3": """
    CREATE TABLE IF NOT EXISTS chunks (
        revision_id INTEGER NOT NULL,
        chunk_num INTEGER NOT NULL,
        chunk_content TEXT,
        FOREIGN KEY (revision_id) REFERENCES revisions(revision_id) ON DELETE CASCADE
    );

    """
}

create_table_user_settings = {
    "sqlite3": """
    CREATE TABLE IF NOT EXISTS user_settings (
        user_id INTEGER NOT NULL,
        settings_object TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    );

    """
}

create_table_portfolios = {
    "sqlite3": """
    CREATE TABLE IF NOT EXISTS portfolios(
        user_id INTEGER NOT NULL,
        portfolio_object TEXT NOT NULL,
        FOREIGN KEY(user_id) REFERENCES users(user_id) ON DELETE CASCADE
    );
    """
}

documents = {
    "insert": "INSERT INTO documents (doc_name, share_type_id) VALUES (?, ?);",
    "update": "UPDATE documents SET doc_name = ?, share_type_id = ? WHERE doc_id = ?;",
    "delete": "DELETE FROM documents WHERE doc_id = ?;",
}
share_types = (
    {
        "insert": "INSERT INTO share_types (share_type_description) VALUES (?);",
        "update": "UPDATE share_types SET share_type_description = ? WHERE share_type_id = ?;",
        "delete": "DELETE FROM share_types WHERE share_type_id = ?;",
    },
)
accesses = {
    "insert": "INSERT INTO acesses (user_id, document_id, access_type_id) VALUES (?, ?, ?);",
    "update": "UPDATE acesses SET access_type_id = ? WHERE user_id = ? AND document_id = ?;",
    "delete": "DELETE FROM acesses WHERE user_id = ? AND document_id = ?;",
}

access_types = (
    {
        "insert": "INSERT INTO acess_types (access_type_name) VALUES (?);",
        "update": "UPDATE acess_types SET access_type_name = ? WHERE access_type_id = ?;",
        "delete": "DELETE FROM acess_types WHERE access_type_id = ?;",
    },
)
revisions = (
    {
        "insert": "INSERT INTO revisions (doc_version, content, doc_id) VALUES (?, ?, ?);",
        "update": "UPDATE revisions SET doc_version = ?, content = ? WHERE revision_id = ?;",
        "delete": "DELETE FROM revisions WHERE revision_id = ?;",
    },
)

chunks = {
    "insert": "INSERT INTO chunks (revision_id, chunk_num, chunk_content) VALUES (?, ?, ?);",
    "update": "UPDATE chunks SET chunk_content = ? WHERE revision_id = ? AND chunk_num = ?;",
    "delete": "DELETE FROM chunks WHERE revision_id = ? AND chunk_num = ?;",
}

user_settings = {
    "insert": "INSERT INTO user_settings (user_id, settings_object) VALUES (?, ?);",
    "update": "UPDATE user_settings SET settings_object = ? WHERE user_id = ?;",
    "delete": "DELETE FROM user_settings WHERE user_id = ?;",
}

portfolios = {
    "insert": "INSERT INTO portfolios (user_id, portfolio_object) VALUES (?, ?);",
    "update": "UPDATE portfolios SET portfolio_object= ? WHERE user_id = ?;",
}


# NOTEBOOKS & DOCUMENTS (cloud sync)
# A notebook is a user's collection of documents (for now every user has one, "Default").
# Its meta holds what goes with the notebook besides the documents: the folders and the settings.
# A document is one row, known by the uuid the client keeps in it (doclinks.js); its content is
# pako-compressed by the client and stored as is. Every write bumps the version, a write is accepted
# only against the version the client last saw, otherwise it is a conflict.
# A deleted document stays as a tombstone (deleted = 1), so other devices learn about the delete.
create_table_user_notebooks = {
    "sqlite3": """
    CREATE TABLE IF NOT EXISTS user_notebooks (
        notebook_id INTEGER PRIMARY KEY AUTOINCREMENT UNIQUE,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        meta_content TEXT,
        meta_version INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    );
    """
}

create_table_notebook_documents = {
    "sqlite3": """
    CREATE TABLE IF NOT EXISTS notebook_documents (
        notebook_id INTEGER NOT NULL,
        doc_uuid TEXT NOT NULL,
        name TEXT NOT NULL,
        content TEXT,
        version INTEGER NOT NULL DEFAULT 1,
        deleted INTEGER NOT NULL DEFAULT 0,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (notebook_id, doc_uuid),
        FOREIGN KEY (notebook_id) REFERENCES user_notebooks(notebook_id) ON DELETE CASCADE
    );
    """
}

create_index_user_notebooks_user = {
    "sqlite3": "CREATE INDEX IF NOT EXISTS idx_user_notebooks_user ON user_notebooks(user_id)"
}

notebooks = {
    "insert": {"sqlite3": "INSERT INTO user_notebooks (user_id, name) VALUES (?, ?) RETURNING notebook_id"},
    "get_for_user": {
        "sqlite3": "SELECT notebook_id, name, meta_version, created_at FROM user_notebooks WHERE user_id = ? ORDER BY notebook_id"
    },
    "get_meta": {
        "sqlite3": "SELECT meta_content, meta_version FROM user_notebooks WHERE notebook_id = ? AND user_id = ?"
    },
    # RETURNING gives a row only when the version matched, i.e. the write was accepted
    "update_meta": {
        "sqlite3": """UPDATE user_notebooks SET meta_content = ?, meta_version = meta_version + 1
        WHERE notebook_id = ? AND user_id = ? AND meta_version = ? RETURNING meta_version"""
    },
    "delete_for_user": {"sqlite3": "DELETE FROM user_notebooks WHERE user_id = ?"},
}

notebook_documents = {
    "list": {
        "sqlite3": """SELECT doc_uuid, name, version, deleted, updated_at FROM notebook_documents
        WHERE notebook_id = ? ORDER BY name"""
    },
    "count": {"sqlite3": "SELECT COUNT(*) FROM notebook_documents WHERE notebook_id = ?"},
    "get": {
        "sqlite3": """SELECT doc_uuid, name, content, version, deleted, updated_at FROM notebook_documents
        WHERE notebook_id = ? AND doc_uuid = ?"""
    },
    "insert": {
        "sqlite3": """INSERT INTO notebook_documents (notebook_id, doc_uuid, name, content) VALUES (?, ?, ?, ?)
        ON CONFLICT (notebook_id, doc_uuid) DO NOTHING RETURNING version"""
    },
    "update": {
        "sqlite3": """UPDATE notebook_documents SET name = ?, content = ?, deleted = 0, version = version + 1,
        updated_at = CURRENT_TIMESTAMP WHERE notebook_id = ? AND doc_uuid = ? AND version = ? RETURNING version"""
    },
    "delete": {
        "sqlite3": """UPDATE notebook_documents SET content = NULL, deleted = 1, version = version + 1,
        updated_at = CURRENT_TIMESTAMP WHERE notebook_id = ? AND doc_uuid = ? AND version = ? RETURNING version"""
    },
    "delete_for_user": {
        "sqlite3": """DELETE FROM notebook_documents WHERE notebook_id IN
        (SELECT notebook_id FROM user_notebooks WHERE user_id = ?)"""
    },
}

# the notebook as a single blob, from before the documents were kept apart (routers/temp_notebooks.py);
# read once by a device to move a notebook that was never synced document by document
create_table_legacy_notebooks = {
    "sqlite3": """
    CREATE TABLE IF NOT EXISTS notebooks (
        notebook_id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        notebook_content TEXT,
        created TEXT DEFAULT CURRENT_TIMESTAMP
    );
    """
}

# NOTEBOOK CRON (static/cron.js)
# A cron job runs a script of a document (scripting.js) on a schedule, in the one browser picked as its executor.
# A job is one row, known by the uuid the client gives it; doc_uuid is its document's id (doclinks.js) and script the
# display name of the script's button. Times are milliseconds since the epoch, as the client has them.
# The log keeps the last runs of the notebook's jobs (MAX_CRON_LOG in routers/notebooks.py).
create_table_notebook_crons = {
    "sqlite3": """
    CREATE TABLE IF NOT EXISTS notebook_crons (
        notebook_id INTEGER NOT NULL,
        cron_uuid TEXT NOT NULL,
        doc_uuid TEXT NOT NULL,
        script TEXT NOT NULL,
        cron TEXT NOT NULL,
        executor TEXT NOT NULL DEFAULT '',
        executor_name TEXT NOT NULL DEFAULT '',
        enabled INTEGER NOT NULL DEFAULT 1,
        enabled_at INTEGER,
        last_run INTEGER,
        missed INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (notebook_id, cron_uuid),
        FOREIGN KEY (notebook_id) REFERENCES user_notebooks(notebook_id) ON DELETE CASCADE
    );
    """
}

create_table_notebook_cron_log = {
    "sqlite3": """
    CREATE TABLE IF NOT EXISTS notebook_cron_log (
        log_id INTEGER PRIMARY KEY AUTOINCREMENT,
        notebook_id INTEGER NOT NULL,
        cron_uuid TEXT NOT NULL,
        at INTEGER NOT NULL,
        ok INTEGER NOT NULL,
        message TEXT NOT NULL,
        executor_name TEXT NOT NULL DEFAULT '',
        FOREIGN KEY (notebook_id) REFERENCES user_notebooks(notebook_id) ON DELETE CASCADE
    );
    """
}

create_index_notebook_cron_log = {
    "sqlite3": "CREATE INDEX IF NOT EXISTS idx_notebook_cron_log_notebook ON notebook_cron_log(notebook_id, log_id)"
}

notebook_crons = {
    "list": {
        "sqlite3": """SELECT cron_uuid, doc_uuid, script, cron, executor, executor_name, enabled, enabled_at, last_run, missed
        FROM notebook_crons WHERE notebook_id = ? ORDER BY created_at, rowid"""
    },
    "get": {
        "sqlite3": """SELECT cron_uuid, doc_uuid, script, cron, executor, executor_name, enabled, enabled_at, last_run, missed
        FROM notebook_crons WHERE notebook_id = ? AND cron_uuid = ?"""
    },
    "upsert": {
        "sqlite3": """INSERT INTO notebook_crons
        (notebook_id, cron_uuid, doc_uuid, script, cron, executor, executor_name, enabled, enabled_at, last_run, missed)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (notebook_id, cron_uuid) DO UPDATE SET doc_uuid = excluded.doc_uuid, script = excluded.script,
        cron = excluded.cron, executor = excluded.executor, executor_name = excluded.executor_name,
        enabled = excluded.enabled, enabled_at = excluded.enabled_at, last_run = excluded.last_run, missed = excluded.missed"""
    },
    "delete": {"sqlite3": "DELETE FROM notebook_crons WHERE notebook_id = ? AND cron_uuid = ? RETURNING cron_uuid"},
    "delete_for_user": {
        "sqlite3": """DELETE FROM notebook_crons WHERE notebook_id IN
        (SELECT notebook_id FROM user_notebooks WHERE user_id = ?)"""
    },
}

notebook_cron_log = {
    "list": {
        "sqlite3": """SELECT cron_uuid, at, ok, message, executor_name FROM notebook_cron_log
        WHERE notebook_id = ? ORDER BY log_id DESC LIMIT ?"""
    },
    "insert": {
        "sqlite3": """INSERT INTO notebook_cron_log (notebook_id, cron_uuid, at, ok, message, executor_name)
        VALUES (?, ?, ?, ?, ?, ?)"""
    },
    # only the newest entries are kept
    "trim": {
        "sqlite3": """DELETE FROM notebook_cron_log WHERE notebook_id = ? AND log_id NOT IN
        (SELECT log_id FROM notebook_cron_log WHERE notebook_id = ? ORDER BY log_id DESC LIMIT ?)"""
    },
    "delete_for_user": {
        "sqlite3": """DELETE FROM notebook_cron_log WHERE notebook_id IN
        (SELECT notebook_id FROM user_notebooks WHERE user_id = ?)"""
    },
}

# SCRIPT SECRETS (static/secrets.js)
# The account's secrets that scripts read with secret() (scriptapi.js), only the ones flagged "synced": the others stay in
# the browser they were added in. One row per secret, its name is unique for the user.
create_table_user_script_secrets = {
    "sqlite3": """
    CREATE TABLE IF NOT EXISTS user_script_secrets (
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        value TEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, name),
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    );
    """
}

user_script_secrets = {
    "list": {"sqlite3": "SELECT name, value, updated_at FROM user_script_secrets WHERE user_id = ? ORDER BY name"},
    "count": {"sqlite3": "SELECT COUNT(*) FROM user_script_secrets WHERE user_id = ?"},
    "exists": {"sqlite3": "SELECT 1 FROM user_script_secrets WHERE user_id = ? AND name = ?"},
    "upsert": {
        "sqlite3": """INSERT INTO user_script_secrets (user_id, name, value) VALUES (?, ?, ?)
        ON CONFLICT (user_id, name) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP"""
    },
    "delete": {"sqlite3": "DELETE FROM user_script_secrets WHERE user_id = ? AND name = ? RETURNING name"},
    "delete_for_user": {"sqlite3": "DELETE FROM user_script_secrets WHERE user_id = ?"},
}
