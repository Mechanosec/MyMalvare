import json

from app.discovery.worker import run_discovery_once
from app.state import repository as repo


def _push_event(repo_id, full_name):
    return json.dumps({"type": "PushEvent", "repo": {"id": repo_id, "name": full_name}})


def test_run_discovery_once_adds_new_candidates(conn):
    lines = [_push_event(1, "octocat/hello-world"), _push_event(2, "octocat/other")]
    added = run_discovery_once(conn, lines)
    assert added == 2
    assert repo.is_known(conn, 1) is True
    assert repo.is_known(conn, 2) is True


def test_run_discovery_once_skips_already_known_repo(conn):
    repo.add_candidate(conn, 1, "octocat", "hello-world")
    lines = [_push_event(1, "octocat/hello-world"), _push_event(2, "octocat/other")]
    added = run_discovery_once(conn, lines)
    assert added == 1
