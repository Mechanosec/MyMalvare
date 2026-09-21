# Independent HEAD and History Scans Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist current-file findings quickly through an isolated shallow HEAD scan while full Git history runs independently without blocking other repositories.

**Architecture:** Store HEAD and history coverage as separate repository phases, dispatch them through dedicated BullMQ queues, and execute them in separate Piscina pools. HEAD uses a shallow bare cache; history uses a full bare cache, independent checkpoints, cooperative cancellation, and explicit time/disk budgets.

**Tech Stack:** NestJS, BullMQ/Redis, Piscina worker threads, Prisma/SQLite, system Git, Next.js/Vitest/Jest.

**Spec:** `docs/superpowers/specs/2026-09-21-head-history-design.md`

## Global Constraints

- Keep Node/NestJS, Git, Prisma/SQLite and BullMQ; add no product dependency.
- HEAD concurrency is 2 and history concurrency is 1 by default, configurable with validated positive integers.
- HEAD budget defaults to 120 seconds and 512 MiB; history defaults to 15 minutes and 2 GiB.
- Keep raw secret values out of logs, progress, errors, benchmark artifacts and new UI fields.
- Successful HEAD coverage must never advance history coverage.
- Budget expiry is `incomplete`; explicit stop is `cancelled`; neither is automatically retried.
- Preserve findings already stored and every commit sighting collected before an interrupted history attempt.
- Do not terminate or mutate the user's currently running scan during development.
- Do not commit or push without a separate explicit instruction.

## Review Focus

- Default-branch force-push: HEAD succeeds at the new SHA; history falls back to a full traversal and never claims the old checkpoint covers it.
- Crash between phase persistence and Redis enqueue: startup reconciliation schedules the pending phase once.
- Stop during `git clone`/`fetch`: the process group exits, lock releases, partial findings flush, and phase is `cancelled` rather than `done`.
- Huge single HEAD blob or rapidly growing pack: the configured budget reports `incomplete` with a safe reason and does not kill another repository's cache.
- Same repository requested concurrently: stable phase identity deduplicates work while a newer target SHA remains schedulable after completion.

---

### Task 1: Persist independent phase coverage

**Files:**
- Create: `credsScrapper/apps/api/prisma/migrations/20260921210000_scan_phases/migration.sql`
- Create: `credsScrapper/apps/api/src/modules/scanner/domain/constant/scan-phase.constant.ts`
- Create: `credsScrapper/apps/api/src/modules/scanner/domain/types/scan-phase-record.type.ts`
- Modify: `credsScrapper/apps/api/prisma/schema.prisma`
- Modify: `credsScrapper/apps/api/src/modules/scanner/application/ports/state-repository.port.ts`
- Modify: `credsScrapper/apps/api/src/modules/scanner/infrastructure/persistence/prisma-state-repository.ts`
- Modify: `credsScrapper/apps/api/src/modules/scanner/domain/types/scanned-repo-record.type.ts`
- Test: `credsScrapper/apps/api/tests/integration/scanner/prisma-state-repository.spec.ts`

**Interfaces:**
- Produces: `EScanPhase = HEAD | HISTORY`, `EScanPhaseStatus`, `IScanPhaseRecord`, and phase repository methods used by Tasks 4–7.
- Produces: `claimPhase(repoId, phase, targetSha)`, `markPhaseDone(...)`, `markPhaseIncomplete(...)`, `markPhaseFailed(...)`, `markPhaseCancelled(...)`, `listPendingPhases(phase)`.

- [ ] **Step 1: Write migration and repository tests first**

```ts
await repo.markPhaseDone(1, EScanPhase.HEAD, {
  targetSha: headSha,
  completedSha: headSha,
  scannerVersion: 'v2',
});
expect(await repo.getPhase(1, EScanPhase.HISTORY)).toBeNull();

await repo.markPhaseIncomplete(1, EScanPhase.HISTORY, {
  targetSha: headSha,
  reason: 'History cache exceeded 2147483648 bytes',
});
expect(await repo.getPhase(1, EScanPhase.HISTORY)).toMatchObject({
  status: EScanPhaseStatus.INCOMPLETE,
  completedSha: null,
});
```

