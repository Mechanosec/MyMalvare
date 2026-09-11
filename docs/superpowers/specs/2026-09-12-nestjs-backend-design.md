# NestJS Backend — Design Spec

Date: 2026-09-12
Status: approved for planning

## Purpose

Full rewrite of the credsScrapper backend (currently Python, in
`credsScrapper/`) into TypeScript/NestJS, using hexagonal (ports &
adapters) architecture. Driver: the user is a Node.js developer, not
fluent in Python, and intends to own and extend this codebase long-term
as the base of a future B2B SaaS. Working Python code exists and is
covered by 107 passing tests (including recent bug fixes for binary
files, unicode filenames, and entropy-detector noise) — this rewrite
deliberately re-implements the same validated behavior in TypeScript
rather than inventing new behavior, to avoid re-discovering the same
bugs.

This spec covers the **backend only**. A Next.js frontend is a separate
follow-up sub-project, built after this backend's API is working, and
gets its own spec/plan cycle.

## Hard requirements (stated by user)

- Language: TypeScript, framework: NestJS.
- Architecture: hexagonal (ports & adapters) — domain logic has zero
  dependency on NestJS, Prisma, or any infrastructure concern.
- Must expose a web API a Next.js frontend can later drive, with
  live progress for long-running scan/discover jobs (a UI button that
  triggers a scan must not just hang with no feedback).
- Old Python code (`credsScrapper/`) stays untouched during this work
  and is deleted only after the user confirms the new version works.

## What is being ported vs. reinvented

**Ported 1:1 (validated logic, low rewrite risk):**
- All ~41 regex secret-detection patterns (`app/detection/patterns.py`)
  and their human-readable descriptions (`app/detection/descriptions.py`).
- Shannon entropy detector, including the fix that excludes `/` from the
  token character class and requires ≥2 digits (this fix eliminated
  ~99.998% false-positive noise measured against real scan data — see
  `2026-09-11-credscrapper-design.md` history / this session's findings
  analysis).
- Git interaction strategy: shell out to the system `git` binary (not a
  JS git library) for clone/list/read/history, because the existing
  Python code already solved subtle git-specific correctness bugs this
  way:
  - `git ls-tree -r -z --name-only HEAD` (NUL-separated, unquoted paths)
    to avoid git's quoting of non-ASCII filenames breaking `git show
    HEAD:<path>`.
  - Read file content as raw bytes first, detect binary via NUL-byte
    heuristic, skip binary files instead of crashing on UTF-8 decode.
  - `git log -p --full-history` parsed by splitting on `^commit <sha>`
    headers for per-commit diff scanning.
- Database shape: `candidates`, `scanned_repos`, `findings` tables
  (`findings` includes the `context` column — the variable/key name
  captured immediately before a `generic_high_entropy` match, e.g.
  `SUPABASE_KEY = '<token>'` → `context = "SUPABASE_KEY"`).

**Reinvented for the new stack:**
- Concurrency model: Python used OS threads (`ThreadPoolExecutor`) with
  SQLite `BEGIN IMMEDIATE` locking because CPython threads plus a
  shared SQLite file needed explicit mutual exclusion. Node has no
  OS-thread concurrency for this — "N repos at once" becomes N
  independent async loops on one event loop. The claim-next critical
  section (read pending row, mark it claimed) must not have an `await`
  boundary in the middle, or two async loops can interleave and
  double-claim; this is enforced with a Prisma interactive transaction
  (`prisma.$transaction`) wrapping the read+write, giving the same
  guarantee BEGIN IMMEDIATE gave in Python, without needing a
  hand-rolled mutex.
- Job execution + progress: Python was a one-shot CLI process that
  logged to console/file. NestJS is a long-running server; discover/scan
  become async jobs tracked in memory (job id, status, counts), with
  progress pushed over WebSocket instead of log lines — this is what
  lets a future UI button show live progress instead of appearing to
  hang.
- Persistence adapter: `sqlite3` (Python stdlib) → Prisma with a SQLite
  datasource. Chosen over Postgres for this MVP pass to avoid running an
  external DB process; migrating to Postgres later is a one-line
  `datasource` change in `schema.prisma`, not a rewrite.

## Architecture

```
src/
  domain/                          — pure logic, no NestJS/Prisma imports
    entities/
      repo-ref.ts                  — { repoId, owner, name }
      finding.ts                   — { secretType, secretValue, lineNumber, context }
    detection/
      patterns.ts                  — ~41 (secretType, RegExp) pairs, ported from patterns.py
      descriptions.ts              — secretType -> human-readable name
      entropy.ts                   — shannonEntropy, findHighEntropyTokens
      engine.ts                    — scanText(text): Finding[]
    ports/
      state-repository.port.ts     — interface: addCandidate, isKnown, claimNext,
                                      markDone, markFailed, requeueStale, addFinding,
                                      countFindings
      git-operations.port.ts       — interface: cloneBare, getHeadCommit,
                                      listFilesAtHead, readFileAtHead, iterCommitDiffs
      discovery-feed.port.ts       — interface: fetchHourLines(date): AsyncIterable<string>
      progress.port.ts             — interface: emit(jobId, event)

  application/                     — use-cases, depend only on domain + ports
    discover-repos.usecase.ts
    scan-repository.usecase.ts     — clone + scan one repo (ported scan_repository logic)
    run-scan-loop.usecase.ts       — N concurrent async workers claiming from the queue
    get-findings.usecase.ts
    get-scan-status.usecase.ts

  infrastructure/                  — adapters, implement ports
    persistence/
      prisma-state-repository.ts   — implements StateRepositoryPort
      schema.prisma                — candidates / scanned_repos / findings
    git/
      git-cli-adapter.ts           — implements GitOperationsPort via child_process
    discovery/
      gharchive-http-adapter.ts    — implements DiscoveryFeedPort via fetch + zlib gunzip
    jobs/
      in-memory-job-runner.ts      — tracks job id/status/counts, drives use-cases
    websocket/
      progress.gateway.ts          — implements ProgressPort, NestJS WebSocket Gateway

  presentation/
    discover.controller.ts         — POST /discover -> starts a job, returns job id
    scan.controller.ts             — POST /scan { workers, maxRepos } -> starts a job
    findings.controller.ts         — GET /findings (filters: secretType, repo, etc.)
    jobs.controller.ts             — GET /jobs/:id (status fallback if WS not connected)
