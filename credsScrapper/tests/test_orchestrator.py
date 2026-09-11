import subprocess

import pytest

from app.scan.orchestrator import run_scan_loop, scan_repository
from app.state import repository as repo


def _run(cmd, cwd):
    subprocess.run(cmd, cwd=cwd, check=True, capture_output=True, text=True)


@pytest.fixture
def source_repo(tmp_path):
    repo_dir = tmp_path / "source"
    repo_dir.mkdir()
    _run(["git", "init"], repo_dir)
    _run(["git", "config", "user.email", "test@example.com"], repo_dir)
    _run(["git", "config", "user.name", "Test"], repo_dir)
    (repo_dir / "config.py").write_text("AWS_KEY = 'AKIAABCDEFGH12345678'\n")
    _run(["git", "add", "config.py"], repo_dir)
    _run(["git", "commit", "-m", "add key"], repo_dir)
    return repo_dir


def test_scan_repository_writes_findings_and_marks_done(conn, source_repo, tmp_path):
    ref = repo.RepoRef(repo_id=1, owner="octocat", name="hello-world")
    repo.add_candidate(conn, ref.repo_id, ref.owner, ref.name)
    repo.claim_next(conn)

    scan_repository(conn, ref, str(source_repo), str(tmp_path / "work"))

    row = conn.execute(
        "SELECT status FROM scanned_repos WHERE repo_id = 1"
    ).fetchone()
    assert row["status"] == "done"
    assert repo.count_findings(conn, 1) >= 1


def test_scan_repository_marks_failed_on_bad_source(conn, tmp_path):
    ref = repo.RepoRef(repo_id=1, owner="octocat", name="hello-world")
    repo.add_candidate(conn, ref.repo_id, ref.owner, ref.name)
    repo.claim_next(conn)

    scan_repository(conn, ref, str(tmp_path / "does-not-exist"), str(tmp_path / "work"))

    row = conn.execute(
        "SELECT status FROM scanned_repos WHERE repo_id = 1"
    ).fetchone()
    assert row["status"] == "failed"


def test_run_scan_loop_processes_all_pending(conn, source_repo, tmp_path):
    repo.add_candidate(conn, 1, "octocat", "hello-world")
    repo.add_candidate(conn, 2, "octocat", "hello-world-2")

    processed = run_scan_loop(
        conn,
        str(tmp_path / "work"),
        source_url_fn=lambda ref: str(source_repo),
    )

    assert processed == 2
    assert conn.execute(
        "SELECT COUNT(*) AS n FROM scanned_repos WHERE status = 'done'"
    ).fetchone()["n"] == 2


def test_run_scan_loop_does_not_rescan_done_repo(conn, source_repo, tmp_path):
    repo.add_candidate(conn, 1, "octocat", "hello-world")
    run_scan_loop(conn, str(tmp_path / "work1"), source_url_fn=lambda ref: str(source_repo))

    processed_second_run = run_scan_loop(
        conn, str(tmp_path / "work2"), source_url_fn=lambda ref: str(source_repo)
    )

    assert processed_second_run == 0