Also migrate a legacy `done` row with both `last_commit_sha` and
`scanner_version`, and assert HEAD/history phase rows inherit that coverage;
legacy failed/in-progress rows must not become done.

- [ ] **Step 2: Run the focused integration test and observe the missing schema/API failure**

Run: `npm test -w apps/api -- --runInBand tests/integration/scanner/prisma-state-repository.spec.ts`

- [ ] **Step 3: Add the phase model and transactional repository methods**

```prisma
model ScanPhase {
  repoId         Int       @map("repo_id")
  phase          String
  status         String
  targetSha      String?   @map("target_sha")
  completedSha   String?   @map("completed_sha")
  scannerVersion String?   @map("scanner_version")
  startedAt      DateTime? @map("started_at")
  completedAt    DateTime? @map("completed_at")
  reason         String?
  retryCount     Int       @default(0) @map("retry_count")

  @@id([repoId, phase])
  @@map("scan_phases")
}
```

Use conditional Prisma updates for claiming so two processes cannot claim the
same pending phase. Keep the legacy `ScannedRepo` columns readable during the
transition; derive its top-level status from HEAD coverage for compatibility.

- [ ] **Step 4: Verify phase persistence, migration and existing repository tests**

Run: `npm test -w apps/api -- --runInBand tests/integration/scanner/prisma-state-repository.spec.ts`

- [ ] **Step 5: Review checkpoint semantics**

Confirm no method accepting `EScanPhase.HEAD` writes the history row and no
partial/incomplete method updates `completedSha`.

### Task 2: Add shallow HEAD and full history Git acquisition modes

**Files:**
- Modify: `credsScrapper/apps/api/src/modules/scanner/application/ports/git-operations.port.ts`
- Modify: `credsScrapper/apps/api/src/modules/scanner/infrastructure/git/git-cli-adapter.ts`
- Test: `credsScrapper/apps/api/tests/integration/scanner/git-cli-adapter.spec.ts`
- Test: `credsScrapper/apps/api/tests/unit/scanner/application/use-cases/run-scan-job.use-case.spec.ts`

**Interfaces:**
- Produces: `prepareHead(source, destDir, signal): Promise<string>` and `prepareHistory(source, destDir, targetSha, signal): Promise<void>`.
- Consumes: phase and target SHA from Task 1.

- [ ] **Step 1: Write real Git fixture tests**

Create three fixture commits, call `prepareHead`, then assert:

```ts
expect(await git.getHeadCommit(headDir)).toBe(latestSha);
expect(await execGit(headDir, ['rev-parse', '--is-shallow-repository'])).toBe(
  'true',
);
expect(await collect(git.iterCommitDiffs(headDir))).toHaveLength(1);
```

Call `prepareHistory` in a different directory and assert all three commits
remain available. Add a force-pushed source test: `isAncestor` returns false and
history chooses full traversal. For local fixture paths, assert the adapter uses
`file://` so `--depth=1` is effective.

- [ ] **Step 2: Run the Git integration test and confirm the new API is absent**

Run: `npm test -w apps/api -- --runInBand tests/integration/scanner/git-cli-adapter.spec.ts`

- [ ] **Step 3: Implement acquisition without retaining raw stderr**

HEAD clone arguments:

```ts
['clone', '--bare', '--depth=1', '--single-branch', '--no-tags', '--', source, destDir]
```

Full history retains the current bare clone/fetch semantics. Fetch the exact
target SHA and detach HEAD to it before scanning so a moving default branch
cannot mix snapshots. Spawn Git in a process group and map anonymous-access
failure to the safe category `repository_unavailable`; never report raw stderr.

- [ ] **Step 4: Verify both cache modes and old Git behavior**

Run: `npm test -w apps/api -- --runInBand tests/integration/scanner/git-cli-adapter.spec.ts`

### Task 3: Make scan phases cancellable and budgeted

