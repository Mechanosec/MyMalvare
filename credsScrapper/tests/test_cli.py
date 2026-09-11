import subprocess

import pytest

from app.cli import build_clone_url, main
from app.state import repository as repo
from app.state.db import init_db
from app.state.repository import RepoRef


def _run(cmd, cwd):
    subprocess.run(cmd, cwd=cwd, check=True, capture_output=True, text=True)


def test_build_clone_url():
    ref = RepoRef(repo_id=1, owner="octocat", name="hello-world")
    assert build_clone_url(ref) == "https://github.com/octocat/hello-world.git"


def test_scan_command_processes_pending_candidates(tmp_path, monkeypatch):
    source_repo = tmp_path / "source"
    source_repo.mkdir()
    _run(["git", "init"], source_repo)
    _run(["git", "config", "user.email", "test@example.com"], source_repo)
    _run(["git", "config", "user.name", "Test"], source_repo)
    (source_repo / "a.py").write_text("SAFE = 1\n")
    _run(["git", "add", "a.py"], source_repo)
    _run(["git", "commit", "-m", "init"], source_repo)

    db_path = tmp_path / "state.db"
    conn = init_db(str(db_path))
    repo.add_candidate(conn, 1, "octocat", "hello-world")
    conn.close()

    monkeypatch.setattr("app.cli.build_clone_url", lambda ref: str(source_repo))

    exit_code = main([
        "scan",
        "--db", str(db_path),
        "--workdir", str(tmp_path / "work"),
        "--log-file", str(tmp_path / "scan.log"),
    ])

    assert exit_code == 0
    conn = init_db(str(db_path))
    row = conn.execute("SELECT status FROM scanned_repos WHERE repo_id = 1").fetchone()
    assert row["status"] == "done"


def test_main_requires_a_subcommand():
    with pytest.raises(SystemExit):
        main([])
