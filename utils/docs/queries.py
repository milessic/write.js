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