```

### Concurrency detail

`run-scan-loop.usecase.ts` spawns `workers` async functions via
`Promise.all`, each looping: `claimNext()` (wrapped in a Prisma
transaction) → `scanRepository()` → repeat until the queue is empty or
`maxRepos` is reached (tracked via a shared counter, same
reserve-before-claim pattern as the Python version to avoid overshoot).

### Job/progress detail

`InMemoryJobRunner` holds a `Map<jobId, JobState>` (status: `running |
done | failed`, counts, per-repo log lines). `POST /scan` creates a job,
starts `RunScanLoopUseCase` without awaiting it, returns `{ jobId }`
immediately. `ProgressGateway` broadcasts job events over WebSocket to
subscribed clients; `GET /jobs/:id` is a polling fallback returning the
same state.

## Testing

- Jest for domain/application layers: same test scenarios as the Python
  suite (pattern detection samples, entropy false-positive regression
  cases, binary-file handling, unicode-filename handling, claim-next
  double-claim-under-concurrency, resumability).
- Git-based tests build real temporary git repos via `execa` (same
  approach as the Python fixtures — real `git init`/`commit`, no mocks),
  no network calls in any test.
- E2E tests (NestJS `supertest`) for the REST endpoints and a
  WebSocket-progress smoke test.

## Migration path

1. Build this NestJS backend as a new, separate directory alongside
   `credsScrapper/` (does not touch or depend on the Python code).
2. Validate it against the same behavior the Python version has
   (detection accuracy, resumability, concurrency safety) via its own
   test suite plus a manual smoke test.
3. Only after the user confirms the new version works: delete
   `credsScrapper/`.
4. Next.js frontend is a separate spec/plan cycle, built once this
   backend's API is stable.

## Explicitly out of scope for this pass

- Next.js frontend (separate sub-project).
- Postgres migration (SQLite via Prisma for now).
- BullMQ/Redis job queue (in-memory job runner is sufficient at this
  scale; revisit if this becomes a real multi-tenant SaaS).
- Encryption at rest for findings (carried over as a known gap from the
  Python version — still not addressed here).
- Any credential validation-by-use (still out of scope, same guardrail
  as the original spec).
- GH Archive discovery covering more than the last hour (same
  limitation as the Python version).