**Files:**
- Create: `credsScrapper/apps/api/src/modules/scanner/application/types/scan-budget.type.ts`
- Create: `credsScrapper/apps/api/src/modules/scanner/infrastructure/workers/scan-budget.ts`
- Modify: `credsScrapper/apps/api/src/modules/scanner/application/use-cases/run-scan-job.use-case.ts`
- Modify: `credsScrapper/apps/api/src/modules/scanner/application/types/scan-checkpoint.type.ts`
- Modify: `credsScrapper/apps/api/src/modules/scanner/infrastructure/workers/scan.worker.ts`
- Modify: `credsScrapper/apps/api/src/modules/scanner/infrastructure/workers/types/scan-message.type.ts`
- Modify: `credsScrapper/apps/api/src/modules/scanner/application/ports/scan-worker.port.ts`
- Test: `credsScrapper/apps/api/tests/unit/scanner/application/use-cases/run-scan-job.use-case.spec.ts`
- Test: `credsScrapper/apps/api/tests/unit/scanner/infrastructure/workers/scan.worker.spec.ts`

**Interfaces:**
- Produces: `IScanExecutionOptions { phase, targetSha?, checkpoint?, budget, signal }`.
- Produces: result statuses `done | incomplete | cancelled | failed`, always with the actual target SHA when acquisition succeeded.

- [ ] **Step 1: Add failing phase-isolation tests**

```ts
await useCase.execute(ref, source, dir, onEvent, {
  phase: EScanPhase.HEAD,
  budget,
  signal,
});
expect(git.iterCommitDiffs).not.toHaveBeenCalled();
expect(git.readFilesAtHead).toHaveBeenCalled();
```

Add history-only coverage, abort during acquisition, abort during diff iteration,
time expiry, cache-size expiry, progress throttling, and a 100 MiB HEAD object.
Assert findings emitted before cancellation are still delivered and the result
is never `done`.

- [ ] **Step 2: Run focused worker/use-case tests and verify they fail**

Run: `npm test -w apps/api -- --runInBand tests/unit/scanner/application/use-cases/run-scan-job.use-case.spec.ts tests/unit/scanner/infrastructure/workers/scan.worker.spec.ts`

- [ ] **Step 3: Implement phase-specific execution and safe progress**

HEAD calls only `prepareHead`, `listFilesAtHead`, and `readFilesAtHead`.
History calls only `prepareHistory` and `iterCommitDiffs`. Report:

```ts
{
  type: 'progress',
  phase,
  elapsedMs,
  acquiredBytes,
  processedFiles,
  processedCommits,
  findingsCount,
}
```

Throttle progress to one event per second. The worker receives a transferred
abort signal/message, kills the active Git process group, flushes compacted
findings in acknowledged batches, posts completion, and only then releases.

- [ ] **Step 4: Validate configuration values once at startup**

```ts
function positiveInteger(name: string, fallback: number): number {
  const value = process.env[name] === undefined ? fallback : Number(process.env[name]);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}
```

Cover zero, negative, `NaN`, and fractional inputs. Cache measurement must walk
only the active phase directory and run at most every five seconds.

- [ ] **Step 5: Run focused tests**

Run: `npm test -w apps/api -- --runInBand tests/unit/scanner/application/use-cases/run-scan-job.use-case.spec.ts tests/unit/scanner/infrastructure/workers/scan.worker.spec.ts`

### Task 4: Isolate HEAD and history Piscina pools and caches

**Files:**
- Create: `credsScrapper/apps/api/src/modules/scanner/application/ports/head-scan-worker.port.ts`
- Create: `credsScrapper/apps/api/src/modules/scanner/application/ports/history-scan-worker.port.ts`
- Create: `credsScrapper/apps/api/src/modules/scanner/infrastructure/workers/piscina-phase-worker.adapter.ts`
- Modify: `credsScrapper/apps/api/src/modules/scanner/infrastructure/fs/fs-scan-cache.adapter.ts`
- Modify: `credsScrapper/apps/api/src/modules/scanner/scanner.module.ts`
- Test: `credsScrapper/apps/api/tests/integration/scanner/piscina-scan-worker.adapter.spec.ts`
- Test: `credsScrapper/apps/api/tests/unit/scanner/infrastructure/workers/pool-size.spec.ts`

