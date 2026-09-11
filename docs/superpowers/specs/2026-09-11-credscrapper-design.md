# credsScrapper — Design Spec

Date: 2026-09-11
Status: approved for planning

## Purpose

A Python utility that discovers public GitHub repositories, clones them,
and scans both current file contents and full commit history for
accidentally leaked secrets (API keys, tokens, credentials). Output is a
local database of findings. This is the MVP/detection engine for a future
B2B SaaS: point the same detection engine at a customer-provided
repository and report what it finds.

## Hard requirements (non-negotiable, stated by user)

- Implementation language: **Python**. Benchmarked against Go on the
  actual detection workload (regex + Shannon entropy over 2000 synthetic
  files / 16MB) — Python single-threaded outperformed Go single-threaded
  here (~0.21s vs ~0.48s median), and Python `multiprocessing` (24
  workers) reached ~15k files/sec (~0.13s). Go with goroutines was ~2x
  faster than Python multiprocessing (~0.065s), but the real bottleneck
  is network I/O (git clone, GitHub API), not local CPU scanning — the
  2x gap is noise next to network latency. Python stays.
- Must be resumable: stopping and restarting the scraper must not
  re-scan repositories already completed.
- Must search both current file contents AND full commit history (a
  secret committed once and later removed is still a leak).

## Ethical/legal guardrails (binding on the design)

- **Detection only, never validation-by-use.** The tool must never make
  a live call to a third-party service using a discovered credential
  (no "does this AWS key work" check against AWS). That crosses from
  passive discovery into unauthorized access. Format/checksum-level
  validation (e.g. regex shape, provider-specific checksum where public)
  is fine; a network call authenticating *as* the discovered credential
  is not.
- Findings storage is a toxic asset: plaintext storage was explicitly
  chosen for the MVP phase to ease debugging of the detection engine
  (see Storage section) — this is a deliberate, temporary tradeoff, not
  a long-term decision. Encryption at rest (Fernet) must be added before
  any production/B2B use or before the findings database leaves the
  developer's machine.
- The commercial outreach model (approach a company with a finding to
  sell a monitoring contract) is a business decision outside this spec's
  scope. It carries its own legal exposure (responsible disclosure norms,
  possible CFAA-adjacent concerns depending on jurisdiction and how
  findings are used) and should get separate legal review before it's
  acted on. Nothing in this spec authorizes using a found credential.

## Architecture

```
GH Archive / Events API
        |
        v
+----------------------------+        SQLite (state.db)
| Discovery worker           |  --->  candidates(repo_id, owner, name,
| poll PushEvent stream      |         discovered_at, status)
| extract owner/repo         |
+----------------------------+
        |
        v
+----------------------------+       scanned_repos(repo_id,
| Scan orchestrator          |  <->   last_commit_sha, status,
| pop candidate, git clone   |        scanned_at)
| --bare, hand off to        |
| detection engine           |
+----------------------------+
        |
        v
+----------------------------+
| Detection engine           |  --->  findings(repo, file, commit_sha,
| - regex patterns (AWS,     |         secret_type, secret_value,
|   GitHub PAT, Stripe, etc) |         line, found_at)
| - Shannon entropy for      |
|   generic high-entropy     |
|   tokens                   |
| - scans working tree AND   |
|   `git log -p` full diff   |
|   history                  |
+----------------------------+
```

### Discovery worker

- Polls GH Archive (hourly gzipped JSON dumps) or GitHub Events API for
  `PushEvent` entries, extracting `repo.id` / `repo.name`.
- Writes new repo IDs into `candidates` (status=`pending`) if not already
  known in `scanned_repos`.
- Runs independently of the scan orchestrator — it can lag behind or be
  paused without blocking scanning of the existing backlog.
- No GitHub REST/Search API calls needed here, so no 5000 req/hr budget
  is consumed by discovery.

### Scan orchestrator

- Pulls `pending` candidates from SQLite, marks `in_progress`, clones with
  `git clone --bare` (full history, no working tree checkout needed for
  `git log -p`).
- On completion, marks `scanned_repos` row `done` with the last commit
  SHA scanned; on failure, marks `failed` with a reason and a retry
  count.
- On startup, requeues `in_progress` rows older than a timeout (crash
  recovery) back to `pending`. Never re-touches `done` rows for the same
  commit SHA — if a repo advances, only the new commits since
  `last_commit_sha` are rescanned on a later pass.
- Uses `asyncio` for orchestration/cloning I/O; hands scanning work to a
  `ProcessPoolExecutor` for CPU-bound detection.

### Detection engine

- Pure Python module, precompiled regex patterns for known credential
  formats (AWS access keys, GitHub tokens, Stripe keys, private key
  headers, generic `KEY=`/`TOKEN=`/`SECRET=` assignments) plus a generic
  high-entropy token scan (Shannon entropy threshold) as a catch-all.
- Two scan passes per repo: (1) current tree — walk files at HEAD; (2)
  history — `git log -p` streamed through the same detectors, tagged
  with the commit SHA the secret appeared in.
- No external non-Python detector binaries (gitleaks/TruffleHog) —
  self-contained, per user's explicit choice for full control and to
  honor "must be Python."

### State store (SQLite)

Single `state.db` file, three tables: `candidates`, `scanned_repos`,
`findings`. No separate DB server. Chosen for MVP simplicity; migrating
to Postgres is a later, isolated step once this becomes a hosted SaaS
(out of scope here).

### Findings storage

- `findings.secret_value` stores the **raw discovered secret as-is**
  (explicit MVP decision — makes it easy to verify the detector isn't
  producing garbage/false positives while it's being tuned). No hashing
  or masking at this stage.
- Encryption (Fernet, key held outside the repo/DB) is a known follow-up
  before any production or multi-user exposure of this database — not
  part of this implementation pass.

### CLI

- `python -m credsscrapper discover` — run discovery worker standalone.
- `python -m credsscrapper scan [--resume]` — run scan orchestrator over
  current candidate backlog; `--resume` is really just default behavior
  since state is always persisted, but kept as an explicit flag for
  clarity.
- Graceful shutdown on SIGINT: finish the in-flight repo (or checkpoint
  partway through its commit history) rather than leaving a corrupt
  `in_progress` row with no salvageable progress.

## Testing

- Detection engine: unit tests per pattern family (true positive /
  true negative fixtures) plus entropy threshold tests.
- Orchestrator: test resumability against a local bare git repo fixture
  (interrupt mid-scan, restart, assert no duplicate `findings` rows and
  no re-clone of a `done` repo).
- No tests should exercise real GitHub network calls; use local fixture
  repos for git operations and a stubbed discovery feed.

## Explicitly out of scope for this pass

- Postgres migration / multi-tenant SaaS backend.
- Encryption at rest for findings.
- Any credential validation-by-use.
- B2B customer-facing UI/API.
- Commercial outreach workflow.
