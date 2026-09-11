import sqlite3

SCHEMA = """
CREATE TABLE IF NOT EXISTS candidates (
    repo_id INTEGER PRIMARY KEY,
    owner TEXT NOT NULL,
    name TEXT NOT NULL,
    discovered_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
);

CREATE TABLE IF NOT EXISTS scanned_repos (
    repo_id INTEGER PRIMARY KEY,
    owner TEXT NOT NULL,
    name TEXT NOT NULL,
    last_commit_sha TEXT,
    status TEXT NOT NULL,
    started_at TEXT,
    scanned_at TEXT,
    fail_reason TEXT,
    retry_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS findings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    repo_id INTEGER NOT NULL,
    owner TEXT NOT NULL,
    name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    commit_sha TEXT NOT NULL,
    secret_type TEXT NOT NULL,
    secret_value TEXT NOT NULL,
    line_number INTEGER,
    found_at TEXT NOT NULL
);
"""


def init_db(path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    # WAL lets readers proceed while a writer holds the lock, and
    # busy_timeout makes a blocked writer wait instead of erroring
    # immediately - both needed once multiple scan workers share one
    # SQLite file (each worker opens its own connection via init_db).
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=30000")
    conn.executescript(SCHEMA)
    conn.commit()
    return conn


def db_path(conn: sqlite3.Connection) -> str:
    row = conn.execute("PRAGMA database_list").fetchone()
    return row["file"]