**Interfaces:**
- Produces: distinct DI tokens `HeadScanWorkerPort` and `HistoryScanWorkerPort` backed by pools sized 2 and 1.
- Produces: `ScanCachePort.acquire(workdir, source, phase)` with separate phase paths and locks.

- [ ] **Step 1: Write isolation tests**

Block a history worker on a synthetic fixture, start two HEAD scans, and assert
both HEAD promises finish while history remains active. Assert HEAD and history
leases for the same repo resolve to different paths and can be held together.

- [ ] **Step 2: Run focused integration tests and confirm shared-pool behavior fails**

Run: `npm test -w apps/api -- --runInBand tests/integration/scanner/piscina-scan-worker.adapter.spec.ts`

- [ ] **Step 3: Bind dedicated pools and cache namespaces**

Use one adapter class configured by constructor factory:

```ts
new PiscinaPhaseWorkerAdapter({ phase: EScanPhase.HEAD, maxThreads: 2 });
new PiscinaPhaseWorkerAdapter({ phase: EScanPhase.HISTORY, maxThreads: 1 });
```

Cache layout is `.scan-cache/head/<key>` and `.scan-cache/history/<key>`;
locks live next to their phase directory. Pruning must skip locked paths and
must never delete the other phase.

- [ ] **Step 4: Verify pool, lock, and adapter integration**

Run: `npm test -w apps/api -- --runInBand tests/integration/scanner/piscina-scan-worker.adapter.spec.ts tests/unit/scanner/infrastructure/workers/pool-size.spec.ts`

### Task 5: Add dedicated BullMQ queues and stable phase jobs

**Files:**
- Modify: `credsScrapper/apps/api/src/modules/scanner/infrastructure/jobs/bullmq-connection.ts`
- Modify: `credsScrapper/apps/api/src/modules/scanner/application/ports/job-queue.port.ts`
- Modify: `credsScrapper/apps/api/src/modules/scanner/infrastructure/jobs/bullmq-job-queue.adapter.ts`
- Modify: `credsScrapper/apps/api/src/modules/scanner/infrastructure/jobs/bullmq-job-worker.ts`
- Test: `credsScrapper/apps/api/tests/integration/scanner/bullmq-job-queue.adapter.spec.ts`
- Test: `credsScrapper/apps/api/tests/integration/scanner/bullmq-job-worker.spec.ts`
- Test: `credsScrapper/apps/api/tests/unit/scanner/infrastructure/jobs/bullmq-scan-result.spec.ts`

**Interfaces:**
- Produces: `enqueuePhase(phase, repoRef, targetSha, payload): Promise<string>`.
- Produces: opaque public IDs `head:<bullId>` and `history:<bullId>`; existing control IDs remain valid.
- Consumes: phase worker ports from Task 4.

- [ ] **Step 1: Write Redis-backed queue isolation and deduplication tests**

Enqueue blocked history, then two HEAD jobs; assert HEAD jobs complete. Enqueue
the same `(phase, repoId, targetSha)` twice and assert one BullMQ job. Complete it,
then enqueue a newer SHA and assert a distinct runnable job. Test stop/getJob for
prefixed and legacy IDs and reject an unknown prefix.

- [ ] **Step 2: Run BullMQ tests with local Redis and verify they fail**

Run: `npm test -w apps/api -- --runInBand tests/integration/scanner/bullmq-job-queue.adapter.spec.ts tests/integration/scanner/bullmq-job-worker.spec.ts`

- [ ] **Step 3: Implement queue routing**

```ts
export const CONTROL_QUEUE = 'scanner-jobs';
export const HEAD_QUEUE = 'scanner-head';
export const HISTORY_QUEUE = 'scanner-history';
```

Set BullMQ worker concurrency to 2 for HEAD and 1 for history. Use a deterministic
job ID derived from phase/repo/SHA, remove completed/failed jobs after a bounded
retention window, and include phase in safe progress messages. Move stop requests
to a Redis-backed key or BullMQ job data so all three workers observe them.

- [ ] **Step 4: Verify real Redis behavior and cleanup**

Run the focused integration tests, then close all workers and queues in
`onModuleDestroy`; assert Jest reports no open handles.

