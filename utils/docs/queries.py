# CREATE TABLE#!S
create_table_documents = {
"sqlite3": 
    """
    CREATE TABLE IF NOT EXISTS documents (
        doc_id INTEGER PRIMARY KEY AUTOINCREMENT UNIQUE,
        doc_name TEXT NOT NULL,
        dir TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        share_type_id INTEGER NOT NULL,
        content TEXT NOT NULL,
        user_id INTEGER NOT NULL,
        FOREIGN KEY (share_type_id) REFERENCES share_types(share_type_id),
        FOREIGN KEY (user_id) REFERENCES users(user_id)
    );
    """,
"future_iteration":
    """
    CREATE TABLE IF NOT EXISTS documents (
        doc_id INTEGER PRIMARY KEY AUTOINCREMENT UNIQUE,
        doc_name TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        share_type_id INTEGER NOT NULL,
        FOREIGN KEY (share_type_id) REFERENCES share_types(share_type_id) 
    );
    """
}

FUTURE_create_table_revisions = {
"sqlite3": 
    """
    CREATE TABLE IF NOT EXISTS revisions (
        revision_id INTEGER PRIMARY KEY AUTOINCREMENT UNIQUE,
        doc_version INTEGER NOT NULL,
        content TEXT,
        doc_id INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (doc_id) REFERENCES documents(doc_id) ON DELETE CASCADE
    );
    """
}

create_table_share_types = {
"sqlite3": 
    """

    CREATE TABLE IF NOT EXISTS share_types (
        share_type_id INTEGER PRIMARY KEY AUTOINCREMENT UNIQUE,
        share_type_description TEXT NOT NULL
    );
    """
}

create_table_accesses = {
"sqlite3": 
    """

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
"sqlite3": 
    """
    CREATE TABLE IF NOT EXISTS access_types (
        access_type_id INTEGER PRIMARY KEY AUTOINCREMENT UNIQUE,
        access_type_name TEXT NOT NULL
    );


    """
}

FUTURE_create_table_chunks = {
"sqlite3": 
    """
    CREATE TABLE IF NOT EXISTS chunks (
        revision_id INTEGER NOT NULL,
        chunk_num INTEGER NOT NULL,
        chunk_content TEXT,
        FOREIGN KEY (revision_id) REFERENCES revisions(revision_id) ON DELETE CASCADE
    );

    """
}

create_table_user_settings = {
"sqlite3": 
    """
    CREATE TABLE IF NOT EXISTS user_settings (
        user_id INTEGER NOT NULL,
        settings_object TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    );

    """
}

create_table_portfolios = {
"sqlite3": 
    """
    CREATE TABLE IF NOT EXISTS portfolios(
        user_id INTEGER NOT NULL,
        portfolio_object TEXT NOT NULL,
        FOREIGN KEY(user_id) REFERENCES users(user_id) ON DELETE CASCADE
    );
    """
}

documents = {
        "insert": {"sqlite3": "INSERT INTO documents (doc_name, share_type_id, content, dir, user_id) VALUES (?, ?,? , ?, ?);"},

        "update_share_type_id": {"sqlite3": "UPDATE documents SET share_type_id = ? WHERE doc_id = ?;"},
        "update_name":          {"sqlite3": "UPDATE documents SET doc_name = ? WHERE doc_id = ?;"},
        "update_content":       {"sqlite3": "UPDATE documents SET content = ? WHERE doc_id = ?;"},
        "update_dir":       {"sqlite3": "UPDATE documents SET dir = ? WHERE doc_id = ?;"},

        "select_content":       {"sqlite3": "SELECT content FROM documents WHERE doc_id = ?"},
        "select_share_type":    {"sqlite3": "SELECT share_type_id FROM documents WHERE doc_id = ?"},
        "select_name":          {"sqlite3": "SELECT name FROM documents WHERE doc_id = ?"},

        "select_for_portfolio": {"sqlite3": "SELECT doc_id, share_type_id, dir, doc_name, created_at FROM documents WHERE user_id = ?"},

        "delete": {"sqlite3": "DELETE FROM documents WHERE doc_id = ?;"},
}

share_types = {
        "insert": {"sqlite3": "INSERT INTO share_types (share_type_description) VALUES (?);"},
        "update": {"sqlite3": "UPDATE share_types SET share_type_description = ? WHERE share_type_id = ?;"},
        "delete": {"sqlite3": "DELETE FROM share_types WHERE share_type_id = ?;"}
},
accesses = {
        "insert": {"sqlite3": "INSERT INTO acesses (user_id, document_id, access_type_id) VALUES (?, ?, ?);"},
        "update": {"sqlite3": "UPDATE acesses SET access_type_id = ? WHERE user_id = ? AND document_id = ?;"},
        "delete": {"sqlite3": "DELETE FROM acesses WHERE user_id = ? AND document_id = ?;"}
}

access_types= {
        "insert": {"sqlite3": "INSERT INTO acess_types (access_type_name) VALUES (?);"},
        "update": {"sqlite3": "UPDATE acess_types SET access_type_name = ? WHERE access_type_id = ?;"},
        "delete": {"sqlite3": "DELETE FROM acess_types WHERE access_type_id = ?;"}
},
"""
revisions = {
        "insert": {"sqlite3": "INSERT INTO revisions (doc_version, content, doc_id) VALUES (?, ?, ?);"},
        "update": {"sqlite3": "UPDATE revisions SET doc_version = ?, content = ? WHERE revision_id = ?;"},
        "delete": {"sqlite3": "DELETE FROM revisions WHERE revision_id = ?;"}
},

"""
"""
chunks= {
        "insert": {"sqlite3": "INSERT INTO chunks (revision_id, chunk_num, chunk_content) VALUES (?, ?, ?);"},
        "update": {"sqlite3": "UPDATE chunks SET chunk_content = ? WHERE revision_id = ? AND chunk_num = ?;"},
        "delete": {"sqlite3": "DELETE FROM chunks WHERE revision_id = ? AND chunk_num = ?;"}
}
"""

user_settings = {
        "insert": {"sqlite3": "INSERT INTO user_settings (user_id, settings_object) VALUES (?, ?);"},
        "update": {"sqlite3": "UPDATE user_settings SET settings_object = ? WHERE user_id = ?;"},
        "delete": {"sqlite3": "DELETE FROM user_settings WHERE user_id = ?;"}
}

portfolios = {
        "select": {"sqlite3": "SELECT portfolio_object FROM portfolios WHERE user_id = ?"},
        "insert": {"sqlite3": "INSERT INTO portfolios (user_id, portfolio_object) VALUES (?, ?);"},
        "update": {"sqlite3": "UPDATE portfolios SET portfolio_object= ? WHERE user_id = ?;"}
}
