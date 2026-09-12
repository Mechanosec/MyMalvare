# Scan worker-threads + BullMQ job queue migration — design

## Problem

Triggering a repository scan freezes the whole API server, for every user,
not just the one who started the scan. Root causes, confirmed by reading
the actual code (not assumed):

1. **`domain/detection/engine.ts`'s `scanText()` is synchronous, CPU-heavy,
   and never yields.** For every commit diff and every HEAD file it runs
   60 regex patterns (`patterns.ts`) plus an entropy pass (`entropy.ts`)
   against the whole text, fully synchronously, then a `lineNumberAt()`
   scan per match. Called back-to-back in a plain `for...of` in
   `scan-repository.use-case.ts`, once per commit in the *entire* history
   and once per file at HEAD, with zero `await`/`setImmediate` between
   iterations that produce no findings.
2. **`git-cli-adapter.ts`'s `iterCommitDiffs()`** buffers the whole
   `git log -p --full-history` output in memory (up to 512MB, already
   flagged as a known ceiling in its own `ponytail:` comment), then does a
   synchronous `matchAll` + manual slicing pass over that entire buffer in
   one shot.
3. **`POST mine/scan-repo`** (`repo-authorizations.controller.ts`) awaits
   `ScanMyRepoUseCase.execute()` inline in the HTTP handler, unlike the
   admin `POST /scan` route which dispatches through `InMemoryJobRunner`.
   This isn't the freeze's root cause by itself (async awaits don't block
   other requests), but it means the CPU-bound work above runs from a
   request handler with no queue or concurrency limit at all.

Node is single-threaded for JS execution. #1 and #2 are synchronous
CPU-bound work with no yield points, so for any repo with a non-trivial
history or file set, they starve the event loop for the whole scan's
duration — no other request, WebSocket message, or API call is served
until it finishes.

## Goals

- Scanning a repository must never block the event loop, regardless of
  repo size.
- The fix must survive concurrent scan requests from many users without
  spawning unbounded threads or falling over.
- No change to persisted data shape, detection logic, or existing
  progress-reporting granularity (cloning → cloned → history done →
  working tree done → done/failed) — this is a concurrency-model change,
  not a rescan-logic change.

## Scope update: BullMQ + Redis is now in scope too

