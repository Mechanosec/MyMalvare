import logging
from collections.abc import Iterable

from app.discovery.gharchive import parse_push_events
from app.state import repository as repo

logger = logging.getLogger(__name__)

_PROGRESS_EVERY = 2000


def run_discovery_once(conn, event_lines: Iterable[str]) -> int:
    logger.info("discovery: starting to read events")
    added = 0
    seen = 0
    for repo_id, owner, name in parse_push_events(event_lines):
        seen += 1
        if repo.add_candidate(conn, repo_id, owner, name):
            added += 1
        if seen % _PROGRESS_EVERY == 0:
            logger.info(
                "discovery: processed %d push events, %d new candidates so far",
                seen,
                added,
            )
    logger.info(
        "discovery: finished, %d push events processed, %d new candidates added",
        seen,
        added,
    )
    return added
