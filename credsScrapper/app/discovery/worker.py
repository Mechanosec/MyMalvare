from collections.abc import Iterable

from app.discovery.gharchive import parse_push_events
from app.state import repository as repo


def run_discovery_once(conn, event_lines: Iterable[str]) -> int:
    added = 0
    for repo_id, owner, name in parse_push_events(event_lines):
        if repo.add_candidate(conn, repo_id, owner, name):
            added += 1
    return added