### Task 6: Orchestrate HEAD-first persistence and recoverable history dispatch

**Files:**
- Create: `credsScrapper/apps/api/src/modules/scanner/application/use-cases/scan-repository-phase.use-case.ts`
- Create: `credsScrapper/apps/api/src/modules/scanner/application/use-cases/reconcile-scan-phases.use-case.ts`
- Modify: `credsScrapper/apps/api/src/modules/scanner/application/use-cases/run-scan-loop.use-case.ts`
- Modify: `credsScrapper/apps/api/src/modules/scanner/application/use-cases/scan-repository.use-case.ts`
- Modify: `credsScrapper/apps/api/src/modules/scanner/infrastructure/jobs/bullmq-job-worker.ts`
- Modify: `credsScrapper/apps/api/src/modules/scanner/scanner.module.ts`
- Test: `credsScrapper/apps/api/tests/unit/scanner/application/use-cases/scan-repository.use-case.spec.ts`
- Test: `credsScrapper/apps/api/tests/unit/scanner/application/use-cases/run-scan-loop.use-case.spec.ts`
- Test: `credsScrapper/apps/api/tests/integration/scanner/incremental-scan.spec.ts`

**Interfaces:**
- Produces: `ScanRepositoryPhaseUseCase.execute({ repoRef, phase, targetSha?, ... })`.
- Produces: reconciler that enqueues pending history phase rows lacking a live job.
- Consumes: persistence from Task 1 and phase queues/pools from Tasks 4–5.

- [ ] **Step 1: Write orchestration tests before changing the use-cases**

Test this sequence exactly:

```text
claim HEAD -> shallow scan -> persist findings -> mark HEAD done
-> persist history pending -> enqueue history -> return HEAD success
```

Make enqueue throw after `history pending`; restart the reconciler and assert one
history job is scheduled. Make findings persistence throw and assert neither the
HEAD checkpoint nor history pending advances. Test unchanged HEAD skip, newer
HEAD with history still running, force-push fallback, and concurrent joins by
`repoId + phase` rather than repo ID alone.

- [ ] **Step 2: Run unit/incremental tests and observe old coupled behavior fail**

Run: `npm test -w apps/api -- --runInBand tests/unit/scanner/application/use-cases/scan-repository.use-case.spec.ts tests/unit/scanner/application/use-cases/run-scan-loop.use-case.spec.ts tests/integration/scanner/incremental-scan.spec.ts`

- [ ] **Step 3: Implement phase orchestration and recovery**

The HEAD worker persists findings and successful HEAD coverage before it creates
history pending. The history worker snapshots `targetSha`, persists each compact
finding batch available at completion/cancellation, then updates only history.
On startup and before each bulk run, reconcile pending phases against BullMQ.
Repository-unavailable is failed with automatic retry disabled; transient Git
transport errors use bounded exponential backoff. Explicit user retry resets the
selected phase's retry eligibility.

- [ ] **Step 4: Wire stop propagation**

Stopping a control scan marks undispatched phase rows cancelled, removes queued
child jobs, and signals active child jobs. Wait for Git termination and compacted
finding flush before releasing cache leases. Keep a hard termination fallback
that reports retry-required if buffered findings could not be acknowledged.

- [ ] **Step 5: Verify orchestration and restart recovery**

Run the unit/incremental tests from Step 2 plus real BullMQ integration tests.

### Task 7: Expose phase coverage in API and UI

**Files:**
- Modify: `credsScrapper/apps/api/src/modules/scanner/application/use-cases/get-scanned-repos.use-case.ts`
- Modify: `credsScrapper/apps/api/src/modules/auth/application/use-cases/get-my-scanned-repos.use-case.ts`
- Modify: `credsScrapper/apps/api/src/modules/scanner/domain/types/scanned-repo-record.type.ts`
- Modify: `credsScrapper/apps/web/src/lib/types/scanned-repo.type.ts`
- Modify: `credsScrapper/apps/web/src/components/scanned-repos-table.tsx`
- Modify: `credsScrapper/apps/web/src/components/progress-panel.tsx`
- Test: `credsScrapper/apps/api/tests/unit/scanner/application/use-cases/get-scanned-repos.use-case.spec.ts`
- Test: `credsScrapper/apps/api/tests/unit/auth/application/use-cases/get-my-scanned-repos.use-case.spec.ts`
- Test: `credsScrapper/apps/web/tests/components/scanned-repos-table.spec.tsx`
- Test: `credsScrapper/apps/web/tests/components/progress-panel.spec.tsx`

