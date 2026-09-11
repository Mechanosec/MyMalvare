# credsScrapper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a resumable Python CLI that discovers public GitHub repositories, clones them, and scans both current file contents and full commit history for leaked secrets, storing findings in SQLite.

**Architecture:** Four independent modules composed by a CLI: a SQLite-backed state store (candidates / scanned_repos / findings), a pure-Python detection engine (regex + Shannon entropy), git-based scan orchestration (clone --bare, scan HEAD tree, scan full `git log -p` history), and a GH Archive-based discovery worker. State store and detection engine have no dependency on each other and are built first; orchestrator and discovery both depend on the state store; CLI wires everything together last.

**Tech Stack:** Python 3.14 standard library only (sqlite3, re, subprocess, urllib, gzip, json, argparse, dataclasses). Dev-only dependency: pytest (via venv).

**Spec:** `docs/superpowers/specs/2026-09-11-credscrapper-design.md`

## Global Constraints

- Implementation language is Python — no other language, no shelling out to non-Python detector binaries (gitleaks/TruffleHog).
- Detection is passive only: never make a network call authenticating as a discovered credential.
- No test may hit real GitHub/GH Archive network endpoints — use local fixtures (a real local git repo built by the test, in-memory event data).
- SQLite is the only state store for this pass — no Postgres, no ORM.
- Findings are stored as plaintext (`secret_value` raw) for this MVP — do not add encryption/hashing/masking in this pass, it's an explicit later step.
- Every repo write to `scanned_repos`/`findings` must be resumable: a stopped-and-restarted run must never re-scan a `done` repo, and a crashed `in_progress` repo must be recoverable.

---

## File Structure

```
credsScrapper/
  pyproject.toml
  requirements-dev.txt
  credsscrapper/
    __init__.py
    __main__.py
    cli.py
    state/
      __init__.py
      db.py
      repository.py
    detection/
      __init__.py
      patterns.py
      entropy.py
      engine.py
    scan/
      __init__.py
      git_ops.py
      orchestrator.py
    discovery/
      __init__.py
      gharchive.py
      worker.py
  tests/
    __init__.py
    conftest.py
    test_db.py
    test_repository.py
    test_entropy.py
    test_patterns.py
    test_engine.py
    test_git_ops.py
    test_orchestrator.py
    test_gharchive.py
    test_worker.py
    test_cli.py
```

---

### Task 1: Project scaffolding + venv + SQLite state store

**Files:**
- Create: `credsScrapper/pyproject.toml`
- Create: `credsScrapper/requirements-dev.txt`
- Create: `credsScrapper/credsscrapper/__init__.py`
- Create: `credsScrapper/credsscrapper/state/__init__.py`
- Create: `credsScrapper/credsscrapper/state/db.py`
- Create: `credsScrapper/credsscrapper/state/repository.py`
- Test: `credsScrapper/tests/__init__.py`
- Test: `credsScrapper/tests/conftest.py`
- Test: `credsScrapper/tests/test_db.py`
- Test: `credsScrapper/tests/test_repository.py`

**Interfaces:**
- Produces (used by every later task):
  - `credsscrapper.state.db.init_db(path: str) -> sqlite3.Connection` — creates tables if missing, returns a connection with `row_factory = sqlite3.Row`, foreign keys off (single-file, no FKs needed).
  - `credsscrapper.state.repository.RepoRef` — `@dataclass(frozen=True)` with fields `repo_id: int`, `owner: str`, `name: str`.
  - `credsscrapper.state.repository.add_candidate(conn, repo_id: int, owner: str, name: str) -> bool` — returns `True` if a new row was inserted, `False` if `repo_id` already exists in `candidates` or `scanned_repos`.
  - `credsscrapper.state.repository.is_known(conn, repo_id: int) -> bool`
  - `credsscrapper.state.repository.claim_next(conn) -> RepoRef | None` — atomically picks one pending unit of work (a `candidates` row with `status='pending'`, or a `scanned_repos` row with `status='pending'` from a requeue), moves/creates the corresponding `scanned_repos` row to `status='in_progress'` with `started_at=<utc now iso>`, removes/marks the `candidates` row `status='claimed'`, and returns the `RepoRef`. Returns `None` if nothing pending.
  - `credsscrapper.state.repository.mark_done(conn, repo_id: int, last_commit_sha: str) -> None`
  - `credsscrapper.state.repository.mark_failed(conn, repo_id: int, reason: str) -> None` — increments `retry_count`.
  - `credsscrapper.state.repository.requeue_stale(conn, timeout_seconds: int) -> int` — sets `scanned_repos.status` from `'in_progress'` to `'pending'` where `started_at` is older than `timeout_seconds`; returns count of rows changed.
  - `credsscrapper.state.repository.add_finding(conn, repo_id: int, owner: str, name: str, file_path: str, commit_sha: str, secret_type: str, secret_value: str, line_number: int) -> None`
  - `credsscrapper.state.repository.count_findings(conn, repo_id: int) -> int` — test helper, also useful for CLI summaries later.

