# TOKENS
create_table_access_tokens = {
        "sqlite3": (
    """CREATE TABLE IF NOT EXISTS
        access_tokens (
            access_token TEXT PRIMARY KEY NOT NULL UNIQUE,
            user_id INTEGER NOT NULL,
            expires INTEGER NOT NULL,
            is_active INTEGER NOT NULL DEFAULT 1,
            issued_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(user_id) ON DELETE CASCADE
        )
    """
    )
}

create_index_access_token = {
        "sqlite3": (
    """
    CREATE INDEX IF NOT EXISTS idx_access_tokens_user_expires
    ON access_tokens(user_id, expires, is_active)
    """
    )
}

create_table_refresh_tokens = {
        "sqlite3": (
    """
    CREATE TABLE IF NOT EXISTS
        refresh_tokens (
            refresh_token TEXT PRIMARY KEY NOT NULL UNIQUE,
            user_id INTEGER NOT NULL,
            expires INTEGER NOT NULL,
            is_active INTEGER NOT NULL DEFAULT 1,
            issued_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(user_id) ON DELETE CASCADE
        )
    """
    )
}

create_index_refresh_token = {
        "sqlite3": (
    """
    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_expires
    ON refresh_tokens(user_id, expires, is_active)
    """
    )
}

check_if_access_token_is_active_for_user = {
        "sqlite3": (
    """
    SELECT COUNT(*) > 0
        FROM access_tokens
        WHERE 
            is_active=1
            AND access_token=(?)
            AND user_id=(?) 
            AND expires > (?);
    )
    """
    )
}

check_if_refresh_token_is_active_for_user = {
        "sqlite3": (
    """
    SELECT COUNT(*) > 0
        FROM refresh_tokens
        WHERE
            is_active=1
            AND refresh_token=(?)
            AND user_id=(?)
            AND expires > (?);
    """
    )
}


create_access_token_record = {
        "sqlite3": (
    """
    INSERT INTO access_tokens
        (
            access_token,
            user_id,
            expires
        )
    VALUES
        (
            (?),
            (?),
            (?)
        )
    """
    )
}
create_refresh_token_record = {
        "sqlite3": (
    """
    INSERT INTO refresh_tokens
        (
            refresh_token,
            user_id,
            expires
        )
    VALUES
        (
            (?),
            (?),
            (?)
        )
    """
    )
}

get_active_access_tokens_for_user = {
        "sqlite3": (
    """
    SELECT access_token
    FROM access_tokens
    WHERE 
        is_active=1
        AND user_id=(?)
        AND expires > (?);
    """
    )
}

get_active_refresh_tokens_for_user = {
        "sqlite3": (
    """
    SELECT refresh_token
    FROM refresh_tokens
    WHERE 
        is_active=1
        AND user_id=(?) 
        AND expires > (?);
    """
    )
}
kill_all_access_tokens_for_user = {
        "sqlite3": (
    """
    UPDATE  access_tokens
    SET is_active = 0
    WHERE user_id=(?) 
    """
    )
}

kill_all_refresh_tokens_for_user = {
        "sqlite3": (
    """
    UPDATE  refresh_tokens
    SET is_active = 0
    WHERE user_id=(?)
    """
    )
}

set_access_token_as_inactive_for_user = {
        "sqlite3": (
            """
            UPDATE access_tokens
            SET is_active = 0
            WHERE user_id = (?)
            AND access_token = (?)
            """
            )
        }

set_refresh_token_as_inactive_for_user = {
        "sqlite3": (
            """
            UPDATE refresh_tokens
            SET is_active = 0
            WHERE user_id = (?)
            AND refresh_token = (?)
            """
            )
        }

check_if_access_token_exists = {
        "sqlite3":(
            """
            SELECT COUNT(*)
            FROM 
                access_tokens
            WHERE
                access_token=(?)
            """
            )
        }
check_if_refresh_token_exists = {
        "sqlite3":(
            """
            SELECT COUNT(*) > 0
            FROM 
                refresh_tokens
            WHERE
                refresh_token=(?)
            """
            )
        }