**Interfaces:**
- Consumes: `IScanPhaseRecord` from Task 1.
- Produces: `headPhase` and `historyPhase` with status, target/completed SHA,
  progress counters and safe reason.

- [ ] **Step 1: Add API and UI tests for coverage differences**

Render HEAD done/history running, HEAD done/history incomplete, both done at
different SHAs, and history unavailable. Assert visible copy says “Current files
checked” and never presents HEAD completion as complete historical coverage.
Assert no secret values or finding context exist in phase DTOs.

- [ ] **Step 2: Run focused API/web tests and confirm missing fields/UI fail**

Run: `npm test -w apps/api -- --runInBand tests/unit/scanner/application/use-cases/get-scanned-repos.use-case.spec.ts tests/unit/auth/application/use-cases/get-my-scanned-repos.use-case.spec.ts`

Run: `npm test -w apps/web -- tests/components/scanned-repos-table.spec.tsx tests/components/progress-panel.spec.tsx`

- [ ] **Step 3: Implement compact phase cells and progress copy**

Show one HEAD line and one History line in the existing status column. Include
short coverage SHA and incomplete/failure reason where present. Update the bulk
completion message to say HEAD processing finished while history may continue.

- [ ] **Step 4: Verify accessibility, sorting and existing empty/error states**

Run the focused UI/API tests and ensure current filters/sorting still operate on
the compatible top-level HEAD-derived status.

### Task 8: Benchmark, review and release verification

**Files:**
- Modify: `credsScrapper/scripts/performance-lab/README.md`
- Create: `credsScrapper/scripts/performance-lab/phase-acquisition.cjs`
- Create: `docs/benchmarks/2026-09-21-head-history-results.json`
- Create: `docs/benchmarks/2026-09-21-head-history-results.md`
- Create: `docs/benchmarks/2026-09-21-head-history-results.png`

**Interfaces:**
- Consumes: completed implementation and synthetic/public fixtures.
- Produces: reproducible time-to-HEAD and history-acquisition evidence, labeled by coverage.

- [ ] **Step 1: Add a safe benchmark harness**

Measure full bare acquisition, shallow HEAD acquisition, time to first persisted
HEAD findings, cache bytes, and history completion separately. Use aggregate
counts and ephemeral fingerprints only; never serialize finding values. Do not
run alongside the user's active scan.

- [ ] **Step 2: Run formatting and type checks on changed backend files**

Run Prettier only on changed TypeScript files, then:

`./node_modules/.bin/tsc --noEmit -p apps/api/tsconfig.json`

- [ ] **Step 3: Run full required verification**

Run:

```text
npm run test -w apps/api
npm run test -w apps/web
npm run build -w apps/api
npm run build -w apps/web
git diff --check
```

Redis-backed integration tests may require the local Redis service; start only
Redis for the test and restore its prior running/stopped state afterward.

- [ ] **Step 4: Apply mandatory project reviews**

Apply `hex-architecture-reviewer`, `secret-handling-reviewer`, and
`lazy-simplifier`. Fix direct infrastructure imports in domain/application,
secret-bearing progress/errors, duplicated phase orchestration, speculative
abstractions, or unnecessary dependencies before rerunning affected tests.

- [ ] **Step 5: Run controlled benchmarks and write the report**

Stop or wait for the user's production scan before network/disk benchmarks.
Compare identical repository snapshots and state explicitly that shallow HEAD
and full history have different coverage. Include raw samples, medians, machine
information and limits. Render and inspect the PNG.

- [ ] **Step 6: Perform rollout check without publishing**

Confirm migration deploy order, stale phase recovery, old-worker shutdown, new
queue startup, and clean Git status scope. Leave implementation uncommitted and
unpushed until the user explicitly requests those actions.