- [ ] **Step 1: Create venv and install pytest**

```bash
cd /home/mechanosec/PetProjects/MyMalvare/credsScrapper
python3 -m venv .venv
.venv/bin/pip install --upgrade pip
echo "pytest==8.3.3" > requirements-dev.txt
.venv/bin/pip install -r requirements-dev.txt
```

- [ ] **Step 2: Create package skeleton and pyproject.toml**

`credsScrapper/pyproject.toml`:
```toml
[project]
name = "credsscrapper"
version = "0.1.0"
requires-python = ">=3.10"

[tool.pytest.ini_options]
testpaths = ["tests"]
```

Create empty `credsscrapper/__init__.py`, `credsscrapper/state/__init__.py`, `tests/__init__.py`.

- [ ] **Step 3: Write failing tests for `init_db`**

`tests/test_db.py`:
```python
import sqlite3
from credsscrapper.state.db import init_db


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
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `.venv/bin/pytest tests/test_db.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'credsscrapper.state.db'`

- [ ] **Step 5: Implement `credsscrapper/state/db.py`**

```python
import sqlite3

SCHEMA = """
CREATE TABLE IF NOT EXISTS candidates (
    repo_id INTEGER PRIMARY KEY,
    owner TEXT NOT NULL,
    name TEXT NOT NULL,
    discovered_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
);

CREATE TABLE IF NOT EXISTS scanned_repos (
    repo_id INTEGER PRIMARY KEY,
    owner TEXT NOT NULL,
    name TEXT NOT NULL,
    last_commit_sha TEXT,
    status TEXT NOT NULL,
    started_at TEXT,
    scanned_at TEXT,
    fail_reason TEXT,
    retry_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS findings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    repo_id INTEGER NOT NULL,
    owner TEXT NOT NULL,
    name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    commit_sha TEXT NOT NULL,
    secret_type TEXT NOT NULL,
    secret_value TEXT NOT NULL,
    line_number INTEGER,
    found_at TEXT NOT NULL
);
"""


