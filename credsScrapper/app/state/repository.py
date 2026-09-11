import sqlite3
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone


@dataclass(frozen=True)
class RepoRef:
    repo_id: int
    owner: str
    name: str


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def add_candidate(conn: sqlite3.Connection, repo_id: int, owner: str, name: str) -> bool:
    if is_known(conn, repo_id):
        return False
    conn.execute(
        "INSERT INTO candidates (repo_id, owner, name, discovered_at, status) "
        "VALUES (?, ?, ?, ?, 'pending')",
        (repo_id, owner, name, _now()),
    )
    conn.commit()
    return True


def is_known(conn: sqlite3.Connection, repo_id: int) -> bool:
    row = conn.execute(
        "SELECT 1 FROM candidates WHERE repo_id = ? "
        "UNION SELECT 1 FROM scanned_repos WHERE repo_id = ?",
        (repo_id, repo_id),
    ).fetchone()
    return row is not None


def claim_next(conn: sqlite3.Connection) -> RepoRef | None:
    row = conn.execute(
        "SELECT repo_id, owner, name FROM candidates WHERE status = 'pending' "
        "ORDER BY discovered_at LIMIT 1"
    ).fetchone()
    if row is not None:
        conn.execute(
            "UPDATE candidates SET status = 'claimed' WHERE repo_id = ?",
            (row["repo_id"],),
        )
        conn.execute(
            "INSERT INTO scanned_repos (repo_id, owner, name, status, started_at, retry_count) "
            "VALUES (?, ?, ?, 'in_progress', ?, 0)",
            (row["repo_id"], row["owner"], row["name"], _now()),
        )
        conn.commit()
        return RepoRef(row["repo_id"], row["owner"], row["name"])

    row = conn.execute(
        "SELECT repo_id, owner, name FROM scanned_repos WHERE status = 'pending' "
        "ORDER BY repo_id LIMIT 1"
    ).fetchone()
    if row is None:
        return None
    conn.execute(
        "UPDATE scanned_repos SET status = 'in_progress', started_at = ? WHERE repo_id = ?",
        (_now(), row["repo_id"]),
    )
    conn.commit()
    return RepoRef(row["repo_id"], row["owner"], row["name"])


def mark_done(conn: sqlite3.Connection, repo_id: int, last_commit_sha: str) -> None:
    conn.execute(
        "UPDATE scanned_repos SET status = 'done', last_commit_sha = ?, scanned_at = ? "
        "WHERE repo_id = ?",
        (last_commit_sha, _now(), repo_id),
    )
    conn.commit()


def mark_failed(conn: sqlite3.Connection, repo_id: int, reason: str) -> None:
    conn.execute(
        "UPDATE scanned_repos SET status = 'failed', fail_reason = ?, "
        "retry_count = retry_count + 1 WHERE repo_id = ?",
        (reason, repo_id),
    )
    conn.commit()


def requeue_stale(conn: sqlite3.Connection, timeout_seconds: int) -> int:
    cutoff = (datetime.now(timezone.utc) - timedelta(seconds=timeout_seconds)).isoformat()
    cur = conn.execute(
        "UPDATE scanned_repos SET status = 'pending' "
        "WHERE status = 'in_progress' AND started_at < ?",
        (cutoff,),
    )
    conn.commit()
    return cur.rowcount


def add_finding(
    conn: sqlite3.Connection,
    repo_id: int,
    owner: str,
    name: str,
    file_path: str,
    commit_sha: str,
    secret_type: str,
    secret_value: str,
    line_number: int,
) -> None:
    conn.execute(
        "INSERT INTO findings "
        "(repo_id, owner, name, file_path, commit_sha, secret_type, secret_value, "
        "line_number, found_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (repo_id, owner, name, file_path, commit_sha, secret_type, secret_value, line_number, _now()),
    )
    conn.commit()


def count_findings(conn: sqlite3.Connection, repo_id: int) -> int:
    row = conn.execute(
        "SELECT COUNT(*) AS n FROM findings WHERE repo_id = ?", (repo_id,)
    ).fetchone()
    return row["n"]
