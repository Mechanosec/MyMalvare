import json

from app.discovery.gharchive import parse_push_events


def _push_event(repo_id, full_name):
    return json.dumps({"type": "PushEvent", "repo": {"id": repo_id, "name": full_name}})


def test_parse_push_events_extracts_owner_and_name():
    lines = [_push_event(1, "octocat/hello-world")]
    result = list(parse_push_events(lines))
    assert result == [(1, "octocat", "hello-world")]


def test_parse_push_events_skips_non_push_events():
    lines = [json.dumps({"type": "WatchEvent", "repo": {"id": 2, "name": "a/b"}})]
    assert list(parse_push_events(lines)) == []


def test_parse_push_events_skips_malformed_json():
    lines = ["not json", _push_event(3, "octocat/other")]
    assert list(parse_push_events(lines)) == [(3, "octocat", "other")]


def test_parse_push_events_handles_multiple_lines():
    lines = [_push_event(1, "a/b"), _push_event(2, "c/d")]
    assert list(parse_push_events(lines)) == [(1, "a", "b"), (2, "c", "d")]