def init_db(path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    conn.commit()
    return conn
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `.venv/bin/pytest tests/test_db.py -v`
Expected: PASS (2 tests)

- [ ] **Step 7: Commit**

```bash
git add credsScrapper/pyproject.toml credsScrapper/requirements-dev.txt \
  credsScrapper/credsscrapper/__init__.py credsScrapper/credsscrapper/state/__init__.py \
  credsScrapper/credsscrapper/state/db.py credsScrapper/tests/__init__.py \
  credsScrapper/tests/test_db.py
git commit -m "feat: add SQLite schema init for credsScrapper state store"
```

- [ ] **Step 8: Write `tests/conftest.py` shared fixture**

```python
import pytest

from credsscrapper.state.db import init_db


@pytest.fixture
def conn(tmp_path):
    return init_db(str(tmp_path / "state.db"))
```

- [ ] **Step 9: Write failing tests for repository functions**

`tests/test_repository.py`:
```python
from datetime import datetime, timedelta, timezone

from credsscrapper.state import repository as repo


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
```

- [ ] **Step 10: Run tests to verify they fail**

Run: `.venv/bin/pytest tests/test_repository.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'credsscrapper.state.repository'`

- [ ] **Step 11: Implement `credsscrapper/state/repository.py`**

```python
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
```

- [ ] **Step 12: Run tests to verify they pass**

Run: `.venv/bin/pytest tests/test_repository.py -v`
Expected: PASS (14 tests)

- [ ] **Step 13: Commit**

```bash
git add credsScrapper/credsscrapper/state/repository.py credsScrapper/tests/conftest.py \
  credsScrapper/tests/test_repository.py
git commit -m "feat: add resumable candidate/scan-state repository"
```

---

### Task 2: Detection engine — regex patterns

**Files:**
- Create: `credsscrapper/detection/__init__.py`
- Create: `credsscrapper/detection/patterns.py`
- Test: `tests/test_patterns.py`

**Interfaces:**
- Produces: `credsscrapper.detection.patterns.PATTERNS: list[tuple[str, re.Pattern]]` — `(secret_type_name, compiled_regex)` pairs. Consumed by Task 4's `engine.py`.

- [ ] **Step 1: Write failing tests**

`tests/test_patterns.py`:
```python
from credsscrapper.detection.patterns import PATTERNS


def _match_any(text):
    hits = []
    for secret_type, pattern in PATTERNS:
        for m in pattern.finditer(text):
            hits.append((secret_type, m.group(0)))
    return hits


def test_detects_aws_access_key():
    hits = _match_any('aws_key = "AKIAABCDEFGH12345678"')
    assert ("aws_access_key", "AKIAABCDEFGH12345678") in hits


def test_detects_github_pat():
    token = "ghp_" + "a" * 36
    hits = _match_any(f'GITHUB_TOKEN = "{token}"')
    assert ("github_pat", token) in hits


def test_detects_stripe_live_key():
    key = "sk_live_" + "b" * 24
    hits = _match_any(f'STRIPE_KEY = "{key}"')
    assert ("stripe_live_key", key) in hits


def test_no_false_positive_on_normal_code():
    hits = _match_any("def handler(request, response):\n    return {'status': 'ok'}")
    assert hits == []
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/pytest tests/test_patterns.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'credsscrapper.detection'`

- [ ] **Step 3: Implement `credsscrapper/detection/patterns.py`**

```python
import re

PATTERNS: list[tuple[str, re.Pattern]] = [
    ("aws_access_key", re.compile(r"AKIA[0-9A-Z]{16}")),
    ("github_pat", re.compile(r"ghp_[A-Za-z0-9]{36}")),
    ("stripe_live_key", re.compile(r"sk_live_[A-Za-z0-9]{24}")),
]
```

Create empty `credsscrapper/detection/__init__.py`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/pytest tests/test_patterns.py -v`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add credsScrapper/credsscrapper/detection/__init__.py \
  credsScrapper/credsscrapper/detection/patterns.py credsScrapper/tests/test_patterns.py
git commit -m "feat: add regex secret patterns"
```

---

### Task 3: Detection engine — Shannon entropy

**Files:**
- Create: `credsscrapper/detection/entropy.py`
- Test: `tests/test_entropy.py`

**Interfaces:**
- Produces: `credsscrapper.detection.entropy.shannon_entropy(s: str) -> float`; `credsscrapper.detection.entropy.ENTROPY_THRESHOLD: float = 4.0`; `credsscrapper.detection.entropy.GENERIC_TOKEN_RE: re.Pattern` (matches `[A-Za-z0-9+/=]{32,}`); `credsscrapper.detection.entropy.find_high_entropy_tokens(text: str) -> list[str]`. Consumed by Task 4's `engine.py`.

- [ ] **Step 1: Write failing tests**

`tests/test_entropy.py`:
```python
from credsscrapper.detection.entropy import (
    find_high_entropy_tokens,
    shannon_entropy,
)


def test_entropy_of_empty_string_is_zero():
    assert shannon_entropy("") == 0.0


def test_entropy_of_repeated_char_is_zero():
    assert shannon_entropy("aaaaaaaa") == 0.0


def test_entropy_of_random_looking_token_is_high():
    assert shannon_entropy("Xk9pQ2mZ7vL4tR8wN1cJ6hF3sD0aY5b") > 4.0


def test_find_high_entropy_tokens_skips_short_tokens():
    assert find_high_entropy_tokens("short abc123") == []


def test_find_high_entropy_tokens_finds_random_looking_token():
    token = "Xk9pQ2mZ7vL4tR8wN1cJ6hF3sD0aY5bE9"
    hits = find_high_entropy_tokens(f"SECRET = '{token}'")
    assert token in hits


def test_find_high_entropy_tokens_skips_low_entropy_long_token():
    token = "a" * 40
    hits = find_high_entropy_tokens(f"PADDING = '{token}'")
    assert token not in hits
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/pytest tests/test_entropy.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'credsscrapper.detection.entropy'`

- [ ] **Step 3: Implement `credsscrapper/detection/entropy.py`**

```python
import math
import re
from collections import Counter

ENTROPY_THRESHOLD = 4.0
GENERIC_TOKEN_RE = re.compile(r"[A-Za-z0-9+/=]{32,}")


def shannon_entropy(s: str) -> float:
    if not s:
        return 0.0
    counts = Counter(s)
    length = len(s)
    return -sum((c / length) * math.log2(c / length) for c in counts.values())


def find_high_entropy_tokens(text: str) -> list[str]:
    return [
        token
        for token in GENERIC_TOKEN_RE.findall(text)
        if shannon_entropy(token) > ENTROPY_THRESHOLD
    ]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/pytest tests/test_entropy.py -v`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add credsScrapper/credsscrapper/detection/entropy.py credsScrapper/tests/test_entropy.py
git commit -m "feat: add Shannon entropy detector for generic secrets"
```

---

### Task 4: Detection engine — combined scan with line numbers

**Files:**
- Create: `credsscrapper/detection/engine.py`
- Test: `tests/test_engine.py`

**Interfaces:**
- Consumes: `credsscrapper.detection.patterns.PATTERNS` (Task 2), `credsscrapper.detection.entropy.find_high_entropy_tokens` (Task 3).
- Produces: `credsscrapper.detection.engine.Finding` — `@dataclass(frozen=True)` with `secret_type: str`, `secret_value: str`, `line_number: int`. `credsscrapper.detection.engine.scan_text(text: str) -> list[Finding]`. Consumed by Task 6's `orchestrator.py`.

- [ ] **Step 1: Write failing tests**

`tests/test_engine.py`:
```python
from credsscrapper.detection.engine import Finding, scan_text


def test_scan_text_finds_pattern_match_with_line_number():
    text = "line one\nline two\naws_key = 'AKIAABCDEFGH12345678'\n"
    findings = scan_text(text)
    assert Finding("aws_access_key", "AKIAABCDEFGH12345678", 3) in findings


def test_scan_text_finds_high_entropy_token():
    token = "Xk9pQ2mZ7vL4tR8wN1cJ6hF3sD0aY5bE9"
    text = f"SECRET = '{token}'\n"
    findings = scan_text(text)
    assert any(f.secret_type == "generic_high_entropy" and f.secret_value == token for f in findings)


def test_scan_text_no_findings_on_clean_code():
    text = "def handler(request, response):\n    return {'status': 'ok'}\n"
    assert scan_text(text) == []


def test_scan_text_does_not_double_count_pattern_match_as_entropy_hit():
    text = "GITHUB_TOKEN = 'ghp_" + "a" * 36 + "'\n"
    findings = scan_text(text)
    types = [f.secret_type for f in findings]
    assert types.count("github_pat") == 1
    assert "generic_high_entropy" not in types
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/pytest tests/test_engine.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'credsscrapper.detection.engine'`

- [ ] **Step 3: Implement `credsscrapper/detection/engine.py`**

```python
from dataclasses import dataclass

from credsscrapper.detection.entropy import find_high_entropy_tokens
from credsscrapper.detection.patterns import PATTERNS


@dataclass(frozen=True)
class Finding:
    secret_type: str
    secret_value: str
    line_number: int


def _line_number_at(text: str, offset: int) -> int:
    return text.count("\n", 0, offset) + 1


def scan_text(text: str) -> list[Finding]:
    findings: list[Finding] = []
    matched_spans: list[tuple[int, int]] = []

    for secret_type, pattern in PATTERNS:
        for m in pattern.finditer(text):
            findings.append(Finding(secret_type, m.group(0), _line_number_at(text, m.start())))
            matched_spans.append(m.span())

    for token in find_high_entropy_tokens(text):
        start = text.find(token)
        if start == -1:
            continue
        if any(start >= s and start < e for s, e in matched_spans):
            continue
        findings.append(Finding("generic_high_entropy", token, _line_number_at(text, start)))

    return findings
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/pytest tests/test_engine.py -v`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add credsScrapper/credsscrapper/detection/engine.py credsScrapper/tests/test_engine.py
git commit -m "feat: combine pattern and entropy detectors into scan_text"
```

---

### Task 5: Git operations wrapper

**Files:**
- Create: `credsscrapper/scan/__init__.py`
- Create: `credsscrapper/scan/git_ops.py`
- Test: `tests/test_git_ops.py`

**Interfaces:**
- Produces (consumed by Task 6's `orchestrator.py`):
  - `credsscrapper.scan.git_ops.clone_bare(source: str, dest_dir: str) -> None`
  - `credsscrapper.scan.git_ops.get_head_commit(repo_path: str) -> str`
  - `credsscrapper.scan.git_ops.list_files_at_head(repo_path: str) -> list[str]`
  - `credsscrapper.scan.git_ops.read_file_at_head(repo_path: str, file_path: str) -> str`
  - `credsscrapper.scan.git_ops.iter_commit_diffs(repo_path: str) -> Iterator[tuple[str, str]]` — yields `(commit_sha, diff_text)` for every commit in the repo, oldest details included, via `git log -p`.

- [ ] **Step 1: Write failing tests using a local fixture repo**

`tests/test_git_ops.py`:
```python
import subprocess

import pytest

from credsscrapper.scan.git_ops import (
    clone_bare,
    get_head_commit,
    iter_commit_diffs,
    list_files_at_head,
    read_file_at_head,
)


def _run(cmd, cwd):
    subprocess.run(cmd, cwd=cwd, check=True, capture_output=True, text=True)


@pytest.fixture
def source_repo(tmp_path):
    repo_dir = tmp_path / "source"
    repo_dir.mkdir()
    _run(["git", "init"], repo_dir)
    _run(["git", "config", "user.email", "test@example.com"], repo_dir)
    _run(["git", "config", "user.name", "Test"], repo_dir)

    (repo_dir / "config.py").write_text("SAFE = 'nothing here'\n")
    _run(["git", "add", "config.py"], repo_dir)
    _run(["git", "commit", "-m", "initial commit"], repo_dir)

    (repo_dir / "config.py").write_text("AWS_KEY = 'AKIAABCDEFGH12345678'\n")
    _run(["git", "add", "config.py"], repo_dir)
    _run(["git", "commit", "-m", "oops, added a key"], repo_dir)

    (repo_dir / "config.py").write_text("SAFE = 'nothing here'\n")
    _run(["git", "add", "config.py"], repo_dir)
    _run(["git", "commit", "-m", "remove key"], repo_dir)

    return repo_dir


@pytest.fixture
def bare_clone(source_repo, tmp_path):
    dest = tmp_path / "bare"
    clone_bare(str(source_repo), str(dest))
    return dest


def test_clone_bare_creates_repo(bare_clone):
    assert (bare_clone / "HEAD").exists()


def test_get_head_commit_returns_40_char_sha(bare_clone):
    sha = get_head_commit(str(bare_clone))
    assert len(sha) == 40


def test_list_files_at_head(bare_clone):
    assert list_files_at_head(str(bare_clone)) == ["config.py"]


def test_read_file_at_head_reflects_final_state(bare_clone):
    content = read_file_at_head(str(bare_clone), "config.py")
    assert "AKIA" not in content
    assert "SAFE" in content


def test_iter_commit_diffs_includes_removed_secret(bare_clone):
    all_diff_text = "\n".join(diff for _, diff in iter_commit_diffs(str(bare_clone)))
    assert "AKIAABCDEFGH12345678" in all_diff_text


def test_iter_commit_diffs_yields_three_commits(bare_clone):
    shas = [sha for sha, _ in iter_commit_diffs(str(bare_clone))]
    assert len(shas) == 3
    assert len(set(shas)) == 3
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/pytest tests/test_git_ops.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'credsscrapper.scan'`

- [ ] **Step 3: Implement `credsscrapper/scan/git_ops.py`**

```python
import re
import subprocess
from typing import Iterator


def _run(args: list[str], cwd: str | None = None) -> str:
    result = subprocess.run(
        args, cwd=cwd, check=True, capture_output=True, text=True
    )
    return result.stdout


def clone_bare(source: str, dest_dir: str) -> None:
    _run(["git", "clone", "--bare", source, dest_dir])


def get_head_commit(repo_path: str) -> str:
    return _run(["git", "-C", repo_path, "rev-parse", "HEAD"]).strip()


def list_files_at_head(repo_path: str) -> list[str]:
    output = _run(["git", "-C", repo_path, "ls-tree", "-r", "--name-only", "HEAD"])
    return [line for line in output.splitlines() if line]


def read_file_at_head(repo_path: str, file_path: str) -> str:
    return _run(["git", "-C", repo_path, "show", f"HEAD:{file_path}"])


_COMMIT_HEADER_RE = re.compile(r"(?m)^commit ([0-9a-f]{40})(?: .*)?$")


def iter_commit_diffs(repo_path: str) -> Iterator[tuple[str, str]]:
    output = _run(["git", "-C", repo_path, "log", "-p", "--full-history"])
    matches = list(_COMMIT_HEADER_RE.finditer(output))
    for i, match in enumerate(matches):
        sha = match.group(1)
        start = match.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(output)
        yield sha, output[start:end]
```

Create empty `credsscrapper/scan/__init__.py`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/pytest tests/test_git_ops.py -v`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add credsScrapper/credsscrapper/scan/__init__.py credsScrapper/credsscrapper/scan/git_ops.py \
  credsScrapper/tests/test_git_ops.py
git commit -m "feat: add git_ops wrapper for bare clone, tree, and history diffs"
```

---

### Task 6: Scan orchestrator

**Files:**
- Create: `credsscrapper/scan/orchestrator.py`
- Test: `tests/test_orchestrator.py`

**Interfaces:**
- Consumes: `credsscrapper.state.repository.{RepoRef, claim_next, mark_done, mark_failed, requeue_stale, add_finding}` (Task 1), `credsscrapper.detection.engine.scan_text` (Task 4), `credsscrapper.scan.git_ops.{clone_bare, get_head_commit, list_files_at_head, read_file_at_head, iter_commit_diffs}` (Task 5).
- Produces (consumed by Task 8's `cli.py`):
  - `credsscrapper.scan.orchestrator.scan_repository(conn, repo_ref, clone_source: str, workdir: str) -> None` — clones `clone_source` into `workdir`, scans HEAD tree and full history, writes findings, calls `mark_done`/`mark_failed`.
  - `credsscrapper.scan.orchestrator.run_scan_loop(conn, workdir_root: str, source_url_fn, stale_timeout_seconds: int = 3600, max_repos: int | None = None) -> int` — calls `requeue_stale` once, then repeatedly `claim_next` + `scan_repository` until no work remains or `max_repos` reached; `source_url_fn(repo_ref) -> str` builds the clone URL/path for a `RepoRef` (kept injectable so tests don't need real GitHub URLs). Returns count of repos processed.

- [ ] **Step 1: Write failing tests using a local fixture repo as the clone source**

`tests/test_orchestrator.py`:
```python
import subprocess

import pytest

from credsscrapper.scan.orchestrator import run_scan_loop, scan_repository
from credsscrapper.state import repository as repo


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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/pytest tests/test_orchestrator.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'credsscrapper.scan.orchestrator'`

- [ ] **Step 3: Implement `credsscrapper/scan/orchestrator.py`**

```python
import os
import shutil
from typing import Callable

from credsscrapper.detection.engine import scan_text
from credsscrapper.scan.git_ops import (
    clone_bare,
    get_head_commit,
    iter_commit_diffs,
    list_files_at_head,
    read_file_at_head,
)
from credsscrapper.state import repository as repo
from credsscrapper.state.repository import RepoRef


def scan_repository(conn, repo_ref: RepoRef, clone_source: str, workdir: str) -> None:
    if os.path.exists(workdir):
        shutil.rmtree(workdir)

    try:
        clone_bare(clone_source, workdir)
        head_sha = get_head_commit(workdir)

        for file_path in list_files_at_head(workdir):
            text = read_file_at_head(workdir, file_path)
            for finding in scan_text(text):
                repo.add_finding(
                    conn,
                    repo_ref.repo_id,
                    repo_ref.owner,
                    repo_ref.name,
                    file_path,
                    head_sha,
                    finding.secret_type,
                    finding.secret_value,
                    finding.line_number,
                )

        for commit_sha, diff_text in iter_commit_diffs(workdir):
            for finding in scan_text(diff_text):
                repo.add_finding(
                    conn,
                    repo_ref.repo_id,
                    repo_ref.owner,
                    repo_ref.name,
                    "<commit-diff>",
                    commit_sha,
                    finding.secret_type,
                    finding.secret_value,
                    finding.line_number,
                )

        repo.mark_done(conn, repo_ref.repo_id, head_sha)
    except Exception as exc:  # noqa: BLE001 - broad on purpose: any clone/scan failure is recoverable via retry
        repo.mark_failed(conn, repo_ref.repo_id, str(exc))
    finally:
        if os.path.exists(workdir):
            shutil.rmtree(workdir)


def run_scan_loop(
    conn,
    workdir_root: str,
    source_url_fn: Callable[[RepoRef], str],
    stale_timeout_seconds: int = 3600,
    max_repos: int | None = None,
) -> int:
    repo.requeue_stale(conn, stale_timeout_seconds)
    os.makedirs(workdir_root, exist_ok=True)

    processed = 0
    while max_repos is None or processed < max_repos:
        ref = repo.claim_next(conn)
        if ref is None:
            break
        workdir = os.path.join(workdir_root, f"repo-{ref.repo_id}")
        scan_repository(conn, ref, source_url_fn(ref), workdir)
        processed += 1

    return processed
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/pytest tests/test_orchestrator.py -v`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add credsScrapper/credsscrapper/scan/orchestrator.py credsScrapper/tests/test_orchestrator.py
git commit -m "feat: add resumable scan orchestrator"
```

---

### Task 7: Discovery worker (GH Archive)

**Files:**
- Create: `credsscrapper/discovery/__init__.py`
- Create: `credsscrapper/discovery/gharchive.py`
- Create: `credsscrapper/discovery/worker.py`
- Test: `tests/test_gharchive.py`
- Test: `tests/test_worker.py`

**Interfaces:**
- Consumes: `credsscrapper.state.repository.{add_candidate, is_known}` (Task 1).
- Produces (consumed by Task 8's `cli.py`):
  - `credsscrapper.discovery.gharchive.parse_push_events(lines: Iterable[str]) -> Iterator[tuple[int, str, str]]` — yields `(repo_id, owner, name)` for every `PushEvent` JSON line; skips malformed lines and non-PushEvent lines.
  - `credsscrapper.discovery.gharchive.fetch_hour_lines(dt: datetime) -> Iterator[str]` — downloads `https://data.gharchive.org/{YYYY-MM-DD-H}.json.gz` and yields decoded JSON lines. Thin I/O wrapper, not unit-tested against the network (per Global Constraints).
  - `credsscrapper.discovery.worker.run_discovery_once(conn, event_lines: Iterable[str]) -> int` — parses events, adds unknown repos as candidates, returns count added.

- [ ] **Step 1: Write failing tests for parsing**

`tests/test_gharchive.py`:
```python
import json

from credsscrapper.discovery.gharchive import parse_push_events


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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/pytest tests/test_gharchive.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'credsscrapper.discovery'`

- [ ] **Step 3: Implement `credsscrapper/discovery/gharchive.py`**

```python
import gzip
import json
import urllib.request
from datetime import datetime
from typing import Iterable, Iterator


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
```

Create empty `credsscrapper/discovery/__init__.py`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/pytest tests/test_gharchive.py -v`
Expected: PASS (4 tests)

- [ ] **Step 5: Write failing tests for the worker**

`tests/test_worker.py`:
```python
import json

from credsscrapper.discovery.worker import run_discovery_once
from credsscrapper.state import repository as repo


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
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `.venv/bin/pytest tests/test_worker.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'credsscrapper.discovery.worker'`

- [ ] **Step 7: Implement `credsscrapper/discovery/worker.py`**

```python
from typing import Iterable

from credsscrapper.discovery.gharchive import parse_push_events
from credsscrapper.state import repository as repo


def run_discovery_once(conn, event_lines: Iterable[str]) -> int:
    added = 0
    for repo_id, owner, name in parse_push_events(event_lines):
        if repo.add_candidate(conn, repo_id, owner, name):
            added += 1
    return added
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `.venv/bin/pytest tests/test_worker.py -v`
Expected: PASS (2 tests)

- [ ] **Step 9: Commit**

```bash
git add credsScrapper/credsscrapper/discovery/ credsScrapper/tests/test_gharchive.py \
  credsScrapper/tests/test_worker.py
git commit -m "feat: add GH Archive discovery parsing and worker"
```

---

### Task 8: CLI wiring

**Files:**
- Create: `credsscrapper/cli.py`
- Create: `credsscrapper/__main__.py`
- Test: `tests/test_cli.py`

**Interfaces:**
- Consumes: `credsscrapper.state.db.init_db` (Task 1), `credsscrapper.scan.orchestrator.run_scan_loop` (Task 6), `credsscrapper.discovery.gharchive.fetch_hour_lines` (Task 7), `credsscrapper.discovery.worker.run_discovery_once` (Task 7).
- Produces: `credsscrapper.cli.build_clone_url(repo_ref) -> str` — `https://github.com/{owner}/{name}.git`. `credsscrapper.cli.main(argv: list[str] | None = None) -> int` — argparse entry point with subcommands `discover` and `scan`; both take `--db PATH` (default `state.db`) and `--workdir PATH` (default `workdir`, scan-only); `scan` also takes `--max-repos N` (default: no limit) and `--stale-timeout SECONDS` (default 3600).

- [ ] **Step 1: Write failing tests**

`tests/test_cli.py`:
```python
import subprocess

import pytest

from credsscrapper.cli import build_clone_url, main
from credsscrapper.state import repository as repo
from credsscrapper.state.db import init_db
from credsscrapper.state.repository import RepoRef


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

    monkeypatch.setattr("credsscrapper.cli.build_clone_url", lambda ref: str(source_repo))

    exit_code = main([
        "scan",
        "--db", str(db_path),
        "--workdir", str(tmp_path / "work"),
    ])

    assert exit_code == 0
    conn = init_db(str(db_path))
    row = conn.execute("SELECT status FROM scanned_repos WHERE repo_id = 1").fetchone()
    assert row["status"] == "done"


def test_main_requires_a_subcommand():
    with pytest.raises(SystemExit):
        main([])
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/pytest tests/test_cli.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'credsscrapper.cli'`

- [ ] **Step 3: Implement `credsscrapper/cli.py`**

```python
import argparse
import sys
from datetime import datetime, timedelta, timezone

from credsscrapper.discovery.gharchive import fetch_hour_lines
from credsscrapper.discovery.worker import run_discovery_once
from credsscrapper.scan.orchestrator import run_scan_loop
from credsscrapper.state.db import init_db
from credsscrapper.state.repository import RepoRef


def build_clone_url(repo_ref: RepoRef) -> str:
    return f"https://github.com/{repo_ref.owner}/{repo_ref.name}.git"


def _cmd_discover(args: argparse.Namespace) -> int:
    conn = init_db(args.db)
    hour = datetime.now(timezone.utc) - timedelta(hours=1)
    added = run_discovery_once(conn, fetch_hour_lines(hour))
    print(f"discovered {added} new candidate repos")
    return 0


def _cmd_scan(args: argparse.Namespace) -> int:
    conn = init_db(args.db)
    # source_url_fn is a lambda that looks up build_clone_url dynamically (via the
    # module namespace) rather than binding the function object directly, so tests
    # can monkeypatch credsscrapper.cli.build_clone_url and have it take effect.
    processed = run_scan_loop(
        conn,
        args.workdir,
        source_url_fn=lambda ref: build_clone_url(ref),
        stale_timeout_seconds=args.stale_timeout,
        max_repos=args.max_repos,
    )
    print(f"scanned {processed} repos")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="credsscrapper")
    subparsers = parser.add_subparsers(dest="command", required=True)

    discover = subparsers.add_parser("discover")
    discover.add_argument("--db", default="state.db")
    discover.set_defaults(func=_cmd_discover)

    scan = subparsers.add_parser("scan")
    scan.add_argument("--db", default="state.db")
    scan.add_argument("--workdir", default="workdir")
    scan.add_argument("--max-repos", type=int, default=None)
    scan.add_argument("--stale-timeout", type=int, default=3600)
    scan.add_argument(
        "--resume",
        action="store_true",
        help="No-op: scanning always resumes from persisted state. Kept for CLI clarity.",
    )
    scan.set_defaults(func=_cmd_scan)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Implement `credsscrapper/__main__.py`**

```python
import sys

from credsscrapper.cli import main

if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `.venv/bin/pytest tests/test_cli.py -v`
Expected: PASS (3 tests)

- [ ] **Step 6: Run the full test suite**

Run: `.venv/bin/pytest -v`
Expected: PASS (all tests across every task)

- [ ] **Step 7: Commit**

```bash
git add credsScrapper/credsscrapper/cli.py credsScrapper/credsscrapper/__main__.py \
  credsScrapper/tests/test_cli.py
git commit -m "feat: wire discover/scan CLI commands"
```

---

## Manual Verification (not part of automated tests)

After Task 8, do one real end-to-end smoke test against an actual small public repo to confirm `git clone` over HTTPS and the full pipeline work outside of fixtures:

```bash
cd /home/mechanosec/PetProjects/MyMalvare/credsScrapper
.venv/bin/python -c "
from credsscrapper.state.db import init_db
from credsscrapper.state import repository as repo
conn = init_db('smoke.db')
repo.add_candidate(conn, 1, 'octocat', 'Hello-World')
"
.venv/bin/python -m credsscrapper scan --db smoke.db --workdir smoke_work --max-repos 1
.venv/bin/python -c "
from credsscrapper.state.db import init_db
conn = init_db('smoke.db')
for row in conn.execute('SELECT * FROM scanned_repos'):
    print(dict(row))
"
rm -rf smoke.db smoke_work
```

Confirm the repo ends with `status = done` and a `last_commit_sha` populated.
