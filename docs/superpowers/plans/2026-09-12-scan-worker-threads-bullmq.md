# Scan worker-threads + BullMQ job queue — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop repository scans from freezing the whole API server, and make job state (discover/scan) survive a server restart with real queue visibility.

**Architecture:** Part A moves the CPU-heavy scan work (git parsing + secret detection) off the main thread into a fixed-size `piscina` worker-thread pool (max 4). Part B replaces the in-memory job runner with a `bullmq` queue backed by Redis, so jobs persist and a `queued` state exists once the pool is saturated. The two parts are independent and each ends with working, tested software — Part A can ship without Part B and vice versa, but this plan does both.

**Tech Stack:** NestJS (hexagonal: domain/application/infrastructure/presentation), Prisma/SQLite, `piscina` (new), `bullmq` + `ioredis` (new, via `bullmq`), Redis (new runtime dependency, via `docker-compose.yml` — already created and verified with `podman compose up -d redis`), Jest, Next.js/React frontend.

**Spec:** `docs/superpowers/specs/2026-09-12-scan-worker-threads-design.md`

## Global Constraints

- Piscina pool size: `Math.max(1, Math.min(4, os.cpus().length))`, overridable via `SCAN_WORKER_POOL_SIZE` env var. Never uncapped `os.cpus().length`.
- BullMQ `Worker` concurrency: same value as the Piscina pool size constant (reuse one shared constant, don't duplicate the number).
- No change to persisted data shape, detection logic (`scanText`), or existing progress-message text/granularity (cloning → cloned → history done → working tree done → done/failed).
- `GET /jobs/:id`'s response shape (`IJobState`) stays backward-compatible — the frontend's polling/WebSocket-reconnect-replay logic must keep working unchanged except where this plan explicitly touches it (adding `QUEUED`).
- Every new port lives in `application/ports/`, every new adapter in `infrastructure/`, per this codebase's hexagonal layering (domain → application → infrastructure/presentation, one direction only). Run the `hex-architecture-reviewer` agent after finishing all scanner-module changes (see CLAUDE.md's mandatory workflow table).
- Never `git commit` without being told to for that specific action — this plan's "Commit" steps assume the user has already approved this plan's execution; if that approval doesn't cover committing, ask before the first commit step.
- Run `npm run test -w apps/api` and `npm run build -w apps/api` (and the `-w apps/web` equivalents for Part B's frontend task) before considering any task done — a change that compiles is not a change that's verified.

---

## File Structure

**Part A (Piscina):**
- `apps/api/src/modules/scanner/application/use-cases/run-scan-job.use-case.ts` (new) — pure scan logic (clone → diff/file loop → `scanText`), extracted from today's `ScanRepositoryUseCase`. No NestJS, no Prisma — takes a `GitOperationsPort` instance directly.
- `apps/api/src/modules/scanner/application/ports/scan-worker.port.ts` (new) — abstract class the main-thread use-case depends on.
- `apps/api/src/modules/scanner/infrastructure/workers/scan.worker.ts` (new) — Piscina's worker-thread entry point; instantiates `GitCliAdapter` + `RunScanJobUseCase` directly (no DI).
- `apps/api/src/modules/scanner/infrastructure/workers/piscina-scan-worker.adapter.ts` (new) — `ScanWorkerPort` implementation, owns the `Piscina` pool.
- `apps/api/src/modules/scanner/infrastructure/workers/pool-size.ts` (new) — the one shared pool-size constant both Piscina and (later) BullMQ read.
- `apps/api/src/modules/scanner/application/use-cases/scan-repository.use-case.ts` (modified) — becomes a thin orchestrator over `ScanWorkerPort`.
- `apps/api/src/modules/scanner/scanner.module.ts` (modified) — DI wiring.
- Tests: `apps/api/tests/unit/scanner/application/use-cases/run-scan-job.use-case.spec.ts` (new, absorbs most of today's `scan-repository.use-case.spec.ts` behavior coverage), `scan-repository.use-case.spec.ts` (rewritten, now mocks `ScanWorkerPort`), `apps/api/tests/integration/scanner/piscina-scan-worker.adapter.spec.ts` (new).

**Part B (BullMQ + Redis):**
- `apps/api/src/modules/scanner/application/ports/job-queue.port.ts` (new).
- `apps/api/src/modules/scanner/infrastructure/jobs/bullmq-job-queue.adapter.ts` (new) — implements `JobQueuePort` (`enqueue`/`getJob`).
- `apps/api/src/modules/scanner/infrastructure/jobs/bullmq-job-worker.ts` (new) — the BullMQ `Worker`, dispatches by job name.
- `apps/api/src/modules/scanner/domain/constant/job-status.constant.ts` (modified) — add `EJobStatus.QUEUED`.
- `apps/api/src/modules/scanner/domain/types/job-progress-event.type.ts`, `apps/api/src/modules/scanner/infrastructure/jobs/in-memory-job-runner.ts` (deleted once nothing references it) — `IJobState` moves to `job-progress-event.type.ts` or a new `job-state.type.ts` (domain layer, since it's no longer owned by the deleted `InMemoryJobRunner`).
- `apps/api/src/modules/scanner/presentation/scan.controller.ts`, `discover.controller.ts`, `jobs.controller.ts` (modified) — use `JobQueuePort` instead of `InMemoryJobRunner`.
- `apps/api/src/modules/auth/application/use-cases/scan-my-repo.use-case.ts` (modified) — enqueues instead of awaiting inline.
- `apps/api/src/modules/auth/presentation/repo-authorizations.controller.ts` (modified) — return shape becomes `{ repoId, jobId }`.
- `apps/api/src/main.ts` (modified) — `app.enableShutdownHooks()` so `OnModuleDestroy` actually fires.
- `apps/api/src/modules/scanner/scanner.module.ts` (modified again).
- `apps/web/src/lib/api-client.ts`, `apps/web/src/lib/constant/job-status.constant.ts`, `apps/web/src/components/progress-panel.tsx`, `apps/web/src/components/my-repos-panel.tsx` (modified).
- Tests: `apps/api/tests/unit/scanner/infrastructure/jobs/bullmq-job-queue.adapter.spec.ts` (new, real Redis), `apps/api/tests/unit/auth/application/use-cases/scan-my-repo.use-case.spec.ts` (rewritten).

---

# Part A: Piscina worker-thread pool

### Task 1: Shared pool-size constant

**Files:**
- Create: `apps/api/src/modules/scanner/infrastructure/workers/pool-size.ts`
- Test: `apps/api/tests/unit/scanner/infrastructure/workers/pool-size.spec.ts`

**Interfaces:**
- Produces: `SCAN_WORKER_POOL_SIZE: number` (a computed constant, not a function) — imported by `PiscinaScanWorkerAdapter` (Task 5) and `BullmqJobWorker` (Part B, Task 12).

- [ ] **Step 1: Write the failing test**

```typescript
// apps/api/tests/unit/scanner/infrastructure/workers/pool-size.spec.ts
describe('SCAN_WORKER_POOL_SIZE', () => {
  const originalEnv = process.env.SCAN_WORKER_POOL_SIZE;
  const originalCpus = require('node:os').cpus;

  afterEach(() => {
    process.env.SCAN_WORKER_POOL_SIZE = originalEnv;
    require('node:os').cpus = originalCpus;
    jest.resetModules();
  });

  it('caps at 4 even when the host has more cores', () => {
    delete process.env.SCAN_WORKER_POOL_SIZE;
    require('node:os').cpus = () => new Array(16).fill({});
    jest.resetModules();
    const { SCAN_WORKER_POOL_SIZE } = require('../../../../../src/modules/scanner/infrastructure/workers/pool-size');
    expect(SCAN_WORKER_POOL_SIZE).toBe(4);
  });

  it('uses the host core count when fewer than 4', () => {
    delete process.env.SCAN_WORKER_POOL_SIZE;
    require('node:os').cpus = () => new Array(2).fill({});
    jest.resetModules();
    const { SCAN_WORKER_POOL_SIZE } = require('../../../../../src/modules/scanner/infrastructure/workers/pool-size');
    expect(SCAN_WORKER_POOL_SIZE).toBe(2);
  });

  it('honors SCAN_WORKER_POOL_SIZE when set', () => {
    process.env.SCAN_WORKER_POOL_SIZE = '7';
    jest.resetModules();
    const { SCAN_WORKER_POOL_SIZE } = require('../../../../../src/modules/scanner/infrastructure/workers/pool-size');
    expect(SCAN_WORKER_POOL_SIZE).toBe(7);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w apps/api -- pool-size.spec.ts`
Expected: FAIL with "Cannot find module '.../pool-size'"

- [ ] **Step 3: Write minimal implementation**

```typescript
// apps/api/src/modules/scanner/infrastructure/workers/pool-size.ts
import * as os from 'node:os';

// Deliberately NOT `os.cpus().length` uncapped - running this on a
// developer machine with more cores shouldn't try to pin all of them
// just because a scan is being tested locally. 4 is the default ceiling;
// SCAN_WORKER_POOL_SIZE overrides it for ops tuning in prod.
export const SCAN_WORKER_POOL_SIZE: number = process.env.SCAN_WORKER_POOL_SIZE
  ? Number(process.env.SCAN_WORKER_POOL_SIZE)
  : Math.max(1, Math.min(4, os.cpus().length));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w apps/api -- pool-size.spec.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/scanner/infrastructure/workers/pool-size.ts apps/api/tests/unit/scanner/infrastructure/workers/pool-size.spec.ts
git commit -m "feat(scanner): add shared scan-worker pool-size constant"
```

---

### Task 2: `RunScanJobUseCase` — extract the pure scan logic

This is the core of Part A: today's `ScanRepositoryUseCase.execute()` body (minus workdir cleanup and Prisma writes) becomes a standalone, framework-free class that will run inside a worker thread. It emits events instead of calling `state.addFinding`/`logger.log` directly.

**Files:**
- Create: `apps/api/src/modules/scanner/application/use-cases/run-scan-job.use-case.ts`
- Test: `apps/api/tests/unit/scanner/application/use-cases/run-scan-job.use-case.spec.ts`

**Interfaces:**
- Consumes: `GitOperationsPort` (existing, unchanged: `cloneBare`, `getHeadCommit`, `listFilesAtHead`, `readFileAtHead`, `iterCommitDiffs`), `IRepoRef` (existing), `scanText` from `../../domain/detection/engine` (existing), `isExcludedPath` from `../../domain/detection/path-exclusion` (existing).
- Produces: `IScanJobEvent` (discriminated union), `TScanJobResult`, `RunScanJobUseCase` class with `execute(repoRef: IRepoRef, cloneSource: string, workdir: string, onEvent: (event: IScanJobEvent) => void): Promise<TScanJobResult>`. Used by `scan.worker.ts` (Task 4) and this task's own tests. `TScanJobResult` is consumed by `ScanRepositoryUseCase` (Task 6) via `ScanWorkerPort` (Task 3) — same shape.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/api/tests/unit/scanner/application/use-cases/run-scan-job.use-case.spec.ts
import { GitOperationsPort } from '../../../../../src/modules/scanner/application/ports/git-operations.port';
import { RunScanJobUseCase } from '../../../../../src/modules/scanner/application/use-cases/run-scan-job.use-case';

class FakeGit extends GitOperationsPort {
  headSha = 'a'.repeat(40);
  files: Record<string, string | null> = {};
  diffs: Array<{ commitSha: string; diffText: string }> = [];
  cloneShouldFail = false;

  async cloneBare(): Promise<void> {
    if (this.cloneShouldFail) {
      throw new Error('clone failed');
    }
  }

  async getHeadCommit(): Promise<string> {
    return this.headSha;
  }

  async listFilesAtHead(): Promise<string[]> {
    return Object.keys(this.files);
  }

  async readFileAtHead(_repoPath: string, filePath: string): Promise<string | null> {
    return this.files[filePath];
  }

  async iterCommitDiffs(): Promise<Array<{ commitSha: string; diffText: string }>> {
    return this.diffs;
  }
}

describe('RunScanJobUseCase', () => {
  const ref = { repoId: 1, owner: 'octocat', name: 'hello-world' };

  it('emits a finding event for a secret in the working tree and resolves done', async () => {
    const git = new FakeGit();
    git.files = { 'config.py': "AWS_KEY = 'AKIAABCDEFGH12345678'\n" };
    const useCase = new RunScanJobUseCase(git);
    const events: unknown[] = [];

    const result = await useCase.execute(ref, 'https://example.com/repo.git', 'workdir/repo-1', (e) => events.push(e));

    expect(result).toEqual({ status: 'done', headSha: git.headSha });
    const findingEvents = events.filter((e: any) => e.type === 'finding');
    expect(findingEvents).toHaveLength(1);
    expect((findingEvents[0] as any).finding.secretValue).toBe('AKIAABCDEFGH12345678');
    expect((findingEvents[0] as any).filePath).toBe('config.py');
    expect((findingEvents[0] as any).commitSha).toBe(git.headSha);
  });

  it('skips a binary file (readFileAtHead returns null) without failing', async () => {
    const git = new FakeGit();
    git.files = { 'image.png': null };
    const useCase = new RunScanJobUseCase(git);
    const events: unknown[] = [];

    const result = await useCase.execute(ref, 'https://example.com/repo.git', 'workdir/repo-1', (e) => events.push(e));

    expect(result).toEqual({ status: 'done', headSha: git.headSha });
    expect(events.filter((e: any) => e.type === 'finding')).toHaveLength(0);
  });

  it('skips a test file even when it contains a real-looking secret pattern', async () => {
    const git = new FakeGit();
    git.files = {
      'tests/test_secrets.py': "AWS_KEY = 'AKIAABCDEFGH12345678'\n",
      'src/config.py': "AWS_KEY = 'AKIAABCDEFGH12345699'\n",
    };
    const useCase = new RunScanJobUseCase(git);
    const events: unknown[] = [];

    await useCase.execute(ref, 'https://example.com/repo.git', 'workdir/repo-1', (e) => events.push(e));

    const findingEvents = events.filter((e: any) => e.type === 'finding');
    expect(findingEvents).toHaveLength(1);
    expect((findingEvents[0] as any).filePath).toBe('src/config.py');
  });

  it('emits a finding event for a secret in commit history, tagged with the commit sha', async () => {
    const git = new FakeGit();
    git.diffs = [{ commitSha: 'deadbeef', diffText: "+AWS_KEY = 'AKIAABCDEFGH12345678'\n" }];
    const useCase = new RunScanJobUseCase(git);
    const events: unknown[] = [];

    await useCase.execute(ref, 'https://example.com/repo.git', 'workdir/repo-1', (e) => events.push(e));

    const findingEvents = events.filter((e: any) => e.type === 'finding');
    expect(findingEvents).toHaveLength(1);
    expect((findingEvents[0] as any).commitSha).toBe('deadbeef');
    expect((findingEvents[0] as any).filePath).toBe('<commit-diff>');
  });

  it('resolves failed (not a rejected promise) when cloning throws', async () => {
    const git = new FakeGit();
    git.cloneShouldFail = true;
    const useCase = new RunScanJobUseCase(git);
    const events: unknown[] = [];

    const result = await useCase.execute(ref, 'https://example.com/repo.git', 'workdir/repo-1', (e) => events.push(e));

    expect(result).toEqual({ status: 'failed', failReason: 'clone failed' });
  });

  it('emits progress events for each stage, matching today\'s exact message text', async () => {
    const git = new FakeGit();
    git.files = { 'config.py': "AWS_KEY = 'AKIAABCDEFGH12345678'\n" };
    const useCase = new RunScanJobUseCase(git);
    const messages: string[] = [];

    await useCase.execute(ref, 'https://example.com/repo.git', 'workdir/repo-1', (e: any) => {
      if (e.type === 'progress') messages.push(e.message);
    });

    expect(messages).toEqual([
      'scan: octocat/hello-world - cloning',
      `scan: octocat/hello-world - cloned, head=${git.headSha}, scanning commit history`,
      'scan: octocat/hello-world - commit history done (0 findings), scanning working tree',
      'scan: octocat/hello-world - done, 1 findings total',
    ]);
  });

  it('emits a failure progress message when cloning throws', async () => {
    const git = new FakeGit();
    git.cloneShouldFail = true;
    const useCase = new RunScanJobUseCase(git);
    const messages: string[] = [];

    await useCase.execute(ref, 'https://example.com/repo.git', 'workdir/repo-1', (e: any) => {
      if (e.type === 'progress') messages.push(e.message);
    });

    expect(messages).toEqual([
      'scan: octocat/hello-world - cloning',
      'scan: octocat/hello-world - failed: clone failed',
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w apps/api -- run-scan-job.use-case.spec.ts`
Expected: FAIL with "Cannot find module '.../run-scan-job.use-case'"

- [ ] **Step 3: Write minimal implementation**

```typescript
// apps/api/src/modules/scanner/application/use-cases/run-scan-job.use-case.ts
import { scanText } from '../../domain/detection/engine';
import { isExcludedPath } from '../../domain/detection/path-exclusion';
import { IFinding } from '../../domain/types/finding.type';
import { IRepoRef } from '../../domain/types/repo-ref.type';
import { GitOperationsPort } from '../ports/git-operations.port';

export type IScanJobEvent =
  | { readonly type: 'progress'; readonly message: string }
  | {
      readonly type: 'finding';
      readonly filePath: string;
      readonly commitSha: string;
      readonly finding: IFinding;
    };

export type TScanJobResult =
  | { readonly status: 'done'; readonly headSha: string }
  | { readonly status: 'failed'; readonly failReason: string };

// This is `ScanRepositoryUseCase`'s old body, unchanged in logic, moved
// here so it can run inside a worker thread (see infrastructure/workers/
// scan.worker.ts) with zero NestJS/Prisma dependency - it never throws,
// resolving `{ status: 'failed', failReason }` instead, so the worker
// boundary never needs to distinguish "expected failure" from "thrown
// error" on top of Piscina's own crash handling.
export class RunScanJobUseCase {
  constructor(private readonly git: GitOperationsPort) {}

  async execute(
    repoRef: IRepoRef,
    cloneSource: string,
    workdir: string,
    onEvent: (event: IScanJobEvent) => void,
  ): Promise<TScanJobResult> {
    const report = (message: string) => onEvent({ type: 'progress', message });

    report(`scan: ${repoRef.owner}/${repoRef.name} - cloning`);
    try {
      await this.git.cloneBare(cloneSource, workdir);
      const headSha = await this.git.getHeadCommit(workdir);
      report(
        `scan: ${repoRef.owner}/${repoRef.name} - cloned, head=${headSha}, scanning commit history`,
      );

      let findingsCount = 0;
      for (const { commitSha, diffText } of await this.git.iterCommitDiffs(workdir)) {
        for (const finding of scanText(diffText)) {
          onEvent({ type: 'finding', filePath: '<commit-diff>', commitSha, finding });
          findingsCount += 1;
        }
      }

      report(
        `scan: ${repoRef.owner}/${repoRef.name} - commit history done (${findingsCount} findings), scanning working tree`,
      );

      for (const filePath of await this.git.listFilesAtHead(workdir)) {
        if (isExcludedPath(filePath)) {
          continue;
        }
        const text = await this.git.readFileAtHead(workdir, filePath);
        if (text === null) {
          continue;
        }
        for (const finding of scanText(text)) {
          onEvent({ type: 'finding', filePath, commitSha: headSha, finding });
          findingsCount += 1;
        }
      }

      report(`scan: ${repoRef.owner}/${repoRef.name} - done, ${findingsCount} findings total`);
      return { status: 'done', headSha };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      report(`scan: ${repoRef.owner}/${repoRef.name} - failed: ${message}`);
      return { status: 'failed', failReason: message };
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w apps/api -- run-scan-job.use-case.spec.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/scanner/application/use-cases/run-scan-job.use-case.ts apps/api/tests/unit/scanner/application/use-cases/run-scan-job.use-case.spec.ts
git commit -m "feat(scanner): extract pure scan logic into RunScanJobUseCase"
```

---

### Task 3: `ScanWorkerPort`

**Files:**
- Create: `apps/api/src/modules/scanner/application/ports/scan-worker.port.ts`

**Interfaces:**
- Consumes: `IRepoRef` (existing), `IScanJobEvent`/`TScanJobResult` (Task 2).
- Produces: `ScanWorkerPort` abstract class, `run(repoRef, cloneSource, workdir, onEvent): Promise<TScanJobResult>`. Implemented by `PiscinaScanWorkerAdapter` (Task 5); consumed by `ScanRepositoryUseCase` (Task 6).

No test for this file — it's a single abstract class with no logic, exactly like every other port in this codebase (`git-operations.port.ts`, `workdir-cleaner.port.ts`, etc., which also have no dedicated spec file).

- [ ] **Step 1: Write the port**

```typescript
// apps/api/src/modules/scanner/application/ports/scan-worker.port.ts
import { IRepoRef } from '../../domain/types/repo-ref.type';
import { IScanJobEvent, TScanJobResult } from '../use-cases/run-scan-job.use-case';

// The CPU-heavy part of a scan (clone + diff parsing + secret detection)
// runs off the main thread behind this port, so ScanRepositoryUseCase
// never blocks the event loop regardless of repo size. See
// infrastructure/workers/piscina-scan-worker.adapter.ts.
export abstract class ScanWorkerPort {
  abstract run(
    repoRef: IRepoRef,
    cloneSource: string,
    workdir: string,
    onEvent: (event: IScanJobEvent) => void,
  ): Promise<TScanJobResult>;
}
```

- [ ] **Step 2: Verify the project still builds**

Run: `npm run build -w apps/api`
Expected: SUCCESS (this file isn't wired into anything yet, so nothing else changes)

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/scanner/application/ports/scan-worker.port.ts
git commit -m "feat(scanner): add ScanWorkerPort"
```

---

### Task 4: `scan.worker.ts` — the Piscina worker-thread entry point

**Files:**
- Create: `apps/api/src/modules/scanner/infrastructure/workers/scan.worker.ts`
- Test: `apps/api/tests/unit/scanner/infrastructure/workers/scan.worker.spec.ts`

**Interfaces:**
- Consumes: `GitCliAdapter` (existing, instantiated directly with `new` — no DI, since worker threads can't reach the NestJS container), `RunScanJobUseCase` (Task 2).
- Produces: a default-exported async function `(data: IScanWorkerTaskData) => Promise<TScanJobResult>`, the shape Piscina invokes as a task. `IScanWorkerTaskData = { repoRef: IRepoRef; cloneSource: string; workdir: string; port: MessagePort }`. Consumed by `PiscinaScanWorkerAdapter` (Task 5), which is the only thing that constructs `IScanWorkerTaskData` and passes it to `pool.run(...)`.

- [ ] **Step 1: Write the failing test**

This test imports the worker file's default export directly (as plain code, not through Piscina) to verify it wires `RunScanJobUseCase` to the given `MessagePort` correctly — Piscina's own thread-spawning mechanics are covered separately in Task 5's integration test.

```typescript
// apps/api/tests/unit/scanner/infrastructure/workers/scan.worker.spec.ts
import { MessageChannel } from 'node:worker_threads';

jest.mock('../../../../../src/modules/scanner/infrastructure/git/git-cli-adapter', () => ({
  GitCliAdapter: jest.fn().mockImplementation(() => ({
    cloneBare: jest.fn().mockResolvedValue(undefined),
    getHeadCommit: jest.fn().mockResolvedValue('a'.repeat(40)),
    listFilesAtHead: jest.fn().mockResolvedValue([]),
    readFileAtHead: jest.fn().mockResolvedValue(null),
    iterCommitDiffs: jest.fn().mockResolvedValue([]),
  })),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
import runScanTask from '../../../../../src/modules/scanner/infrastructure/workers/scan.worker';

describe('scan.worker default export', () => {
  it('runs the scan and posts progress events on the given port, then resolves the result', async () => {
    const { port1, port2 } = new MessageChannel();
    const received: unknown[] = [];
    port1.on('message', (m) => received.push(m));

    const result = await runScanTask({
      repoRef: { repoId: 1, owner: 'octocat', name: 'hello-world' },
      cloneSource: 'https://example.com/repo.git',
      workdir: 'workdir/repo-1',
      port: port2,
    });

    port1.close();
    port2.close();
    expect(result).toEqual({ status: 'done', headSha: 'a'.repeat(40) });
    expect(received.length).toBeGreaterThan(0);
    expect((received[0] as any).type).toBe('progress');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w apps/api -- scan.worker.spec.ts`
Expected: FAIL with "Cannot find module '.../scan.worker'"

- [ ] **Step 3: Write minimal implementation**

```typescript
// apps/api/src/modules/scanner/infrastructure/workers/scan.worker.ts
import { MessagePort } from 'node:worker_threads';
import { RunScanJobUseCase, TScanJobResult } from '../../application/use-cases/run-scan-job.use-case';
import { IRepoRef } from '../../domain/types/repo-ref.type';
import { GitCliAdapter } from '../git/git-cli-adapter';

export interface IScanWorkerTaskData {
  readonly repoRef: IRepoRef;
  readonly cloneSource: string;
  readonly workdir: string;
  readonly port: MessagePort;
}

// Piscina's task entry point - runs inside a worker thread, so it can't
// reach NestJS's DI container. GitCliAdapter is a plain class (its
// @Injectable() decorator is inert without Nest's container), so it's
// instantiated directly here instead.
export default async function runScanTask(data: IScanWorkerTaskData): Promise<TScanJobResult> {
  const useCase = new RunScanJobUseCase(new GitCliAdapter());
  return useCase.execute(data.repoRef, data.cloneSource, data.workdir, (event) => {
    data.port.postMessage(event);
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w apps/api -- scan.worker.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/scanner/infrastructure/workers/scan.worker.ts apps/api/tests/unit/scanner/infrastructure/workers/scan.worker.spec.ts
git commit -m "feat(scanner): add scan.worker.ts Piscina task entry point"
```

---

### Task 5: `piscina` dependency + `PiscinaScanWorkerAdapter`

**Files:**
- Modify: `apps/api/package.json` (add `piscina` dependency)
- Create: `apps/api/src/modules/scanner/infrastructure/workers/piscina-scan-worker.adapter.ts`
- Test: `apps/api/tests/integration/scanner/piscina-scan-worker.adapter.spec.ts`

**Interfaces:**
- Consumes: `ScanWorkerPort` (Task 3), `SCAN_WORKER_POOL_SIZE` (Task 1), the compiled `scan.worker.js` (Task 4, referenced by path at runtime).
- Produces: `PiscinaScanWorkerAdapter implements ScanWorkerPort`. Bound to `ScanWorkerPort` in `scanner.module.ts` (Task 7).

- [ ] **Step 1: Install the dependency**

```bash
cd apps/api && npm install piscina
```

- [ ] **Step 2: Build once so `scan.worker.ts` has a compiled `.js` counterpart to point at**

Run: `npm run build -w apps/api`
Expected: SUCCESS, and `apps/api/dist/modules/scanner/infrastructure/workers/scan.worker.js` exists.

Verify: `test -f apps/api/dist/modules/scanner/infrastructure/workers/scan.worker.js && echo OK`

- [ ] **Step 3: Write the failing integration test**

This is an integration test (real Piscina, real worker threads spawned) — same "real service, no mocks" spirit as `prisma-state-repository.spec.ts`. It runs an actual scan against a real local git repo created on the fly, so it doesn't depend on network access.

```typescript
// apps/api/tests/integration/scanner/piscina-scan-worker.adapter.spec.ts
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { PiscinaScanWorkerAdapter } from '../../../src/modules/scanner/infrastructure/workers/piscina-scan-worker.adapter';

const execFileAsync = promisify(execFile);

async function makeLocalRepoWithSecret(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'piscina-test-repo-'));
  await execFileAsync('git', ['init', '-q', dir]);
  await execFileAsync('git', ['-C', dir, 'config', 'user.email', 'test@example.com']);
  await execFileAsync('git', ['-C', dir, 'config', 'user.name', 'Test']);
  await fs.writeFile(path.join(dir, 'config.py'), "AWS_KEY = 'AKIAABCDEFGH12345678'\n");
  await execFileAsync('git', ['-C', dir, 'add', '.']);
  await execFileAsync('git', ['-C', dir, 'commit', '-q', '-m', 'initial']);
  return dir;
}

describe('PiscinaScanWorkerAdapter (real worker threads)', () => {
  let adapter: PiscinaScanWorkerAdapter;
  let sourceRepo: string;
  let workdir: string;

  beforeAll(async () => {
    adapter = new PiscinaScanWorkerAdapter();
    sourceRepo = await makeLocalRepoWithSecret();
    workdir = await fs.mkdtemp(path.join(os.tmpdir(), 'piscina-test-workdir-'));
    await fs.rmdir(workdir); // cloneBare needs the destination to not exist yet
  });

  afterAll(async () => {
    await adapter.close();
    await fs.rm(sourceRepo, { recursive: true, force: true });
    await fs.rm(workdir, { recursive: true, force: true });
  });

  it('clones, scans, and finds the seeded secret via a real worker thread', async () => {
    const events: unknown[] = [];
    const result = await adapter.run(
      { repoId: 1, owner: 'test', name: 'repo' },
      sourceRepo,
      workdir,
      (event) => events.push(event),
    );

    expect(result.status).toBe('done');
    const findingEvents = events.filter((e: any) => e.type === 'finding');
    expect(findingEvents).toHaveLength(1);
    expect((findingEvents[0] as any).finding.secretValue).toBe('AKIAABCDEFGH12345678');
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm run test:integration -w apps/api -- piscina-scan-worker.adapter.spec.ts`
Expected: FAIL with "Cannot find module '.../piscina-scan-worker.adapter'"

- [ ] **Step 5: Write minimal implementation**

```typescript
// apps/api/src/modules/scanner/infrastructure/workers/piscina-scan-worker.adapter.ts
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import * as path from 'node:path';
import { MessageChannel } from 'node:worker_threads';
import Piscina from 'piscina';
import { ScanWorkerPort } from '../../application/ports/scan-worker.port';
import { IScanJobEvent, TScanJobResult } from '../../application/use-cases/run-scan-job.use-case';
import { IRepoRef } from '../../domain/types/repo-ref.type';
import { SCAN_WORKER_POOL_SIZE } from './pool-size';

@Injectable()
export class PiscinaScanWorkerAdapter extends ScanWorkerPort implements OnModuleDestroy {
  // `scan.worker.js` (compiled sibling of scan.worker.ts) - resolved
  // relative to this file's own compiled location in dist/, so it works
  // the same in dev (`nest start`, which builds to dist/ via tsc, not
  // ts-node) and in prod (`node dist/main`).
  private readonly pool = new Piscina({
    filename: path.resolve(__dirname, 'scan.worker.js'),
    maxThreads: SCAN_WORKER_POOL_SIZE,
  });

  async run(
    repoRef: IRepoRef,
    cloneSource: string,
    workdir: string,
    onEvent: (event: IScanJobEvent) => void,
  ): Promise<TScanJobResult> {
    const { port1, port2 } = new MessageChannel();
    port1.on('message', (event: IScanJobEvent) => onEvent(event));
    try {
      return await this.pool.run(
        { repoRef, cloneSource, workdir, port: port2 },
        { transferList: [port2] },
      );
    } finally {
      port1.close();
    }
  }

  async close(): Promise<void> {
    await this.pool.destroy();
  }

  async onModuleDestroy(): Promise<void> {
    await this.close();
  }
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm run test:integration -w apps/api -- piscina-scan-worker.adapter.spec.ts`
Expected: PASS (this spawns a real worker thread and a real `git init` in a temp dir — allow extra time; the existing jest config's `testTimeout: 30000` already covers this)

- [ ] **Step 7: Commit**

```bash
git add apps/api/package.json apps/api/package-lock.json apps/api/src/modules/scanner/infrastructure/workers/piscina-scan-worker.adapter.ts apps/api/tests/integration/scanner/piscina-scan-worker.adapter.spec.ts
git commit -m "feat(scanner): add PiscinaScanWorkerAdapter with a real worker-thread pool"
```

---

### Task 6: Rewrite `ScanRepositoryUseCase` to use `ScanWorkerPort`

**Files:**
- Modify: `apps/api/src/modules/scanner/application/use-cases/scan-repository.use-case.ts`
- Modify (rewrite): `apps/api/tests/unit/scanner/application/use-cases/scan-repository.use-case.spec.ts`

**Interfaces:**
- Consumes: `ScanWorkerPort` (Task 3, replaces `GitOperationsPort`), `StateRepositoryPort` (existing, unchanged), `LoggerPort` (existing, unchanged), `WorkdirCleanerPort` (existing, unchanged).
- Produces: `ScanRepositoryUseCase` — **public contract unchanged**: `execute(repoRef, cloneSource, workdir, onProgress?): Promise<void>`. `RunScanLoopUseCase` and `ScanMyRepoUseCase` need no changes for this task (verified: both call `scanRepository.execute(...)` with this exact signature and don't touch its constructor).

- [ ] **Step 1: Write the failing test (full rewrite — old file mocked `GitOperationsPort` directly, this one mocks `ScanWorkerPort`)**

```typescript
// apps/api/tests/unit/scanner/application/use-cases/scan-repository.use-case.spec.ts
import { ScanWorkerPort } from '../../../../../src/modules/scanner/application/ports/scan-worker.port';
import { WorkdirCleanerPort } from '../../../../../src/modules/scanner/application/ports/workdir-cleaner.port';
import { ScanRepositoryUseCase } from '../../../../../src/modules/scanner/application/use-cases/scan-repository.use-case';
import { IScanJobEvent, TScanJobResult } from '../../../../../src/modules/scanner/application/use-cases/run-scan-job.use-case';
import { ESecretType } from '../../../../../src/modules/scanner/domain/constant/secret-type.constant';
import { EScanStatus } from '../../../../../src/modules/scanner/domain/constant/scan-status.constant';
import { FakeLogger } from '../../fakes/fake-logger';
import { FakeStateRepository } from '../../fakes/fake-state-repository';

class FakeScanWorker extends ScanWorkerPort {
  events: IScanJobEvent[] = [];
  result: TScanJobResult = { status: 'done', headSha: 'a'.repeat(40) };

  async run(
    _repoRef: unknown,
    _cloneSource: string,
    _workdir: string,
    onEvent: (event: IScanJobEvent) => void,
  ): Promise<TScanJobResult> {
    for (const event of this.events) {
      onEvent(event);
    }
    return this.result;
  }
}

class FakeWorkdirCleaner extends WorkdirCleanerPort {
  removed: string[] = [];
  async remove(path: string): Promise<void> {
    this.removed.push(path);
  }
}

describe('ScanRepositoryUseCase', () => {
  const ref = { repoId: 1, owner: 'octocat', name: 'hello-world' };

  it('persists each finding event from the worker and marks the repo done', async () => {
    const worker = new FakeScanWorker();
    worker.events = [
      {
        type: 'finding',
        filePath: 'config.py',
        commitSha: 'a'.repeat(40),
        finding: { secretType: ESecretType.AWS_ACCESS_KEY_ID, secretValue: 'AKIAABCDEFGH12345678', lineNumber: 1, context: null },
      },
    ];
    const state = new FakeStateRepository();
    const useCase = new ScanRepositoryUseCase(worker, state, new FakeLogger(), new FakeWorkdirCleaner());
    await state.addCandidate(1, 'octocat', 'hello-world');
    await state.claimNext();

    await useCase.execute(ref, 'https://example.com/repo.git', 'workdir/repo-1');

    expect(state.scanned.get(1)?.status).toBe(EScanStatus.DONE);
    expect(state.findings).toHaveLength(1);
    expect(state.findings[0].secretValue).toBe('AKIAABCDEFGH12345678');
  });

  it('forwards progress events through onProgress', async () => {
    const worker = new FakeScanWorker();
    worker.events = [{ type: 'progress', message: 'scan: octocat/hello-world - cloning' }];
    const state = new FakeStateRepository();
    const useCase = new ScanRepositoryUseCase(worker, state, new FakeLogger(), new FakeWorkdirCleaner());
    await state.addCandidate(1, 'octocat', 'hello-world');
    await state.claimNext();
    const messages: string[] = [];

    await useCase.execute(ref, 'https://example.com/repo.git', 'workdir/repo-1', (m) => messages.push(m));

    expect(messages).toContain('scan: octocat/hello-world - cloning');
  });

  it('marks the repo failed when the worker resolves a failed result', async () => {
    const worker = new FakeScanWorker();
    worker.result = { status: 'failed', failReason: 'clone failed' };
    const state = new FakeStateRepository();
    const useCase = new ScanRepositoryUseCase(worker, state, new FakeLogger(), new FakeWorkdirCleaner());
    await state.addCandidate(1, 'octocat', 'hello-world');
    await state.claimNext();

    await useCase.execute(ref, 'https://example.com/repo.git', 'workdir/repo-1');

    expect(state.scanned.get(1)?.status).toBe(EScanStatus.FAILED);
  });

  it('cleans the workdir before dispatching and again after', async () => {
    const worker = new FakeScanWorker();
    const state = new FakeStateRepository();
    const cleaner = new FakeWorkdirCleaner();
    const useCase = new ScanRepositoryUseCase(worker, state, new FakeLogger(), cleaner);
    await state.addCandidate(1, 'octocat', 'hello-world');
    await state.claimNext();

    await useCase.execute(ref, 'https://example.com/repo.git', 'workdir/repo-1');

    expect(cleaner.removed).toEqual(['workdir/repo-1', 'workdir/repo-1']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w apps/api -- scan-repository.use-case.spec.ts`
Expected: FAIL (constructor signature mismatch — the old implementation still takes `GitOperationsPort` as its first argument)

- [ ] **Step 3: Rewrite the implementation**

```typescript
// apps/api/src/modules/scanner/application/use-cases/scan-repository.use-case.ts
import { IRepoRef } from '../../domain/types/repo-ref.type';
import { ScanWorkerPort } from '../ports/scan-worker.port';
import { LoggerPort } from '../ports/logger.port';
import { StateRepositoryPort } from '../ports/state-repository.port';
import { WorkdirCleanerPort } from '../ports/workdir-cleaner.port';

// The CPU-heavy work (clone, diff parsing, secret detection) now runs in
// a worker thread behind ScanWorkerPort (see RunScanJobUseCase /
// infrastructure/workers) - this class is the main-thread orchestrator:
// clean the workdir, dispatch, persist whatever comes back, clean again.
export class ScanRepositoryUseCase {
  constructor(
    private readonly scanWorker: ScanWorkerPort,
    private readonly state: StateRepositoryPort,
    private readonly logger: LoggerPort,
    private readonly workdirCleaner: WorkdirCleanerPort,
  ) {}

  async execute(
    repoRef: IRepoRef,
    cloneSource: string,
    workdir: string,
    onProgress?: (message: string) => void,
  ): Promise<void> {
    await this.workdirCleaner.remove(workdir);
    let pendingWrites: Promise<void> = Promise.resolve();

    try {
      const result = await this.scanWorker.run(repoRef, cloneSource, workdir, (event) => {
        if (event.type === 'progress') {
          this.logger.log(event.message);
          onProgress?.(event.message);
          return;
        }
        pendingWrites = pendingWrites.then(() =>
          this.state.addFinding(
            repoRef.repoId,
            repoRef.owner,
            repoRef.name,
            event.filePath,
            event.commitSha,
            event.finding.secretType,
            event.finding.secretValue,
            event.finding.lineNumber,
            event.finding.context,
          ),
        );
      });
      await pendingWrites;

      if (result.status === 'done') {
        await this.state.markDone(repoRef.repoId, result.headSha);
      } else {
        await this.state.markFailed(repoRef.repoId, result.failReason);
      }
    } finally {
      await this.workdirCleaner.remove(workdir);
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w apps/api -- scan-repository.use-case.spec.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/scanner/application/use-cases/scan-repository.use-case.ts apps/api/tests/unit/scanner/application/use-cases/scan-repository.use-case.spec.ts
git commit -m "refactor(scanner): ScanRepositoryUseCase orchestrates ScanWorkerPort instead of scanning inline"
```

---

### Task 7: Wire Part A into `scanner.module.ts`

**Files:**
- Modify: `apps/api/src/modules/scanner/scanner.module.ts`

**Interfaces:**
- Consumes: `ScanWorkerPort` (Task 3), `PiscinaScanWorkerAdapter` (Task 5).
- Produces: nothing new — this task only rewires existing DI bindings.

- [ ] **Step 1: Edit the module**

In `apps/api/src/modules/scanner/scanner.module.ts`:

Add imports:
```typescript
import { ScanWorkerPort } from './application/ports/scan-worker.port';
import { PiscinaScanWorkerAdapter } from './infrastructure/workers/piscina-scan-worker.adapter';
```

Change the `ScanRepositoryUseCase` provider from:
```typescript
    provideUseCase(
      ScanRepositoryUseCase,
      [GitOperationsPort, StateRepositoryPort, LoggerPort, WorkdirCleanerPort],
      (git, state, logger, cleaner) => new ScanRepositoryUseCase(git, state, logger, cleaner),
    ),
```
to:
```typescript
    provideUseCase(
      ScanRepositoryUseCase,
      [ScanWorkerPort, StateRepositoryPort, LoggerPort, WorkdirCleanerPort],
      (scanWorker, state, logger, cleaner) => new ScanRepositoryUseCase(scanWorker, state, logger, cleaner),
    ),
```

Add a new provider entry (anywhere in the `providers` array, e.g. right after the `GitOperationsPort` binding):
```typescript
    { provide: ScanWorkerPort, useClass: PiscinaScanWorkerAdapter },
```

Leave `{ provide: GitOperationsPort, useClass: GitCliAdapter }` in place — nothing else in the main-thread DI graph uses it anymore (only `scan.worker.ts` does, via `new GitCliAdapter()`, outside DI entirely), but removing it isn't necessary and keeping it costs nothing.

- [ ] **Step 2: Run the full API test suite and build**

Run: `npm run test -w apps/api && npm run build -w apps/api`
Expected: PASS / SUCCESS — this exercises `RunScanLoopUseCase`'s existing tests too, which depend on `ScanRepositoryUseCase`'s public shape being unchanged.

- [ ] **Step 3: Dispatch the `hex-architecture-reviewer` agent**

Per CLAUDE.md's mandatory workflow table (any change under `apps/api/src/modules/scanner/`). Address anything it flags before moving on.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/scanner/scanner.module.ts
git commit -m "feat(scanner): wire ScanWorkerPort to PiscinaScanWorkerAdapter in DI"
```

---

### Task 8: Manual verification of Part A

Not automatable in CI, but required before moving to Part B.

- [ ] **Step 1:** Start the API (`npm run start:dev -w apps/api`) and trigger a scan of a real repo with non-trivial history (via the admin `/scan` flow or `mine/scan-repo`, whichever is easiest to reach in the running app today).
- [ ] **Step 2:** While that scan is running, hit `GET /findings` (or any other endpoint) from a second terminal/client (`curl`) and confirm it responds immediately, not after the scan finishes.
- [ ] **Step 3:** Confirm the scan's findings and final status match what the same repo produced before this change (compare against a previous run's data if available, or just sanity-check the finding count looks plausible for the repo).
- [ ] **Step 4:** No commit for this task — it's verification only.

---

# Part B: BullMQ + Redis job queue

**Prerequisite (already done, not a task here):** `docker-compose.yml` at the repo root brings up Redis (`podman compose up -d redis` or `docker compose up -d redis`); `REDIS_URL` is in `apps/api/.env` and `.env.example`. Make sure Redis is running before starting Part B's tests: `podman compose up -d redis` from the repo root.

### Task 9: `EJobStatus.QUEUED` + move `IJobState` to the domain layer

`IJobState` currently lives inside `infrastructure/jobs/in-memory-job-runner.ts`, which this part deletes (Task 15) — it needs a new home that both `JobQueuePort` (Task 10) and `JobsController` (Task 13) can depend on without reaching into infrastructure.

**Files:**
- Modify: `apps/api/src/modules/scanner/domain/constant/job-status.constant.ts`
- Create: `apps/api/src/modules/scanner/domain/types/job-state.type.ts`
- Modify: `apps/web/src/lib/constant/job-status.constant.ts`
- Modify: `apps/web/src/components/progress-panel.tsx`

**Interfaces:**
- Produces: `EJobStatus.QUEUED` (backend + frontend), `IJobState` (moved, same shape as before). Consumed by `JobQueuePort`/`BullmqJobQueueAdapter` (Task 10-11), `JobsController` (Task 13), and the frontend's `ProgressPanel`.

- [ ] **Step 1: Add `QUEUED` to the backend enum**

```typescript
// apps/api/src/modules/scanner/domain/constant/job-status.constant.ts
export enum EJobStatus {
  QUEUED = 'queued',
  RUNNING = 'running',
  DONE = 'done',
  FAILED = 'failed',
}

export enum EJobType {
  DISCOVER = 'discover',
  SCAN = 'scan',
}
```

- [ ] **Step 2: Create the domain type file (moved from `in-memory-job-runner.ts`, unchanged shape)**

```typescript
// apps/api/src/modules/scanner/domain/types/job-state.type.ts
import { EJobStatus, EJobType } from '../constant/job-status.constant';
import { IJobProgressEvent } from './job-progress-event.type';

export interface IJobState {
  readonly id: string;
  readonly type: EJobType;
  readonly status: EJobStatus;
  readonly processed: number;
  readonly message: string;
  readonly startedAt: Date;
  readonly finishedAt?: Date;
  readonly error?: string;
  readonly log: readonly IJobProgressEvent[];
}
```

- [ ] **Step 3: Add `QUEUED` to the frontend enum**

```typescript
// apps/web/src/lib/constant/job-status.constant.ts
// Mirrored from apps/api's domain/constant/job-status.constant.ts.
export enum EJobStatus {
  QUEUED = 'queued',
  RUNNING = 'running',
  DONE = 'done',
  FAILED = 'failed',
}

export enum EJobType {
  DISCOVER = 'discover',
  SCAN = 'scan',
}
```

- [ ] **Step 4: Add a `QUEUED` entry to `ProgressPanel`'s exhaustive Records**

In `apps/web/src/components/progress-panel.tsx`, change:
```typescript
const DOT_TONE: Record<EJobStatus, string> = {
  [EJobStatus.RUNNING]: 'bg-warning animate-pulse',
  [EJobStatus.DONE]: 'bg-accent',
  [EJobStatus.FAILED]: 'bg-critical',
};

const LINE_TONE: Record<EJobStatus, string> = {
  [EJobStatus.RUNNING]: 'text-text',
  [EJobStatus.DONE]: 'text-accent',
  [EJobStatus.FAILED]: 'text-critical',
};
```
to:
```typescript
const DOT_TONE: Record<EJobStatus, string> = {
  [EJobStatus.QUEUED]: 'bg-line',
  [EJobStatus.RUNNING]: 'bg-warning animate-pulse',
  [EJobStatus.DONE]: 'bg-accent',
  [EJobStatus.FAILED]: 'bg-critical',
};

const LINE_TONE: Record<EJobStatus, string> = {
  [EJobStatus.QUEUED]: 'text-text-dim',
  [EJobStatus.RUNNING]: 'text-text',
  [EJobStatus.DONE]: 'text-accent',
  [EJobStatus.FAILED]: 'text-critical',
};
```

- [ ] **Step 5: Run the frontend build to confirm the Records are exhaustive**

Run: `npm run build -w apps/web`
Expected: SUCCESS (TypeScript would error here if a `Record<EJobStatus, string>` were missing a member)

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/scanner/domain/constant/job-status.constant.ts apps/api/src/modules/scanner/domain/types/job-state.type.ts apps/web/src/lib/constant/job-status.constant.ts apps/web/src/components/progress-panel.tsx
git commit -m "feat(jobs): add QUEUED job status and move IJobState to the domain layer"
```

---

### Task 10: `JobQueuePort`

**Files:**
- Create: `apps/api/src/modules/scanner/application/ports/job-queue.port.ts`

**Interfaces:**
- Consumes: `IJobState` (Task 9).
- Produces: `JobQueuePort` abstract class: `enqueue(type: string, payload: unknown): Promise<string>`, `getJob(jobId: string): Promise<IJobState | null>`. `type` is a plain string (not narrowed to `EJobType`) because it doubles as the BullMQ job *name* used for routing in `BullmqJobWorker` (Task 12), and one of those names (`'scan-repo'`, for a user-triggered single-repo scan — see Task 14) has no corresponding `EJobType` member; `EJobType.DISCOVER`/`EJobType.SCAN` are themselves just the strings `'discover'`/`'scan'`, so existing callers (`ScanController`, `DiscoverController`, Task 13) keep passing the enum members unchanged. Implemented by `BullmqJobQueueAdapter` (Task 11); consumed by `ScanController`/`DiscoverController`/`JobsController` (Task 13) and `ScanMyRepoUseCase` (Task 14).

No dedicated test file — same reasoning as Task 3 (a port is a single abstract class, no logic to test).

- [ ] **Step 1: Write the port**

```typescript
// apps/api/src/modules/scanner/application/ports/job-queue.port.ts
import { IJobState } from '../../domain/types/job-state.type';

export abstract class JobQueuePort {
  /** Enqueues a job and returns its id immediately - the caller never waits for it to run. */
  abstract enqueue(type: string, payload: unknown): Promise<string>;

  abstract getJob(jobId: string): Promise<IJobState | null>;
}
```

- [ ] **Step 2: Verify the project still builds**

Run: `npm run build -w apps/api`
Expected: SUCCESS

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/scanner/application/ports/job-queue.port.ts
git commit -m "feat(jobs): add JobQueuePort"
```

---

### Task 11: `bullmq` dependency + `BullmqJobQueueAdapter`

**Files:**
- Modify: `apps/api/package.json` (add `bullmq`)
- Create: `apps/api/src/modules/scanner/infrastructure/jobs/bullmq-connection.ts` (shared Redis connection config, so the `Queue` and `Worker` — Task 12 — use the identical connection options)
- Create: `apps/api/src/modules/scanner/infrastructure/jobs/bullmq-job-queue.adapter.ts`
- Test: `apps/api/tests/integration/scanner/bullmq-job-queue.adapter.spec.ts`

**Interfaces:**
- Consumes: `JobQueuePort` (Task 10), `IJobState`/`EJobStatus`/`EJobType` (Task 9 + existing).
- Produces: `BullmqJobQueueAdapter implements JobQueuePort`, `SCANNER_QUEUE_NAME` constant, `redisConnection` config object. `SCANNER_QUEUE_NAME` and `redisConnection` are consumed by `BullmqJobWorker` (Task 12) too, so both point at the same queue/Redis.

- [ ] **Step 1: Install the dependency**

```bash
cd apps/api && npm install bullmq
```

- [ ] **Step 2: Make sure Redis is running for the test**

```bash
cd /home/mechanosec/PetProjects/MyMalvare/credsScrapper && podman compose up -d redis
```

Verify: `podman exec credsscrapper-redis-1 redis-cli ping` prints `PONG`.

- [ ] **Step 3: Write the shared connection config**

```typescript
// apps/api/src/modules/scanner/infrastructure/jobs/bullmq-connection.ts
export const SCANNER_QUEUE_NAME = 'scanner-jobs';

// BullMQ/ioredis parse a redis:// URL themselves when given as the
// `connection` option directly (no need to hand-construct an ioredis
// instance here).
export const redisConnection = { url: process.env.REDIS_URL ?? 'redis://localhost:6379' };
```

- [ ] **Step 4: Write the failing integration test**

```typescript
// apps/api/tests/integration/scanner/bullmq-job-queue.adapter.spec.ts
import { Queue } from 'bullmq';
import { BullmqJobQueueAdapter } from '../../../src/modules/scanner/infrastructure/jobs/bullmq-job-queue.adapter';
import { redisConnection, SCANNER_QUEUE_NAME } from '../../../src/modules/scanner/infrastructure/jobs/bullmq-connection';
import { EJobStatus, EJobType } from '../../../src/modules/scanner/domain/constant/job-status.constant';

describe('BullmqJobQueueAdapter (real Redis)', () => {
  let adapter: BullmqJobQueueAdapter;
  let queue: Queue;

  beforeAll(() => {
    adapter = new BullmqJobQueueAdapter();
    queue = new Queue(SCANNER_QUEUE_NAME, { connection: redisConnection });
  });

  afterAll(async () => {
    await adapter.close();
    await queue.close();
  });

  it('enqueues a job and getJob reports it queued (nothing consumes it in this test)', async () => {
    const jobId = await adapter.enqueue(EJobType.DISCOVER, { date: new Date().toISOString() });

    const job = await adapter.getJob(jobId);

    expect(job).not.toBeNull();
    expect(job?.status).toBe(EJobStatus.QUEUED);
    expect(job?.type).toBe(EJobType.DISCOVER);
    expect(job?.log).toEqual([]);
  });

  it('returns null for an id that was never enqueued', async () => {
    const job = await adapter.getJob('not-a-real-job-id');
    expect(job).toBeNull();
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `npm run test:integration -w apps/api -- bullmq-job-queue.adapter.spec.ts`
Expected: FAIL with "Cannot find module '.../bullmq-job-queue.adapter'"

- [ ] **Step 6: Write minimal implementation**

```typescript
// apps/api/src/modules/scanner/infrastructure/jobs/bullmq-job-queue.adapter.ts
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import { JobQueuePort } from '../../application/ports/job-queue.port';
import { EJobStatus, EJobType } from '../../domain/constant/job-status.constant';
import { IJobState } from '../../domain/types/job-state.type';
import { IJobProgressEvent } from '../../domain/types/job-progress-event.type';
import { redisConnection, SCANNER_QUEUE_NAME } from './bullmq-connection';

// BullMQ job names double as the type tag this app already used
// (EJobType) for 'discover' and the admin bulk 'scan' loop; a
// user-triggered single-repo scan (ScanMyRepoUseCase, see
// bullmq-job-worker.ts) uses the job name 'scan-repo' for routing but is
// still reported as EJobType.SCAN here, since nothing downstream
// distinguishes the two once a job is running.
function jobNameToType(name: string): EJobType {
  return name === 'discover' ? EJobType.DISCOVER : EJobType.SCAN;
}

interface IJobProgressData {
  readonly message: string;
  readonly processed?: number;
  readonly log: IJobProgressEvent[];
}

function isJobProgressData(value: unknown): value is IJobProgressData {
  return typeof value === 'object' && value !== null && Array.isArray((value as IJobProgressData).log);
}

@Injectable()
export class BullmqJobQueueAdapter extends JobQueuePort implements OnModuleDestroy {
  private readonly queue = new Queue(SCANNER_QUEUE_NAME, { connection: redisConnection });

  async enqueue(type: string, payload: unknown): Promise<string> {
    const job = await this.queue.add(type, payload);
    if (!job.id) {
      throw new Error('BullMQ did not assign a job id');
    }
    return job.id;
  }

  async getJob(jobId: string): Promise<IJobState | null> {
    const job = await this.queue.getJob(jobId);
    if (!job) {
      return null;
    }
    const state = await job.getState();
    const progress = isJobProgressData(job.progress) ? job.progress : { message: `${job.name} queued`, log: [] };

    return {
      id: jobId,
      type: jobNameToType(job.name),
      status: this.mapStatus(state),
      processed: progress.processed ?? 0,
      message: progress.message,
      startedAt: new Date(job.timestamp),
      finishedAt: job.finishedOn ? new Date(job.finishedOn) : undefined,
      error: job.failedReason,
      log: progress.log,
    };
  }

  private mapStatus(bullState: string): EJobStatus {
    switch (bullState) {
      case 'completed':
        return EJobStatus.DONE;
      case 'failed':
        return EJobStatus.FAILED;
      case 'active':
        return EJobStatus.RUNNING;
      default:
        // 'waiting', 'delayed', 'waiting-children', 'prioritized', etc.
        return EJobStatus.QUEUED;
    }
  }

  async close(): Promise<void> {
    await this.queue.close();
  }

  async onModuleDestroy(): Promise<void> {
    await this.close();
  }
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npm run test:integration -w apps/api -- bullmq-job-queue.adapter.spec.ts`
Expected: PASS (2 tests)

- [ ] **Step 8: Commit**

```bash
git add apps/api/package.json apps/api/package-lock.json apps/api/src/modules/scanner/infrastructure/jobs/bullmq-connection.ts apps/api/src/modules/scanner/infrastructure/jobs/bullmq-job-queue.adapter.ts apps/api/tests/integration/scanner/bullmq-job-queue.adapter.spec.ts
git commit -m "feat(jobs): add BullmqJobQueueAdapter backed by Redis"
```

---

### Task 12: `BullmqJobWorker`

This is the consumer side: a BullMQ `Worker` that pulls jobs off `scanner-jobs` and calls the existing use-cases.

**Files:**
- Create: `apps/api/src/modules/scanner/infrastructure/jobs/bullmq-job-worker.ts`
- Test: `apps/api/tests/integration/scanner/bullmq-job-worker.spec.ts`

**Interfaces:**
- Consumes: `SCANNER_QUEUE_NAME`/`redisConnection` (Task 11), `SCAN_WORKER_POOL_SIZE` (Task 1, reused as the BullMQ `concurrency` value), `DiscoverReposUseCase`/`RunScanLoopUseCase`/`ScanRepositoryUseCase` (existing, unchanged constructors), `ProgressPort` (existing — the WebSocket gateway that made real-time job updates work before this change; must still be called so `ProgressPanel`'s socket.io subscription keeps working, not just its polling fallback), `IRepoRef` (existing).
- Produces: `BullmqJobWorker`, constructed with those three use-cases plus `ProgressPort`. Its job-name contract (what payload shape each name expects) is used by `ScanController`/`DiscoverController` (Task 13, job name `'discover'`/`'scan'`) and `ScanMyRepoUseCase` (Task 14, job name `'scan-repo'`).

Job payload shapes this task defines and the worker must handle:
- `'discover'`: `{ date?: string }` (ISO date string, optional)
- `'scan'` (admin bulk loop): `{ workdirRoot: string; workers?: number; maxRepos?: number; staleTimeoutSeconds?: number }`
- `'scan-repo'` (one specific repo, bypassing the candidate queue): `{ repoRef: IRepoRef; cloneSource: string; workdir: string }`

- [ ] **Step 1: Write the failing integration test**

```typescript
// apps/api/tests/integration/scanner/bullmq-job-worker.spec.ts
import { Queue } from 'bullmq';
import { BullmqJobWorker } from '../../../src/modules/scanner/infrastructure/jobs/bullmq-job-worker';
import { redisConnection, SCANNER_QUEUE_NAME } from '../../../src/modules/scanner/infrastructure/jobs/bullmq-connection';
import { BullmqJobQueueAdapter } from '../../../src/modules/scanner/infrastructure/jobs/bullmq-job-queue.adapter';
import { EJobStatus } from '../../../src/modules/scanner/domain/constant/job-status.constant';

class RecordingScanRepository {
  calls: unknown[] = [];
  execute = async (
    repoRef: unknown,
    cloneSource: string,
    workdir: string,
    onProgress?: (message: string) => void,
  ): Promise<void> => {
    this.calls.push({ repoRef, cloneSource, workdir });
    onProgress?.('scan: test/repo - cloning');
    onProgress?.('scan: test/repo - done, 0 findings total');
  };
}

class RecordingDiscoverRepos {
  calls: unknown[] = [];
  execute = async (date?: Date, onProgress?: (message: string) => void): Promise<number> => {
    this.calls.push(date);
    onProgress?.('discovery: finished, 0 push events processed, 0 new candidates added');
    return 0;
  };
}

class RecordingRunScanLoop {
  calls: unknown[] = [];
  execute = async (options: { workdirRoot: string }): Promise<number> => {
    this.calls.push(options);
    return 0;
  };
}

class RecordingProgress {
  events: unknown[] = [];
  emit = (event: unknown): void => {
    this.events.push(event);
  };
}

describe('BullmqJobWorker (real Redis + real BullMQ Worker)', () => {
  let queue: Queue;
  let queueAdapter: BullmqJobQueueAdapter;
  let worker: BullmqJobWorker;
  let discover: RecordingDiscoverRepos;
  let runScanLoop: RecordingRunScanLoop;
  let scanRepository: RecordingScanRepository;
  let progress: RecordingProgress;

  beforeAll(async () => {
    queue = new Queue(SCANNER_QUEUE_NAME, { connection: redisConnection });
    queueAdapter = new BullmqJobQueueAdapter();
    discover = new RecordingDiscoverRepos();
    runScanLoop = new RecordingRunScanLoop();
    scanRepository = new RecordingScanRepository();
    progress = new RecordingProgress();
    worker = new BullmqJobWorker(discover as never, runScanLoop as never, scanRepository as never, progress as never);
    await worker.start();
  });

  afterAll(async () => {
    await worker.close();
    await queueAdapter.close();
    await queue.close();
  });

  async function waitForStatus(jobId: string, status: EJobStatus, timeoutMs = 5000): Promise<void> {
    const start = Date.now();
    for (;;) {
      const job = await queueAdapter.getJob(jobId);
      if (job?.status === status) return;
      if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for job ${jobId} to reach ${status}`);
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  it('processes a scan-repo job by calling ScanRepositoryUseCase.execute directly', async () => {
    const job = await queue.add('scan-repo', {
      repoRef: { repoId: 1, owner: 'test', name: 'repo' },
      cloneSource: 'https://example.com/repo.git',
      workdir: 'workdir/repo-1',
    });

    await waitForStatus(job.id!, EJobStatus.DONE);

    expect(scanRepository.calls).toEqual([
      { repoRef: { repoId: 1, owner: 'test', name: 'repo' }, cloneSource: 'https://example.com/repo.git', workdir: 'workdir/repo-1' },
    ]);
    const finalState = await queueAdapter.getJob(job.id!);
    expect(finalState?.log.map((e) => e.message)).toContain('scan: test/repo - cloning');
    expect(progress.events.some((e: any) => e.message === 'scan: test/repo - cloning')).toBe(true);
  });

  it('processes a discover job by calling DiscoverReposUseCase.execute', async () => {
    const job = await queue.add('discover', {});

    await waitForStatus(job.id!, EJobStatus.DONE);

    expect(discover.calls).toHaveLength(1);
  });

  it('processes a scan job by calling RunScanLoopUseCase.execute', async () => {
    const job = await queue.add('scan', { workdirRoot: 'workdir' });

    await waitForStatus(job.id!, EJobStatus.DONE);

    expect(runScanLoop.calls).toEqual([{ workdirRoot: 'workdir' }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:integration -w apps/api -- bullmq-job-worker.spec.ts`
Expected: FAIL with "Cannot find module '.../bullmq-job-worker'"

- [ ] **Step 3: Write minimal implementation**

```typescript
// apps/api/src/modules/scanner/infrastructure/jobs/bullmq-job-worker.ts
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Job, Worker } from 'bullmq';
import { DiscoverReposUseCase } from '../../application/use-cases/discover-repos.use-case';
import { RunScanLoopUseCase } from '../../application/use-cases/run-scan-loop.use-case';
import { ScanRepositoryUseCase } from '../../application/use-cases/scan-repository.use-case';
import { ProgressPort } from '../../application/ports/progress.port';
import { IRepoRef } from '../../domain/types/repo-ref.type';
import { IJobProgressEvent } from '../../domain/types/job-progress-event.type';
import { EJobStatus } from '../../domain/constant/job-status.constant';
import { redisConnection, SCANNER_QUEUE_NAME } from './bullmq-connection';
import { SCAN_WORKER_POOL_SIZE } from '../workers/pool-size';

function buildCloneUrl(ref: IRepoRef): string {
  return `https://github.com/${ref.owner}/${ref.name}.git`;
}

interface IScanRepoJobData {
  readonly repoRef: IRepoRef;
  readonly cloneSource: string;
  readonly workdir: string;
}

interface IScanLoopJobData {
  readonly workdirRoot: string;
  readonly workers?: number;
  readonly maxRepos?: number;
  readonly staleTimeoutSeconds?: number;
}

interface IDiscoverJobData {
  readonly date?: string;
}

@Injectable()
export class BullmqJobWorker implements OnModuleInit, OnModuleDestroy {
  private worker?: Worker;

  constructor(
    private readonly discoverRepos: DiscoverReposUseCase,
    private readonly runScanLoop: RunScanLoopUseCase,
    private readonly scanRepository: ScanRepositoryUseCase,
    private readonly progress: ProgressPort,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.start();
  }

  async start(): Promise<void> {
    this.worker = new Worker(
      SCANNER_QUEUE_NAME,
      (job) => this.process(job),
      { connection: redisConnection, concurrency: SCAN_WORKER_POOL_SIZE },
    );
  }

  private async process(job: Job): Promise<void> {
    const log: IJobProgressEvent[] = [];
    let processed = 0;
    // Synchronous and fire-and-forget, matching the onProgress contract
    // DiscoverReposUseCase/RunScanLoopUseCase/ScanRepositoryUseCase
    // already take (unchanged by this plan) - job.updateProgress()'s
    // promise isn't awaited here (same as InMemoryJobRunner's equivalent
    // callback wasn't awaited either), but progress.emit() is
    // synchronous, so the WebSocket update still goes out immediately.
    const onProgress = (message: string, newProcessed?: number): void => {
      if (newProcessed !== undefined) {
        processed = newProcessed;
      }
      const event: IJobProgressEvent = { jobId: job.id!, status: EJobStatus.RUNNING, message, processed };
      log.push(event);
      void job.updateProgress({ message, processed, log });
      this.progress.emit(event);
    };

    if (job.name === 'discover') {
      const data = job.data as IDiscoverJobData;
      const date = data.date ? new Date(data.date) : undefined;
      processed = await this.discoverRepos.execute(date, onProgress);
      return;
    }

    if (job.name === 'scan') {
      const data = job.data as IScanLoopJobData;
      processed = await this.runScanLoop.execute({
        workdirRoot: data.workdirRoot,
        sourceUrlFn: buildCloneUrl,
        workers: data.workers,
        maxRepos: data.maxRepos,
        staleTimeoutSeconds: data.staleTimeoutSeconds,
        onProgress,
      });
      return;
    }

    if (job.name === 'scan-repo') {
      const data = job.data as IScanRepoJobData;
      await this.scanRepository.execute(data.repoRef, data.cloneSource, data.workdir, (message) =>
        onProgress(message),
      );
      return;
    }

    throw new Error(`Unknown job name: ${job.name}`);
  }

  async close(): Promise<void> {
    await this.worker?.close();
  }

  async onModuleDestroy(): Promise<void> {
    await this.close();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:integration -w apps/api -- bullmq-job-worker.spec.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/scanner/infrastructure/jobs/bullmq-job-worker.ts apps/api/tests/integration/scanner/bullmq-job-worker.spec.ts
git commit -m "feat(jobs): add BullmqJobWorker consuming scanner-jobs"
```

---

### Task 13: Wire `scanner.module.ts`, controllers, and `main.ts`

**Files:**
- Modify: `apps/api/src/modules/scanner/scanner.module.ts`
- Modify: `apps/api/src/modules/scanner/presentation/scan.controller.ts`
- Modify: `apps/api/src/modules/scanner/presentation/discover.controller.ts`
- Modify: `apps/api/src/modules/scanner/presentation/jobs.controller.ts`
- Modify: `apps/api/src/main.ts`
- Delete: `apps/api/src/modules/scanner/infrastructure/jobs/in-memory-job-runner.ts`
- Delete: `apps/api/tests/unit/scanner/infrastructure/jobs/in-memory-job-runner.spec.ts` (if it exists — check with `find apps/api/tests -iname "*in-memory-job-runner*"` first)

**Interfaces:**
- Consumes: `JobQueuePort` (Task 10), `BullmqJobQueueAdapter` (Task 11), `BullmqJobWorker` (Task 12).
- Produces: nothing new for other tasks — this is the final DI/controller wiring for the shared admin `discover`/`scan` job types. `ScanMyRepoUseCase` (Task 14) is wired separately since it lives in the `auth` module.

- [ ] **Step 1: Check for an existing `InMemoryJobRunner` spec file**

```bash
find apps/api/tests -iname "*in-memory-job-runner*"
```
Delete it if found (its coverage moves to Task 11/12's integration tests, which test the real replacement).

- [ ] **Step 2: Update `scanner.module.ts`**

Remove:
```typescript
import { InMemoryJobRunner } from './infrastructure/jobs/in-memory-job-runner';
```
and the `InMemoryJobRunner` line from `providers`.

Add:
```typescript
import { JobQueuePort } from './application/ports/job-queue.port';
import { BullmqJobQueueAdapter } from './infrastructure/jobs/bullmq-job-queue.adapter';
import { BullmqJobWorker } from './infrastructure/jobs/bullmq-job-worker';
```
and, in `providers`:
```typescript
    { provide: JobQueuePort, useClass: BullmqJobQueueAdapter },
    BullmqJobWorker,
```

Add `JobQueuePort` to the module's `exports` array (the `auth` module needs it for `ScanMyRepoUseCase` in Task 14, the same way it already imports `ScannerModule` to reuse `StateRepositoryPort`/`KeyValidatorPort`):
```typescript
  exports: [
    StateRepositoryPort,
    PrismaService,
    KeyValidatorPort,
    GithubRepoLookupPort,
    ScanRepositoryUseCase,
    WorkdirJoinerPort,
    JobQueuePort,
  ],
```

- [ ] **Step 3: Update `scan.controller.ts`**

Replace:
```typescript
import { InMemoryJobRunner } from '../infrastructure/jobs/in-memory-job-runner';
```
with:
```typescript
import { JobQueuePort } from '../application/ports/job-queue.port';
```

Replace the constructor parameter `private readonly jobRunner: InMemoryJobRunner,` with `private readonly jobQueue: JobQueuePort,`.

Replace the `start()` method body:
```typescript
  @Post()
  @UseGuards(AdminGuard)
  start(@Body() dto: StartScanDto): { jobId: string } {
    const jobId = this.jobRunner.start(EJobType.SCAN, (onProgress) =>
      this.runScanLoop.execute({
        workdirRoot: SCAN_WORKDIR,
        sourceUrlFn: buildCloneUrl,
        workers: dto.workers ?? 1,
        maxRepos: dto.maxRepos,
        staleTimeoutSeconds: dto.staleTimeoutSeconds ?? 3600,
        onProgress,
      }),
    );
    return { jobId };
  }
```
with:
```typescript
  @Post()
  @UseGuards(AdminGuard)
  async start(@Body() dto: StartScanDto): Promise<{ jobId: string }> {
    const jobId = await this.jobQueue.enqueue(EJobType.SCAN, {
      workdirRoot: SCAN_WORKDIR,
      workers: dto.workers ?? 1,
      maxRepos: dto.maxRepos,
      staleTimeoutSeconds: dto.staleTimeoutSeconds ?? 3600,
    });
    return { jobId };
  }
```

`buildCloneUrl` and the `RunScanLoopUseCase` import/constructor param are no longer used by this controller (the worker builds the clone URL itself now, per Task 12) — remove the now-unused `runScanLoop` constructor parameter and the `buildCloneUrl` function from this file, but keep `GetScanStatusUseCase`/`GetScannedReposUseCase` untouched (still used by `status()`/`repos()`).

- [ ] **Step 4: Update `discover.controller.ts`**

Replace:
```typescript
import { InMemoryJobRunner } from '../infrastructure/jobs/in-memory-job-runner';
```
with:
```typescript
import { JobQueuePort } from '../application/ports/job-queue.port';
```

Remove the now-unused `import { DiscoverReposUseCase } from '../application/use-cases/discover-repos.use-case';` line (nothing in this controller calls it directly anymore — `BullmqJobWorker`, Task 12, does). `import { EJobType } from '../domain/constant/job-status.constant';` already exists in this file and stays.

Replace the constructor parameter and the `start()` body:
```typescript
  constructor(private readonly jobQueue: JobQueuePort) {}

  @Post()
  async start(): Promise<{ jobId: string }> {
    const jobId = await this.jobQueue.enqueue(EJobType.DISCOVER, {});
    return { jobId };
  }
```

- [ ] **Step 5: Update `jobs.controller.ts`**

```typescript
// apps/api/src/modules/scanner/presentation/jobs.controller.ts
import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { JobQueuePort } from '../application/ports/job-queue.port';
import { IJobState } from '../domain/types/job-state.type';

@Controller('jobs')
export class JobsController {
  constructor(private readonly jobQueue: JobQueuePort) {}

  @Get(':id')
  async get(@Param('id') id: string): Promise<IJobState> {
    const job = await this.jobQueue.getJob(id);
    if (!job) {
      throw new NotFoundException(`job ${id} not found`);
    }
    return job;
  }
}
```

- [ ] **Step 6: Delete `in-memory-job-runner.ts`**

```bash
rm apps/api/src/modules/scanner/infrastructure/jobs/in-memory-job-runner.ts
```

- [ ] **Step 7: Add `app.enableShutdownHooks()` to `main.ts`**

```typescript
// apps/api/src/main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 3000);
}

bootstrap();
```

- [ ] **Step 8: Run the full API test suite and build**

Run: `npm run test -w apps/api && npm run build -w apps/api`
Expected: PASS / SUCCESS. Redis must be running (`podman compose up -d redis`) for the BullMQ integration tests from Tasks 11-12 to still pass.

- [ ] **Step 9: Commit**

```bash
git add -A apps/api/src apps/api/tests
git commit -m "feat(jobs): route admin discover/scan through BullMQ, remove InMemoryJobRunner"
```

---

### Task 14: `ScanMyRepoUseCase` enqueues instead of awaiting inline

This is the fix for the exact bug report: `mine/scan-repo` no longer blocks the HTTP response for the whole scan.

**Files:**
- Modify: `apps/api/src/modules/auth/application/use-cases/scan-my-repo.use-case.ts`
- Modify (rewrite): `apps/api/tests/unit/auth/application/use-cases/scan-my-repo.use-case.spec.ts`
- Modify: `apps/api/src/modules/auth/presentation/repo-authorizations.controller.ts`

**Interfaces:**
- Consumes: `JobQueuePort` (Task 10, exported from `ScannerModule` per Task 13 step 2).
- Produces: `ScanMyRepoUseCase.execute()` return type changes from `{ repoId: number } | 'not-found' | null` to `{ repoId: number; jobId: string } | 'not-found' | null`.

- [ ] **Step 1: Check the existing test file exists and read it for the exact fake shapes already in use**

```bash
cat apps/api/tests/unit/auth/application/use-cases/scan-my-repo.use-case.spec.ts
```

Adapt whatever fakes it already defines for `RepoAuthorizationRepositoryPort`/`StateRepositoryPort`/`GithubRepoLookupPort`/`WorkdirJoinerPort` — reuse them, only change how the "scanning" dependency is faked and asserted (from a `ScanRepositoryUseCase`-shaped fake with an `execute` spy, to a `JobQueuePort`-shaped fake with an `enqueue` spy).

- [ ] **Step 2: Write the failing test (adjust to match the file's existing fakes, following this shape)**

```typescript
// Illustrative - merge with whatever fakes the existing file already defines for the other 4 dependencies.
import { JobQueuePort } from '../../../../../src/modules/scanner/application/ports/job-queue.port';

class FakeJobQueue extends JobQueuePort {
  enqueued: Array<{ type: string; payload: unknown }> = [];
  async enqueue(type: string, payload: unknown): Promise<string> {
    this.enqueued.push({ type, payload });
    return 'fake-job-id';
  }
  async getJob(): Promise<null> {
    return null;
  }
}

// ... in the "scans exactly the given owner/name" test:
it('enqueues a scan-repo job and returns its jobId immediately, without awaiting the scan', async () => {
  const jobQueue = new FakeJobQueue();
  const useCase = new ScanMyRepoUseCase(authorizations, state, githubLookup, jobQueue, workdirJoiner);

  const result = await useCase.execute(1, 'octocat', 'hello-world');

  expect(result).toEqual({ repoId: expect.any(Number), jobId: 'fake-job-id' });
  expect(jobQueue.enqueued).toHaveLength(1);
  expect(jobQueue.enqueued[0].type).toBe('scan-repo');
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test -w apps/api -- scan-my-repo.use-case.spec.ts`
Expected: FAIL (constructor signature mismatch / return shape mismatch)

- [ ] **Step 4: Rewrite the implementation**

```typescript
// apps/api/src/modules/auth/application/use-cases/scan-my-repo.use-case.ts
import { RepoAuthorizationRepositoryPort } from '../ports/repo-authorization-repository.port';
import { ERepoAuthorizationStatus } from '../../domain/constant/repo-authorization-status.constant';
import { StateRepositoryPort } from '../../../scanner/application/ports/state-repository.port';
import { GithubRepoLookupPort } from '../../../scanner/application/ports/github-repo-lookup.port';
import { JobQueuePort } from '../../../scanner/application/ports/job-queue.port';
import { WorkdirJoinerPort } from '../../../scanner/application/ports/workdir-joiner.port';

const SCAN_WORKDIR = process.env.SCAN_WORKDIR ?? 'workdir';

export class ScanMyRepoUseCase {
  constructor(
    private readonly authorizations: RepoAuthorizationRepositoryPort,
    private readonly state: StateRepositoryPort,
    private readonly githubLookup: GithubRepoLookupPort,
    private readonly jobQueue: JobQueuePort,
    private readonly workdirJoiner: WorkdirJoinerPort,
  ) {}

  /**
   * Scans exactly the given owner/name, bypassing the shared discovery
   * queue entirely. Enqueues a 'scan-repo' BullMQ job and returns
   * immediately with its jobId - the caller watches progress via
   * GET /jobs/:id or the WebSocket gateway, same as the admin scan flow.
   *
   * Returns null if not approved, 'not-found' if GitHub has no such
   * public repo, or { repoId, jobId } once the job is enqueued.
   */
  async execute(
    userId: number,
    owner: string,
    name: string,
  ): Promise<{ repoId: number; jobId: string } | 'not-found' | null> {
    const approved = await this.authorizations.listByUser(userId);
    const isApproved = approved.some(
      (a) =>
        a.status === ERepoAuthorizationStatus.APPROVED &&
        a.owner.toLowerCase() === owner.toLowerCase() &&
        a.name.toLowerCase() === name.toLowerCase(),
    );
    if (!isApproved) {
      return null;
    }

    const repoId = await this.githubLookup.resolveRepoId(owner, name);
    if (repoId === null) {
      return 'not-found';
    }

    await this.state.startRepoScan(repoId, owner, name);
    await this.workdirJoiner.ensureDir(SCAN_WORKDIR);
    const workdir = this.workdirJoiner.join(SCAN_WORKDIR, `repo-${repoId}`);
    const jobId = await this.jobQueue.enqueue('scan-repo', {
      repoRef: { repoId, owner, name },
      cloneSource: `https://github.com/${owner}/${name}.git`,
      workdir,
    });

    return { repoId, jobId };
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test -w apps/api -- scan-my-repo.use-case.spec.ts`
Expected: PASS

- [ ] **Step 6: Update `repo-authorizations.controller.ts`**

Find the `scanRepo` handler:
```typescript
  @Post('mine/scan-repo')
  @UseGuards(AuthGuard)
  async scanRepo(@Req() req: TAuthedRequest, @Body('owner') owner: string, @Body('name') name: string) {
    const result = await this.scanMyRepo.execute(req.user.id, owner, name);
    if (result === null) {
      throw new ForbiddenException('You do not have an approved authorization for this repository');
    }
    if (result === 'not-found') {
      throw new NotFoundException(`GitHub repo ${owner}/${name} not found`);
    }
    return result;
  }
```
No change needed to this method's body — `result` is now `{ repoId, jobId }` instead of `{ repoId }`, and it's already returned as-is via `return result;`. Confirm this by reading the current file; if it matches this shape exactly, this step is a no-op verification, not an edit.

- [ ] **Step 7: Update `auth.module.ts`'s DI wiring for `ScanMyRepoUseCase`**

Find:
```typescript
    provideUseCase(
      ScanMyRepoUseCase,
      [RepoAuthorizationRepositoryPort, StateRepositoryPort, GithubRepoLookupPort, ScanRepositoryUseCase, WorkdirJoinerPort],
      (authorizations, state, githubLookup, scanRepository, workdirJoiner) =>
        new ScanMyRepoUseCase(authorizations, state, githubLookup, scanRepository, workdirJoiner),
    ),
```
Replace with:
```typescript
    provideUseCase(
      ScanMyRepoUseCase,
      [RepoAuthorizationRepositoryPort, StateRepositoryPort, GithubRepoLookupPort, JobQueuePort, WorkdirJoinerPort],
      (authorizations, state, githubLookup, jobQueue, workdirJoiner) =>
        new ScanMyRepoUseCase(authorizations, state, githubLookup, jobQueue, workdirJoiner),
    ),
```
Add the import: `import { JobQueuePort } from '../scanner/application/ports/job-queue.port';`. Remove the `ScanRepositoryUseCase` import/usage from `auth.module.ts` if nothing else in that file references it (check with `grep -n ScanRepositoryUseCase apps/api/src/modules/auth/auth.module.ts` — if only this one usage existed, remove the import too).

- [ ] **Step 8: Run the full API test suite and build**

Run: `npm run test -w apps/api && npm run build -w apps/api`
Expected: PASS / SUCCESS

- [ ] **Step 9: Commit**

```bash
git add -A apps/api/src apps/api/tests
git commit -m "feat(scan): mine/scan-repo enqueues a job instead of blocking the request"
```

---

### Task 15: Frontend — `MyReposPanel` watches job progress

**Files:**
- Modify: `apps/web/src/lib/api-client.ts`
- Modify: `apps/web/src/components/my-repos-panel.tsx`
- Test: `apps/web/src/components/my-repos-panel.test.tsx` (new, if no test file exists for this component yet — check first)

**Interfaces:**
- Consumes: `ProgressPanel` (existing, unchanged — reused as-is), `scanMyRepo` (modified return type).

- [ ] **Step 1: Check for an existing test file**

```bash
find apps/web/src/components -iname "my-repos-panel*"
```

- [ ] **Step 2: Update `scanMyRepo`'s return type in `api-client.ts`**

Find:
```typescript
export function scanMyRepo(owner: string, name: string): Promise<{ repoId: number }> {
  return post<{ repoId: number }>('/repo-authorizations/mine/scan-repo', { owner, name });
}
```
Replace with:
```typescript
export function scanMyRepo(owner: string, name: string): Promise<{ repoId: number; jobId: string }> {
  return post<{ repoId: number; jobId: string }>('/repo-authorizations/mine/scan-repo', { owner, name });
}
```

- [ ] **Step 3: Write a failing test for the new watch-job behavior**

```typescript
// apps/web/src/components/my-repos-panel.test.tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as apiClient from '../lib/api-client';
import { MyReposPanel } from './my-repos-panel';

describe('MyReposPanel', () => {
  beforeEach(() => {
    vi.spyOn(apiClient, 'fetchMyRepoAuthorizations').mockResolvedValue([
      { id: 1, owner: 'acme', name: 'widgets', note: null, status: 'approved', adminNote: null },
    ]);
  });

  it('shows a ProgressPanel for the jobId once a scan is triggered, instead of a static "complete" message', async () => {
    vi.spyOn(apiClient, 'scanMyRepo').mockResolvedValue({ repoId: 42, jobId: 'job-123' });
    vi.spyOn(apiClient, 'fetchJob').mockResolvedValue({
      id: 'job-123',
      status: 'queued' as never,
      processed: 0,
      message: 'scan-repo queued',
      log: [],
    });

    render(<MyReposPanel />);

    const scanButton = await screen.findByRole('button', { name: 'Scan' });
    fireEvent.click(scanButton);

    await waitFor(() => expect(apiClient.scanMyRepo).toHaveBeenCalledWith('acme', 'widgets'));
    // ProgressPanel renders "No job running." only when jobId is null;
    // once scanMyRepo resolves, MyReposPanel must pass the real jobId in.
    await waitFor(() => expect(screen.queryByText('No job running.')).not.toBeInTheDocument());
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm run test -w apps/web -- my-repos-panel.test.tsx`
Expected: FAIL (the component doesn't render `ProgressPanel` yet, so "No job running." never appears at all, or the button behavior doesn't match — either way, red)

- [ ] **Step 5: Update `my-repos-panel.tsx`**

Replace the `scan`/`scanMessage` state and the per-row rendering with `jobId`-based state and a `ProgressPanel`:

```typescript
'use client';

import { useEffect, useState } from 'react';
import { fetchMyRepoAuthorizations, scanMyRepo, submitRepoAuthorization } from '../lib/api-client';
import { IRepoAuthorization } from '../lib/types/repo-authorization.type';
import { ProgressPanel } from './progress-panel';

const TONE_BY_STATUS: Record<IRepoAuthorization['status'], string> = {
  pending: 'text-warning border-warning/50 bg-warning/10',
  approved: 'text-accent border-accent-dim bg-accent/10',
  rejected: 'text-critical border-critical/50 bg-critical/10',
};

export function MyReposPanel() {
  const [requests, setRequests] = useState<IRepoAuthorization[]>([]);
  const [owner, setOwner] = useState('');
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [scanningRequestId, setScanningRequestId] = useState<number | null>(null);
  const [scanJobId, setScanJobId] = useState<string | null>(null);
  const [scanError, setScanError] = useState<{ id: number; text: string } | null>(null);

  function refresh() {
    fetchMyRepoAuthorizations().then(setRequests).catch(() => setRequests([]));
  }

  async function scan(request: IRepoAuthorization) {
    setScanningRequestId(request.id);
    setScanJobId(null);
    setScanError(null);
    try {
      const { jobId } = await scanMyRepo(request.owner, request.name);
      setScanJobId(jobId);
    } catch {
      setScanError({ id: request.id, text: 'Failed to start scan — see server logs for details.' });
      setScanningRequestId(null);
    }
  }

  useEffect(refresh, []);

  function splitOwnerName(rawOwner: string, rawName: string): { owner: string; name: string } {
    const slashIn = rawName.includes('/') ? rawName : rawOwner.includes('/') ? rawOwner : null;
    if (!slashIn) return { owner: rawOwner, name: rawName };
    const [splitOwner, ...rest] = slashIn.split('/');
    return { owner: splitOwner, name: rest.join('/') };
  }

  async function submit() {
    const normalized = splitOwnerName(owner.trim(), name.trim());
    if (!normalized.owner || !normalized.name) return;
    await submitRepoAuthorization(normalized.owner, normalized.name, note || undefined);
    setOwner('');
    setName('');
    setNote('');
    refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor="repo-owner" className="mb-1 block text-xs text-text-dim">
            Owner
          </label>
          <input
            id="repo-owner"
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
            className="w-48 border border-line bg-surface-2 px-2 py-1.5 text-sm text-text outline-none focus:border-accent"
          />
        </div>
        <div>
          <label htmlFor="repo-name" className="mb-1 block text-xs text-text-dim">
            Repository name
          </label>
          <input
            id="repo-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="name or owner/name"
            className="w-48 border border-line bg-surface-2 px-2 py-1.5 text-sm text-text outline-none placeholder:text-text-dim focus:border-accent"
          />
        </div>
        <div>
          <label htmlFor="repo-note" className="mb-1 block text-xs text-text-dim">
            Note (optional)
          </label>
          <input
            id="repo-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="w-64 border border-line bg-surface-2 px-2 py-1.5 text-sm text-text outline-none focus:border-accent"
          />
        </div>
        <button
          type="button"
          onClick={submit}
          className="border border-line bg-surface-2 px-3 py-1.5 text-sm text-text hover:border-accent"
        >
          Submit request
        </button>
      </div>

      <div className="overflow-x-auto border border-line">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-line bg-surface-2 text-left text-xs text-text-dim">
              <th className="px-3 py-2 font-medium">Owner</th>
              <th className="px-3 py-2 font-medium">Repository</th>
              <th className="px-3 py-2 font-medium">Note</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Admin note</th>
              <th className="px-3 py-2 font-medium">Scan</th>
            </tr>
          </thead>
          <tbody>
            {requests.map((r) => (
              <tr key={r.id} className="border-b border-line bg-surface last:border-0">
                <td className="px-3 py-2 font-mono text-text">{r.owner}</td>
                <td className="px-3 py-2 font-mono text-text">{r.name}</td>
                <td className="px-3 py-2 text-text-dim">{r.note ?? '—'}</td>
                <td className="px-3 py-2">
                  <span className={`inline-flex items-center rounded-sm border px-2 py-0.5 text-xs font-medium ${TONE_BY_STATUS[r.status]}`}>
                    {r.status}
                  </span>
                </td>
                <td className="px-3 py-2 text-text-dim">{r.adminNote ?? '—'}</td>
                <td className="px-3 py-2">
                  {r.status === 'approved' ? (
                    <button
                      type="button"
                      onClick={() => scan(r)}
                      disabled={scanningRequestId === r.id && scanJobId === null}
                      className="shrink-0 whitespace-nowrap border border-accent-dim bg-accent/10 px-3 py-1 text-xs font-medium text-accent hover:bg-accent/20 disabled:opacity-40"
                    >
                      {scanningRequestId === r.id && scanJobId === null ? 'Starting…' : 'Scan'}
                    </button>
                  ) : (
                    <span className="text-xs text-text-dim">—</span>
                  )}
                  {scanError?.id === r.id && <p className="mt-1 text-xs text-critical">{scanError.text}</p>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {scanningRequestId !== null && (
        <ProgressPanel key={scanJobId} jobId={scanJobId} />
      )}
    </div>
  );
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm run test -w apps/web -- my-repos-panel.test.tsx`
Expected: PASS

- [ ] **Step 7: Run the full web test suite and build**

Run: `npm run test -w apps/web && npm run build -w apps/web`
Expected: PASS / SUCCESS

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/lib/api-client.ts apps/web/src/components/my-repos-panel.tsx apps/web/src/components/my-repos-panel.test.tsx
git commit -m "feat(web): MyReposPanel watches scan job progress instead of awaiting completion"
```

---

### Task 16: Final full verification

- [ ] **Step 1:** Ensure Redis is running: `podman compose up -d redis` (from the repo root).
- [ ] **Step 2:** Run: `npm run test -w apps/api && npm run build -w apps/api`. Expected: PASS / SUCCESS.
- [ ] **Step 3:** Run: `npm run test -w apps/web && npm run build -w apps/web`. Expected: PASS / SUCCESS.
- [ ] **Step 4:** Dispatch the `hex-architecture-reviewer` agent (any change under `apps/api/src/modules/scanner/` since Task 7 — this covers the Part B changes too). Address anything it flags.
- [ ] **Step 5:** Dispatch the `lazy-simplifier` agent (or run `ponytail-review`) scoped to every file touched by this plan. Address anything it flags.
- [ ] **Step 6:** Manual verification (per the design spec's Testing section): start the API and web app, trigger 5+ scans at once via `mine/scan-repo` or the admin `/scan` flow, and confirm the 5th+ shows `queued` in the progress UI until a Piscina slot frees up, rather than all running at once or erroring. Confirm the app stays responsive throughout (hit another endpoint from a second client while scans run).
- [ ] **Step 7:** No commit for this task — it's verification only. If Steps 4-5 surfaced fixes, those get their own commits per the agents' findings.