This started as a worker-threads-only fix. The user asked to bring in
BullMQ + Redis in the same pass, to replace `InMemoryJobRunner`
(`infrastructure/jobs/in-memory-job-runner.ts` — its own comment reads
"No Redis/BullMQ at this scale... jobs live in a Map for the lifetime of
the process," a prior decision this supersedes). Reasoning: job state
currently doesn't survive a server restart, there's no real "queued"
state distinct from "running" when concurrency is saturated, and no
retry/backoff. BullMQ requires Redis — there's no in-memory mode — so
Redis becomes a new runtime dependency (`docker-compose.yml`, already
added, brings up `redis:7-alpine` for local dev via `podman compose up -d
redis` or `docker compose up -d redis`; prod needs a real Redis
instance/managed service via `REDIS_URL`).

This layers cleanly under the worker-threads fix rather than replacing
it: BullMQ (backed by Redis) owns job *queueing and persistence* — which
job is pending/running/done/failed, its progress log, retries; Piscina
(worker_threads) owns *where the CPU-heavy scan work actually executes*.
A BullMQ job's processor function is the same async orchestration code
(`RunScanLoopUseCase`/`DiscoverReposUseCase`) that exists today; it still
calls `ScanRepositoryUseCase.execute()`, which still dispatches into the
Piscina pool. Removing either half only gets you half the fix: BullMQ
alone still runs the CPU work inline in whatever process consumes the
job (same freeze, just possibly a different process); Piscina alone (the
original scope) still loses job state on restart and has no visibility
into queued-vs-running once the pool is saturated.

### Job queue architecture

- **New dependency: `bullmq`** (bundles `ioredis`, no separate driver
  needed). One `Queue` named `scanner-jobs` in Redis; jobs are named
  `'discover'` or `'scan'` and carry their existing parameters
  (`RunScanLoopOptions`-shaped payload, etc.) as job data.
- **`JobQueuePort`** (new, `application/ports/job-queue.port.ts`) —
  replaces direct use of `InMemoryJobRunner` from controllers:
  `enqueue(type, payload): Promise<string>` (returns jobId),
  `getJob(jobId): Promise<IJobState | null>`.
- **`BullmqJobQueueAdapter`** (new, `infrastructure/jobs/bullmq-job-queue.adapter.ts`) —
  implements `JobQueuePort` using a BullMQ `Queue` for `enqueue`/`getJob`
  (mapping BullMQ's own states — `waiting`, `active`, `completed`,
  `failed`, `delayed` — onto the existing `EJobStatus` enum, adding a
  `QUEUED` member for `waiting`/`delayed` since that's a real,
  now-visible state that wasn't distinguishable from "running" before).
- **`BullmqJobWorker`** (new, `infrastructure/jobs/bullmq-job-worker.ts`) —
  one BullMQ `Worker` consuming `scanner-jobs`, `concurrency` set to the
  same cap as the Piscina pool (4) so it never holds more clones open
  than can actually be CPU-processed at once. Its processor function
  dispatches by `job.name`: `'discover'` → `DiscoverReposUseCase.execute()`,
  `'scan'` → `RunScanLoopUseCase.execute()` — same use-cases as today,
  unchanged, called from a different place. Progress: the existing
  `onProgress` callback these use-cases already take now calls
  `job.updateProgress({ message, processed, log: [...accumulated] })`
  instead of `InMemoryJobRunner`'s in-memory push — the accumulated `log`
  array is kept small (a handful of milestone messages per repo, never
  per-finding, matching today's reporting granularity) so re-sending the
  whole array on each update stays cheap.
- **`JobsController`** (`GET /jobs/:id`) — reads through `JobQueuePort`
  instead of `InMemoryJobRunner` directly; response shape (`IJobState`)
  stays the same so the frontend's polling/WebSocket-reconnect-replay
  logic doesn't need to change.
- **`ScanController`/`DiscoverController`** — `this.jobRunner.start(...)`
  calls become `await this.jobQueue.enqueue(...)`; same `{ jobId }`
  response shape.
- **`ProgressGateway`** (WebSocket) — currently driven by
  `InMemoryJobRunner.emit()` calling `ProgressPort.emit()` synchronously
  in-process. With BullMQ, the enqueuing process (the NestJS API process)
  and the processing process could in principle be different — for this
  pass they're the **same process** (the `BullmqJobWorker` runs inside
  the existing Nest app, not a separate deployable), so `ProgressPort` can
  still be called directly from the worker's `onProgress` callback,
  exactly as today. Splitting the worker into its own process is a later
  step this design doesn't block (BullMQ's `QueueEvents` — a
  Redis-pub/sub-backed event stream — is the natural bridge if/when that
  split happens, since it works cross-process; not needed yet since
  there's only one process).

### Why not skip BullMQ and just harden `InMemoryJobRunner`

Considered and rejected per the user's explicit request for BullMQ, but
worth naming the alternative that was on the table: persisting job state
in a new Prisma/SQLite table instead of Redis would have gotten
"survives a restart" without a new service to run. BullMQ was chosen
instead because it also gets retry/backoff, delayed jobs, and a
mature `concurrency` primitive for free, and positions the system for a
later split into a separate worker process/deployable (BullMQ's queue
and worker sides are already designed to run in different processes;
a hand-rolled SQLite queue would need that split built by hand later).

## Non-goals (for this pass)

- Horizontal scaling across multiple machines/processes beyond what
  BullMQ + Redis already sets up the option for. The `BullmqJobWorker`
  runs inside the same process as the API for now — splitting it into a
  separate deployable that connects to the same Redis is the natural next
  step if one machine's core count becomes the bottleneck, not blocked by
  anything here, but not built in this pass.
- Fixing the `iterCommitDiffs` 512MB-buffer-then-parse approach to stream
  instead (still a known, separately-tracked `ponytail:` debt item) —
  moving it off the main thread neutralizes the event-loop-blocking
  problem even though the buffer is still built in one shot, inside the
  worker.

## What "100 concurrent users" actually looks like after this

The worker pool is **fixed-size**, capped at 4 by default regardless of
the host's actual core count (`Math.max(1, Math.min(4, os.cpus().length))`,
overridable via env var) — not one thread per request, and deliberately
not "however many cores this machine has," so running this on a
developer laptop with more cores doesn't pin the whole machine while
testing. With 100 simultaneous scan requests: 4 scans run truly in
parallel; the other 96 queue and are picked up as workers free up. The server stays fully responsive throughout — the event loop was
never doing the CPU work, so it keeps serving every other user's requests,
WebSocket updates, and API calls normally. What does **not** change: raw
scan throughput is still bounded by CPU core count, same physical limit
any language hits for CPU-bound work on one machine (Go's default
`GOMAXPROCS` is also core count). This fixes "one scan takes the whole
server down," not "100 scans finish in a second." Horizontal scaling
(more machines) is the answer if 4-wide queuing isn't enough headroom —
tracked as a non-goal above, not needed yet.

## Architecture

Two layers, each solving a different half of the problem:

```
┌──────────────┐   enqueue    ┌───────────┐   consume    ┌──────────────────────────┐        ┌──────────────────────────────┐
│ HTTP handler │─────────────▶│  Redis     │─────────────▶│ BullmqJobWorker           │        │  Piscina worker thread        │
│ (Nest, same  │ {jobId}      │ (BullMQ    │  concurrency │ (same Nest process)       │ submit │  (×4 max)                     │
│  process)    │◀─────────────│  queue)    │  = 4         │                           │───────▶│  scan.worker.ts entry point   │
└──────────────┘  returns     └───────────┘              │  RunScanLoopUseCase /     │        │   - new GitCliAdapter()      │
   immediately                                            │  DiscoverReposUseCase     │        │     (plain class, no DI)     │
                                                            │   → ScanRepositoryUseCase│◀───────┼─── progress + finding        │
                                                            │     .execute()            │        │     messages, then final     │
                                                            │   → job.updateProgress()  │        │     result: headSha, status  │
                                                            │   → state.addFinding/     │        │                              │
                                                            │     markDone/markFailed   │        │                              │
                                                            └──────────────────────────┘        └──────────────────────────────┘
```

`ScanRepositoryUseCase`'s public contract
(`execute(repoRef, cloneSource, workdir, onProgress)`) does not change,
so `RunScanLoopUseCase` doesn't need to change how it calls it — only
what happens inside it, and what calls it from the HTTP layer, change.

All Prisma/SQLite writes (`state.addFinding`, `markDone`, `markFailed`)
stay on the main thread — SQLite has a single-writer lock, so funneling
every write through one thread avoids contention entirely rather than
working around it.

### Components

- **New dependency: [`piscina`](https://github.com/piscinajs/piscina).**
  A worker-thread pool is exactly what this library does (task queueing,
  backpressure, worker lifecycle, crash recovery). Hand-rolling this
  correctly — especially crash/backpressure handling — is the kind of
  thing worth reaching for a small, well-established library over,
  rather than reinventing it. Flagging this explicitly since it's a new
  dependency: no existing installed package covers this.
- **`ScanWorkerPort`** (new, `application/ports/scan-worker.port.ts`) —
  abstract class, one method: `run(repoRef, cloneSource, workdir, onEvent): Promise<IScanWorkerResult>`,
  where `onEvent` receives progress/finding messages as they arrive and
  `IScanWorkerResult` is `{ headSha: string | null, status: 'done' | 'failed', failReason?: string }`.
- **`PiscinaScanWorkerAdapter`** (new, `infrastructure/workers/piscina-scan-worker.adapter.ts`) —
  implements `ScanWorkerPort`. Owns one `Piscina` instance for the whole
  process (constructed once, pool size defaults to
  `Math.max(1, Math.min(4, os.cpus().length))`, overridable via an env
  var for ops tuning), pointed at the compiled worker entry file.
  Submits one task per `run()` call; Piscina queues if every worker is
  busy.
- **`scan.worker.ts`** (new, `infrastructure/workers/scan.worker.ts`) —
  the worker entry point Piscina loads into each thread. Contains what
  `ScanRepositoryUseCase.execute()`'s body does today: `new GitCliAdapter()`,
  `new FsWorkdirCleanerAdapter()` instantiated directly (no NestJS DI —
  these are plain classes, `@Injectable()` is a no-op decorator without
  Nest's container), clone, `iterCommitDiffs` + `scanText` loop, HEAD-file
  loop, posting a message per finding and per milestone via Piscina's
  `MessagePort` support, then returning the final result object.
- **`ScanRepositoryUseCase`** (changed) — constructor drops
  `GitOperationsPort` (no longer calls git directly; that now lives only
  in the worker), keeps `LoggerPort` and `WorkdirCleanerPort` (workdir
  cleanup before dispatch still happens on the main thread, since the
  worker gets a path, not the cleanup responsibility — this stays
  symmetric with today's `finally` block, executing after the worker's
  task resolves or rejects), adds `ScanWorkerPort`. `execute()` becomes:
  clean workdir → call `scanWorker.run(...)`, wiring its `onEvent`
  callback to `state.addFinding` (for finding events) and `report()` (for
  progress events) → on result, `state.markDone`/`markFailed` → clean
  workdir again.
- **`scanner.module.ts`** — bind `ScanWorkerPort` to
  `PiscinaScanWorkerAdapter` (as a singleton — one pool per process, not
  per request), drop `ScanRepositoryUseCase`'s `GitOperationsPort`
  dependency from its `provideUseCase` wiring, add `ScanWorkerPort`.
  `GitOperationsPort`/`GitCliAdapter` stay registered for anything else
  that might reference the port (currently nothing does outside the
  worker, so this binding becomes vestigial on the main thread — worth a
  `ponytail:` comment noting the worker instantiates its own copy rather
  than sharing this binding, since DI can't cross the thread boundary).

### `mine/scan-repo` fix (bundled — same root issue)

`RepoAuthorizationsController.scanRepo()` currently does
`await this.scanMyRepo.execute(...)` inline (`ScanMyRepoUseCase.execute()`
itself awaits `scanRepository.execute(...)` directly at line 51), holding
the HTTP response open for the whole scan and returning `{ repoId }` only
once it's entirely done (confirmed in `apps/web/src/lib/api-client.ts`'s
`scanMyRepo()` and its one caller, `MyReposPanel`, which awaits that
response before doing anything else — there's no existing progress UI on
this path today). This is the exact endpoint the user hit when the freeze
was reported, so it's fixed in the same pass: `ScanMyRepoUseCase`
dispatches a `'scan'` job through the same `JobQueuePort`/BullMQ queue
`ScanController`'s admin `POST /scan` now also uses (one shared queue for
both), instead of awaiting inline. It returns `{ repoId, jobId }`
immediately; the existing WebSocket progress channel and `GET /jobs/:id`
polling already used by the admin flow carries the rest. `MyReposPanel`
needs a small addition: watch the returned `jobId`'s progress instead of
treating the response as "scan done" — reusing the same
`ProgressPanel`/job-watching pattern `ScanControls` already implements
for the admin flow, not inventing a new one.

## Data flow

0. `POST mine/scan-repo` or admin `POST /scan`/`POST /discover` calls
   `jobQueue.enqueue('scan' | 'discover', payload)` → `BullmqJobQueueAdapter`
   pushes a job onto the `scanner-jobs` Redis queue and returns a `jobId`
   immediately, before any scanning starts. `BullmqJobWorker` (concurrency
   4) picks it up whenever a slot is free and calls
   `RunScanLoopUseCase.execute(...)` or `DiscoverReposUseCase.execute(...)`.
1. Inside that, `RunScanLoopUseCase`'s `workerLoop` calls
   `ScanRepositoryUseCase.execute(repoRef, cloneSource, workdir, onProgress)`
   per claimed repo.
2. `execute()` cleans the workdir, then calls
   `scanWorker.run(repoRef, cloneSource, workdir, onEvent)`.
3. `PiscinaScanWorkerAdapter.run()` submits a task to the pool. Piscina
   either runs it immediately (a worker is free) or queues it (all
   workers busy) — this queueing is what bounds concurrency to core count
   regardless of how many callers invoke `run()` at once.
4. Inside the worker: clone → `iterCommitDiffs` → for each commit diff,
   `scanText()` (still synchronous — but now only blocks *that worker
   thread*, not the main thread or other workers) → post a `finding`
   message per finding, a `progress` message at each milestone → same for
   the HEAD-file loop → post the final result and resolve.
5. Back on the main thread: each `finding` message → `state.addFinding(...)`
   (Prisma write, async, cheap); each `progress` message → `report()` →
   `job.updateProgress(...)` (so `GET /jobs/:id` and the WebSocket gateway
   both reflect it) and the existing logger; the resolved result →
   `state.markDone(repoId, headSha)` or `state.markFailed(repoId, failReason)`,
   then workdir cleanup. When `RunScanLoopUseCase.execute()` itself
   resolves or rejects, that's the BullMQ job's own completion/failure —
   marking it `completed`/`failed` in Redis.

## Error handling

- A worker throwing (e.g. git clone failure) rejects the Piscina task;
  `ScanRepositoryUseCase` catches that the same way it catches errors
  today, calling `state.markFailed` with the error message — no change to
  the existing failure-reporting shape.
- A worker **crashing** (segfault, OOM) is something Piscina detects and
  surfaces as a rejected task with an error, replacing the crashed thread
  in the pool automatically — this is exactly the kind of failure mode
  hand-rolled `worker_threads` code tends to get wrong, and is the main
  reason to use Piscina rather than a bespoke pool.
- Timeouts: keep relying on the existing `requeueStale` mechanism in
  `RunScanLoopUseCase` (unaffected by this change) for the admin
  bulk-scan path. For `mine/scan-repo`, no timeout currently exists either
  way — out of scope for this pass, not a regression.
- BullMQ job failure (the whole `RunScanLoopUseCase`/`DiscoverReposUseCase`
  call rejects): BullMQ's own retry config applies (start with 0 retries
  to match today's behavior exactly — a scan failing once already marks
  the affected repo `failed` via `state.markFailed` and
  `requeueFailed`/`maxRetries` already governs re-attempts at the
  repo level, so an *additional* BullMQ-level job retry would double up
  with that existing mechanism; revisit if that turns out wrong in
  practice).
- Redis unavailable at startup: `BullmqJobQueueAdapter`/`BullmqJobWorker`
  fail to connect — this should surface as a clear startup error (Nest
  fails to boot) rather than a silent no-op, so an ops mistake (forgot to
  start Redis) is obvious immediately rather than manifesting later as
  "scans never start."

## Testing

- **Unit tests for `scan.worker.ts`'s logic**: since it's a plain
  function/class with no `parentPort`/Piscina coupling in its core logic
  (the git+scanText loop), it can be extracted as a plain exported
  function (e.g. `runScanJob(...)`) that the worker's thin
  Piscina-facing entry point calls — the existing
  `scan-repository.use-case.spec.ts`-style unit tests (mocking
  `GitOperationsPort`, `StateRepositoryPort`) move here largely
  unchanged, since the logic itself hasn't changed, only which thread
  runs it.
- **`ScanRepositoryUseCase` unit tests**: mock `ScanWorkerPort` instead of
  `GitOperationsPort` directly; assert `state.addFinding` is called per
  finding event, `markDone`/`markFailed` per result, same as today.
- **`PiscinaScanWorkerAdapter`**: a light integration test running an
  actual (trivial) worker task end-to-end confirms the message-passing
  contract works — this is infrastructure-adjacent, so a real Piscina
  instance rather than a mock is appropriate here, same spirit as the
  existing `prisma-state-repository.spec.ts` "real SQLite, no mocks"
  integration tests.
- **`BullmqJobQueueAdapter`/`BullmqJobWorker`**: integration tests against
  a real Redis (same "real service, no mocks" spirit as the Piscina
  integration test and the existing Prisma integration tests) — needs a
  Redis reachable in CI/test runs, via the same `docker-compose.yml`
  service (`REDIS_URL` pointed at it for the test run). Cover: enqueue →
  `getJob` shows `queued` → worker picks it up → `getJob` shows `running`
  with progress → completes → `getJob` shows `done`.
- **Manual verification**: trigger a scan of a real large-ish repo and
  confirm (a) other API requests stay fast during the scan (e.g. hit
  `GET /findings` from a second client while it runs), (b) findings and
  final status match what the same repo produced before this change, and
  (c) starting 5+ scans at once shows the 5th+ sitting `queued` until a
  slot frees up rather than all running at once or erroring.

## Rollout

- No data migration in Prisma/SQLite.
- **New runtime requirement: Redis.** `docker-compose.yml` (repo root,
  already added) brings up `redis:7-alpine` for local dev
  (`podman compose up -d redis` or `docker compose up -d redis` — both
  work, confirmed). `REDIS_URL` added to `.env`/`.env.example`
  (`redis://localhost:6379` for local dev). Prod deployment needs a real
  Redis instance — out of scope here (ops concern, not code), but the app
  should fail loudly on boot if it can't connect (see Error handling).
- API contract change visible to the frontend: `mine/scan-repo` now
  returns `{ repoId, jobId }` immediately instead of `{ repoId }` after
  the whole scan finishes — `MyReposPanel` needs to switch from "await
  result, then it's done" to "watch job," which is part of this same
  change (see `mine/scan-repo` fix above). `GET /jobs/:id`'s response
  shape is unchanged (still `IJobState`), so no other frontend code needs
  to change.
- New dependencies to add: `piscina`, `bullmq`.
