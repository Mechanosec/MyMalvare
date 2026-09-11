import threading
from datetime import datetime, timedelta, timezone

from app.state import repository as repo
from app.state.db import init_db


def test_add_candidate_new_returns_true(conn):
    assert repo.add_candidate(conn, 1, "octocat", "hello-world") is True


def test_add_candidate_duplicate_returns_false(conn):
    repo.add_candidate(conn, 1, "octocat", "hello-world")
    assert repo.add_candidate(conn, 1, "octocat", "hello-world") is False


def test_is_known_false_for_unseen_repo(conn):
    assert repo.is_known(conn, 999) is False


def test_is_known_true_after_add_candidate(conn):
    repo.add_candidate(conn, 1, "octocat", "hello-world")
    assert repo.is_known(conn, 1) is True


def test_claim_next_returns_pending_candidate(conn):
    repo.add_candidate(conn, 1, "octocat", "hello-world")
    ref = repo.claim_next(conn)
    assert ref == repo.RepoRef(repo_id=1, owner="octocat", name="hello-world")


def test_claim_next_marks_in_progress(conn):
    repo.add_candidate(conn, 1, "octocat", "hello-world")
    repo.claim_next(conn)
    row = conn.execute(
        "SELECT status FROM scanned_repos WHERE repo_id = 1"
    ).fetchone()
    assert row["status"] == "in_progress"


def test_claim_next_returns_none_when_empty(conn):
    assert repo.claim_next(conn) is None


def test_claim_next_does_not_reclaim_same_repo_twice(conn):
    repo.add_candidate(conn, 1, "octocat", "hello-world")
    repo.claim_next(conn)
    assert repo.claim_next(conn) is None


def test_mark_done_sets_status_and_sha(conn):
    repo.add_candidate(conn, 1, "octocat", "hello-world")
    repo.claim_next(conn)
    repo.mark_done(conn, 1, "abc123")
    row = conn.execute(
        "SELECT status, last_commit_sha FROM scanned_repos WHERE repo_id = 1"
    ).fetchone()
    assert row["status"] == "done"
    assert row["last_commit_sha"] == "abc123"


def test_done_repo_not_returned_by_claim_next_again(conn):
    repo.add_candidate(conn, 1, "octocat", "hello-world")
    repo.claim_next(conn)
    repo.mark_done(conn, 1, "abc123")
    assert repo.claim_next(conn) is None


def test_mark_failed_increments_retry_count(conn):
    repo.add_candidate(conn, 1, "octocat", "hello-world")
    repo.claim_next(conn)
    repo.mark_failed(conn, 1, "clone timed out")
    repo.mark_failed(conn, 1, "clone timed out again")
    row = conn.execute(
        "SELECT status, retry_count, fail_reason FROM scanned_repos WHERE repo_id = 1"
    ).fetchone()
    assert row["status"] == "failed"
    assert row["retry_count"] == 2
    assert row["fail_reason"] == "clone timed out again"


def test_requeue_stale_resets_old_in_progress(conn):
    repo.add_candidate(conn, 1, "octocat", "hello-world")
    repo.claim_next(conn)
    old_time = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
    conn.execute(
        "UPDATE scanned_repos SET started_at = ? WHERE repo_id = 1", (old_time,)
    )
    conn.commit()
    count = repo.requeue_stale(conn, timeout_seconds=3600)
    assert count == 1
    row = conn.execute(
        "SELECT status FROM scanned_repos WHERE repo_id = 1"
    ).fetchone()
    assert row["status"] == "pending"


def test_requeue_stale_ignores_recent_in_progress(conn):
    repo.add_candidate(conn, 1, "octocat", "hello-world")
    repo.claim_next(conn)
    count = repo.requeue_stale(conn, timeout_seconds=3600)
    assert count == 0


def test_requeued_repo_returned_by_claim_next(conn):
    repo.add_candidate(conn, 1, "octocat", "hello-world")
    repo.claim_next(conn)
    old_time = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
    conn.execute(
        "UPDATE scanned_repos SET started_at = ? WHERE repo_id = 1", (old_time,)
    )
    conn.commit()
    repo.requeue_stale(conn, timeout_seconds=3600)
    ref = repo.claim_next(conn)
    assert ref == repo.RepoRef(repo_id=1, owner="octocat", name="hello-world")


def test_add_finding_and_count(conn):
    repo.add_finding(
        conn,
        repo_id=1,
        owner="octocat",
        name="hello-world",
        file_path="config.py",
        commit_sha="abc123",
        secret_type="aws_access_key",
        secret_value="AKIAABCDEF1234567890",
        line_number=12,
    )
    assert repo.count_findings(conn, 1) == 1


def test_claim_next_no_double_claim_under_concurrent_threads(tmp_path):
    db_file = str(tmp_path / "state.db")
    setup_conn = init_db(db_file)
    for i in range(1, 21):
        repo.add_candidate(setup_conn, i, "octocat", f"repo{i}")
    setup_conn.close()

    claimed: list[int] = []
    claimed_lock = threading.Lock()

    def worker():
        thread_conn = init_db(db_file)
        try:
            while True:
                ref = repo.claim_next(thread_conn)
                if ref is None:
                    break
                with claimed_lock:
                    claimed.append(ref.repo_id)
        finally:
            thread_conn.close()

    threads = [threading.Thread(target=worker) for _ in range(5)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert sorted(claimed) == list(range(1, 21))
    assert len(claimed) == len(set(claimed))
