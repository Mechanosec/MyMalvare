import gzip
import json
import urllib.request
from collections.abc import Iterable, Iterator
from datetime import datetime


def parse_push_events(lines: Iterable[str]) -> Iterator[tuple[int, str, str]]:
    for line in lines:
        try:
            event = json.loads(line)
        except (json.JSONDecodeError, TypeError):
            continue
        if event.get("type") != "PushEvent":
            continue
        repo = event.get("repo") or {}
        full_name = repo.get("name")
        repo_id = repo.get("id")
        if not full_name or repo_id is None or "/" not in full_name:
            continue
        owner, name = full_name.split("/", 1)
        yield repo_id, owner, name


def fetch_hour_lines(dt: datetime) -> Iterator[str]:
    url = f"https://data.gharchive.org/{dt.strftime('%Y-%m-%d-%-H')}.json.gz"
    with urllib.request.urlopen(url) as response:
        with gzip.GzipFile(fileobj=response) as gz:
            for raw_line in gz:
                yield raw_line.decode("utf-8")
