import sqlite3
from app.state.db import init_db


def test_init_db_creates_tables(tmp_path):
    conn = init_db(str(tmp_path / "state.db"))
    tables = {
        row["name"]
        for row in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        )
    }
    assert {"candidates", "scanned_repos", "findings"} <= tables


def test_init_db_row_factory_is_row(tmp_path):
    conn = init_db(str(tmp_path / "state.db"))
    conn.execute(
        "INSERT INTO candidates (repo_id, owner, name, discovered_at, status) "
        "VALUES (1, 'octocat', 'hello-world', '2026-09-11T00:00:00Z', 'pending')"
    )
    conn.commit()
    row = conn.execute("SELECT * FROM candidates WHERE repo_id = 1").fetchone()
    assert row["owner"] == "octocat"