# USERS
create_table_users = {
        "sqlite3": (
            """
            CREATE TABLE IF NOT EXISTS 
            users (
                user_id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL UNIQUE, 
                username TEXT NOT NULL UNIQUE COLLATE NOCASE, 
                email TEXT UNIQUE COLLATE NOCASE, 
                password TEXT NOT NULL, 
                password_last_updated INTEGER, 
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, 
                two_factor_auth_enabled INTEGER NOT NULL DEFAULT 0
            );
            """
            )
}

create_table_forgotten_passwords= {
        "sqlite3": (
            """
            CREATE TABLE IF NOT EXISTS
            forgotten_passwords (
                guid TEXT PRIMARY KEY NOT NULL,
                expires INTEGER NOT NULL,
                is_active INTEGER NOT NULL DEFAULT 1,
                user_id INTEGER NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(user_id) ON DELETE CASCADE
            )
            """
            )
        }


create_user_record = {
        "sqlite3":(
            """
            INSERT INTO users
            (
            username, password, email
            )
            VALUES ((?), (?), (?))
            """
            )
        }

delete_user = {
        "sqlite3":(
            """
            DELETE 
            FROM 
                users
            WHERE 
                username=(?)
                AND user_id=(?)
            """
            )
        }

get_user_data_by_username_or_email = {
        "sqlite3":(
            """
            SELECT username, email, password, user_id
            FROM users 
            WHERE 
                username=(?) COLLATE NOCASE
            OR
                email=(?) COLLATE NOCASE
            """
            )
        }

check_if_username_exists = {
        "sqlite3":(
            """
            SELECT COUNT(*) > 0
            FROM users 
            WHERE 
                username=(?) COLLATE NOCASE
            """
            )
        }

check_if_email_exists = {
        "sqlite3":(
            """
            SELECT COUNT(*) > 0
            FROM users 
            WHERE 
                email=(?) COLLATE NOCASE
            """
            )
        }

get_user_id_by_username = {
        "sqlite3":(
            """
            SELECT user_id
            FROM users
            WHERE 
                username=(?) COLLATE NOCASE
            """
            )
        }

update_password = {
        "sqlite3":(
            """
            UPDATE users
            SET password = (?)
            WHERE user_id= (?)
            """
            )
        }

create_forgotten_password_record = {
        "sqlite3":(
            """
            INSERT INTO forgotten_passwords
            (guid, expires, user_id)
            VALUES
            ( (?), (?), (?))
            """
            )
        }

deactivate_forgotten_password_records_for_user = {
        "sqlite3": (
            """
            UPDATE forgotten_passwords
            SET is_active=0
            WHERE user_id=(?)
            """
            )
        }

check_if_guid_is_valuable_and_not_expired_for_password_reset = {
        "sqlite3": (
            """
            SELECT 
                COUNT(*) > 0
            FROM
                forgotten_passwords
            WHERE
                guid=(?)
                AND expires > (?)
                AND user_id=(?) 
            """
            )
        }

# LOGINS
create_table_failed_logins = {
        "sqlite3": (
            """
            CREATE TABLE IF NOT EXISTS
            failed_logins (
                user_id INTEGER NOT NULL,
                is_active INTEGER NOT NULL DEFAULT 1,
                issued_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                expires INTEGER NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(user_id) ON DELETE CASCADE
            )
            """
            )
        }

create_failed_login_record = {
        "sqlite3": (
            """
            INSERT INTO failed_logins
            (
                user_id,
                expires
            )
            VALUES
            (
                (?),
                (?)
            )
            """
            )
        }

get_failed_login_attempts = {
        "sqlite3": (
            """
            SELECT
                COUNT (*)
            FROM 
                failed_logins
            WHERE
                user_id= (?)
                AND expires > (?)
                AND is_active=1
            """
            )
        }

reset_failed_login_attempts = {
        "sqlite3": (
            """
            UPDATE 
                failed_logins
            SET
                is_active=0
            WHERE 
                user_id=(?)
            """
            )
        }
