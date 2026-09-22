# Global Scan Stop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Глобальний Stop припиняє всі незавершені сканування, включно з роботою попередніх запусків у черзі й активних worker-ах, і показує правдивий стан.

**Architecture:** Redis зберігає довговічний epoch і стан Stop; jobs і persisted спроби успадковують незмінне покоління. Workers перевіряють допуск перед роботою й переходами, використовують наявний AbortSignal. SQLite зберігає cancellation окремо від failure; ідемпотентне узгодження завершує Stop лише після cleanup.

**Tech Stack:** NestJS, TypeScript, BullMQ, ioredis, Prisma/SQLite, Piscina, Next.js/React, Jest, Vitest. Нові залежності не потрібні.

**Spec:** `docs/superpowers/specs/2026-09-22-global-scan-stop-design.md`

## Global Constraints

- Stop глобальний: усі незавершені `scan`, `scan-repo`, `rescan-service`, HEAD і HISTORY незалежно від `parentJobId`; discovery не зупиняється.
- Завершені results/findings/checkpoints/candidates не видаляються. Майбутній явний Start після завершеного Stop дозволений.
- Epoch серверний і незмінний для job та дітей; відсутній epoch у legacy job означає 0, некоректне присутнє значення відхиляється.
- У разі втрати Redis barrier не відновлювати мовчки epoch 0 й не запускати роботу.
- Глобальний Stop доступний лише адміністратору; у відповідях/логах немає raw secrets.
- Root і `credsScrapper/AGENTS.md` мають пріоритет: без commit/push/deploy, жодних реальних leaked credentials, зберігати сторонні edits/DB/backups.
- `schema.prisma`, Prisma adapter і fake repository уже мають сторонні незавершені edits. Працювати additively, перевіряти diff до і після.
- `apps/...` та npm-команди відносні до `credsScrapper/`; `docs/superpowers/...` — до Git root. Не запускати `npm run stop` (видаляє volumes).
- API source TypeScript: форматувати тільки змінені файли, потім type-check; для кожного зміненого app — повні tests/build. Redis/SQLite integration tests — лише ізольовані синтетичні дані.

## Review Focus

1. Пізній root/child enqueue після Stop не запускає Git — Tasks 1, 3, 4.
2. Пізній terminal write старого worker не змінює новішу спробу — Task 2.
3. Відсутній Redis key або помилка poll не стає успіхом і не залишає unhandled rejection — Tasks 1, 4, 7.
4. Root DONE, HISTORY active, reload/socket loss: глобальна кнопка і стан лишаються видимими — Task 6.
5. Legacy jobs, повторний Stop та новий rescan того ж SHA — Tasks 1, 4, 7.

---

## Ownership і спільний контракт

Один backend writer володіє Tasks 1–5 (пов’язані порти, persistence, workers). Web worker отримує контракт після Tasks 1 і 5 та володіє тільки `apps/web/**`. Після інтеграції один verifier володіє повними tests/builds і спільними тестовими сервісами. Незалежний reviewer читає diff; fixes повертаються writer. Всі отримують spec, план і попередження не відкотити чужі edits.

Backend визначає:

```ts
enum EScanControlState { READY = 'ready', STOPPING = 'stopping', STOPPED = 'stopped' }
interface IScanControlState {
  epoch: number; state: EScanControlState; stopEpoch: number | null;
  requestedAt: string | null; finishedAt: string | null;
}
interface IScanQueueCounts { queued: number; active: number }
interface IScanRuntime extends IScanControlState {
  queues: { control: IScanQueueCounts; head: IScanQueueCounts; history: IScanQueueCounts };
}
interface IScanStatus extends IQueueStatus { runtime: IScanRuntime }
class ScanControlError extends Error {
  constructor(readonly code: 'scan_stopping' | 'scan_control_unavailable') { super(code); }
}
```

`IQueueStatus` лишається SQLite-контрактом. `GetScanStatusUseCase` поєднує його з Redis runtime; StateRepository не імпортує Redis. Додати до наявного `JobQueuePort`: `readScanControl(): Promise<IScanControlState>`, `requestStopAllScans(): Promise<IScanControlState>`, `getScanRuntime(): Promise<IScanRuntime>`, `hasActiveScansBefore(epoch: number): Promise<boolean>`, `completeScanStop(epoch: number): Promise<boolean>`. `enqueue` і `enqueuePhase` зберігають сигнатури.

### Task 1: Redis barrier і root admission

**Files:** create `domain/constant/scan-control.constant.ts`, `domain/types/scan-control.type.ts`, `domain/errors/scan-control.error.ts`, `infrastructure/jobs/scan-control-script.ts`, `apps/api/tests/integration/scanner/scan-control.adapter.spec.ts`, `apps/api/scripts/scan-control.ts`; modify `application/ports/job-queue.port.ts`, `infrastructure/jobs/bullmq-job-queue.adapter.ts`, `domain/constant/job-status.constant.ts`, `apps/api/package.json`, relevant queue tests/fakes. Source paths under `apps/api/src/modules/scanner/`.

**Produces:** Redis `scanner:control` JSON without TTL; initial controlled `epoch=0, state=ready`; phase job ID includes epoch; STOPPING/STOPPED job status enum members.

- [ ] Write RED integration tests on isolated Redis: Stop increments 0→1 once, repeat Stop returns same operation, key TTL is -1, root enqueue during stopping throws `scan_stopping`, wrong epoch cannot finish, explicit Start after stopped uses 1. Missing/malformed key throws `scan_control_unavailable` and is not initialized on read/enqueue. Use synthetic payload only.
- [ ] Run `npm run test -w apps/api -- --runInBand tests/integration/scanner/scan-control.adapter.spec.ts`; record expected failure from missing method/contract.
- [ ] Implement atomic Redis transition `admit | stop | finish` via Lua/CAS: admit rejects stopping; stop from ready increments epoch and sets requestedAt; finish succeeds only for matching stopping epoch. Validate safe integer/state/JSON and map errors to safe `ScanControlError`, never log raw Redis value.
- [ ] In `enqueue(type,payload)`, only root `scan | scan-repo | rescan-service` calls admit, overwrites client-supplied `scanEpoch`, then calls BullMQ add. `discover` bypasses barrier. `enqueuePhase` inherits payload epoch (legacy default 0), using ID `epoch-repoId-targetSha`.
- [ ] Add race test by delaying `queue.add`: admit epoch 0, Stop closes it, late job still carries 0. Add dedupe test: same phase/repo/SHA/epoch gives same ID, epoch 1 gives another.
- [ ] Add controlled CLI `npm run scan:control -w apps/api -- init` using SET NX, plus `recover --epoch N` that refuses existing key and requires N above persisted epochs; CLI closes Redis/Prisma, never clears data. Do not run on working environment.
- [ ] Run focused queue tests green. Review no TTL/reset-on-startup and unchanged discovery/per-job Stop behavior.

Representative RED assertion and implementation shape:

```ts
const first = await adapter.requestStopAllScans();
expect(first).toMatchObject({ epoch: 1, state: 'stopping' });
expect(await adapter.requestStopAllScans()).toEqual(first);
await expect(adapter.enqueue('scan', { workdirRoot: 'synthetic' }))
  .rejects.toMatchObject({ code: 'scan_stopping' });
```

```lua
local raw = redis.call('GET', KEYS[1])
if not raw then return redis.error_reply('scan_control_unavailable') end
local control = cjson.decode(raw)
if ARGV[1] == 'stop' and control.state == 'ready' then
  control.epoch = control.epoch + 1
  control.state = 'stopping'
  control.stopEpoch = control.epoch
  control.requestedAt = ARGV[2]
  control.finishedAt = cjson.null
  redis.call('SET', KEYS[1], cjson.encode(control))
end
return cjson.encode(control)
```

### Task 2: Persisted epoch і cancellation

**Files:** modify `apps/api/prisma/schema.prisma`, `application/ports/state-repository.port.ts`, `domain/types/scan-phase-record.type.ts`, `domain/types/scanned-repo-record.type.ts`, `domain/constant/scan-status.constant.ts`, `infrastructure/persistence/prisma-state-repository.ts`, `tests/unit/scanner/fakes/fake-state-repository.ts`, persistence/mapper tests; create `apps/api/prisma/migrations/20260922010000_global_scan_stop/migration.sql`.

**Produces:** `scanEpoch Int @default(0) @map("scan_epoch")` in ScannedRepo/ScanPhase, CANCELLED repo status; `claimNext(scanEpoch?: number)`, `startRepoScan(repoId,owner,name,scanEpoch?: number)`, `schedulePhase(repoId,phase,targetSha,scanEpoch?: number)`, `claimPhase(repoId,phase,targetSha,scanEpoch?: number)`, `cancelScansBefore(epoch: number)`. Existing callers default legacy 0; new callers pass epoch.

- [ ] Write RED SQLite test: create synthetic HEAD RUNNING at epoch 0, `cancelScansBefore(1)`; expect phase/repo CANCELLED, retry 0, `requeueFailed(3)=0`, `requeueStale(0)=0`. Separate test: HEAD DONE + HISTORY PENDING retains completed SHA and findings while cancelling HISTORY.
- [ ] Run `npm run test -w apps/api -- --runInBand tests/integration/scanner/prisma-state-repository.spec.ts`; observe expected missing epoch/cancel failure.
- [ ] Add additive SQL columns with `INTEGER NOT NULL DEFAULT 0`; generate Prisma client in test workspace only. Preserve current user changes to schema and adapter.
- [ ] Guard phase schedule/claim/terminal writes and repo terminal writes by epoch (and target SHA for phases). Cancellation bulk update affects only PENDING/RUNNING with `scanEpoch < epoch`; does not increment retry or clear checkpoints. Cancelled HEAD updates repo CANCELLED; HISTORY cancellation does not undo completed HEAD.
- [ ] Add late-write tests: after old epoch cancelled and new epoch claimed, old `markPhaseFailed`, `markPhaseDone`, and `schedulePhase` leave epoch-1 RUNNING unchanged. Fake repository mirrors guards.
- [ ] Run persistence and mapper focused tests green. Review migration and conditional updates.

RED must fail before adding the migration/adapter method:

```ts
await repo.startRepoScan(1, 'local', 'fixture', 0);
await repo.schedulePhase(1, EScanPhase.HEAD, 'latest', 0);
await repo.claimPhase(1, EScanPhase.HEAD, 'latest', 0);
await repo.cancelScansBefore(1);
expect(await repo.getPhase(1, EScanPhase.HEAD)).toMatchObject({
  status: EScanPhaseStatus.CANCELLED, scanEpoch: 0, retryCount: 0,
});
expect(await repo.requeueFailed(3)).toBe(0);
```

```sql
ALTER TABLE "scanned_repos" ADD COLUMN "scan_epoch" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "scan_phases" ADD COLUMN "scan_epoch" INTEGER NOT NULL DEFAULT 0;
```

Use `updateMany({ where: { repoId, phase, scanEpoch, status: RUNNING, targetSha } })` for terminal phase writes; only its successful update may change the matching repo attempt.

### Task 3: Application flow і recovery

**Files:** modify `application/use-cases/run-scan-loop.use-case.ts`, `scan-repository-phase.use-case.ts`, `reconcile-scan-phases.use-case.ts`, `rescan-repository-service.use-case.ts`, `enqueue-repo-scan.ts` and focused unit tests; create `tests/unit/scanner/application/use-cases/reconcile-scan-phases.use-case.spec.ts`.

**Consumes:** Tasks 1–2 epoch/Stop contracts. `RunScanLoopOptions` and `IScanRepositoryPhaseOptions` carry `scanEpoch?: number`; phase options also carry optional `shouldStop?: () => Promise<boolean>`.

- [ ] Write RED tests: pre-aborted phase signal returns `cancelled` before cache acquire/worker run; Stop after HEAD DONE prevents HISTORY enqueue/next candidate; service Stop between HEAD/HISTORY prevents HISTORY and `resetTestResults`; reconciliation skips old epoch pending phase.
- [ ] Run `npm run test -w apps/api -- --runInBand tests/unit/scanner/application/use-cases/run-scan-loop.use-case.spec.ts tests/unit/scanner/application/use-cases/scan-repository-phase.use-case.spec.ts tests/unit/scanner/application/use-cases/rescan-repository-service.use-case.spec.ts`; observe behavior failure.
- [ ] Pass immutable epoch through claim/schedule/worker/HISTORY payload. Before phase schedule/cache/worker and before next phase, return `{status:'cancelled',failReason:'scan_cancelled'}` when signal/Stop says true. Do not turn a rejected control read into cancellation.
- [ ] In scan loop, Stop takes precedence over prior aggregate failure as terminal job state, while failure count remains in log; without Stop retain FAILED behavior. Reconciliation reads persisted epoch, cancels old phases, does not enqueue during stopping, and never assigns current epoch to old phase. Worker guard still handles snapshot race.
- [ ] Move `startRepoScan()` out of HTTP enqueue helper to admitted worker preflight, so rejected Start cannot leave IN_PROGRESS. Preserve authorization checks. Update admin/auth unit tests to assert no pre-enqueue state write.
- [ ] Run all Task-3 focused unit tests green. Review no hidden requeue or extra service validation.

Preflight result and reconciliation shape:

```ts
if (options.signal?.aborted || await options.shouldStop?.()) {
  return { status: 'cancelled', failReason: 'scan_cancelled',
    targetSha: options.targetSha };
}
const control = await this.jobs.readScanControl();
await this.state.cancelScansBefore(control.epoch);
if (control.state === EScanControlState.STOPPING) return 0;
for (const phase of pending) {
  if (phase.scanEpoch !== control.epoch) continue;
  await this.jobs.enqueuePhase(EScanPhase.HISTORY, ref, phase.targetSha, {
    repoRef: ref, targetSha: phase.targetSha, scanEpoch: phase.scanEpoch,
    cloneSource, workdir,
  });
}
```

Test HEAD→HISTORY with a deferred `shouldStop`: after HEAD resolves DONE, switch it to true; assert `enqueuePhase` and the next `claimNext` were not called.

### Task 4: BullMQ worker cancellation і Stop completion

**Files:** modify `infrastructure/jobs/bullmq-job-worker.ts`, `bullmq-job-queue.adapter.ts`, `scanner.module.ts`, focused worker tests; create `application/use-cases/reconcile-scan-stop.use-case.ts`, `tests/unit/scanner/application/use-cases/reconcile-scan-stop.use-case.spec.ts`, `tests/unit/scanner/infrastructure/jobs/bullmq-global-stop.spec.ts`.

**Produces:** `ReconcileScanStopUseCase.execute(): Promise<void>`; terminal STOPPED outcome persisted in BullMQ progress/result; runtime counts for control/head/history.

- [ ] RED coordinator test with fake active worker: `execute()` must not call `completeScanStop(1)` while active; after cleanup resolve it may finish. RED table tests for stale queued `scan`, `scan-repo`, `rescan-service`, HEAD, HISTORY: corresponding scan/phase use-case and Git not invoked, result STOPPED.
- [ ] Run `npm run test -w apps/api -- --runInBand tests/unit/scanner/application/use-cases/reconcile-scan-stop.use-case.spec.ts tests/unit/scanner/infrastructure/jobs/bullmq-global-stop.spec.ts`; observe expected failure.
- [ ] Processor preflight checks `scanEpoch < control.epoch` or stopping before state/cache/scan. Active monitor checks global and individual stop every 500 ms, serializes overlapping checks, catches Redis rejection, aborts with safe `scan_control_unavailable` reason. Discovery uses only individual stop. Phase monitor also checks parent flag.
- [ ] For admitted `scan-repo`, call `state.startRepoScan(..., scanEpoch)` only after preflight; pass epoch/signal/shouldStop into phase flow. Save STOPPED progress/outcome and await its write before BullMQ completes. Failed control read takes priority over Stop and stays an error, not false success.
- [ ] Implement coordinator: read stopping state, `state.cancelScansBefore(epoch)`, verify no active old scan processors, recheck persistence/activity, conditionally `completeScanStop(epoch)`. No timeout-based success. Run on startup and repeating timer; catch errors, prevent overlapping reconciliations, clear timer and await in-flight work on close.
- [ ] Map `getJob()` by BullMQ state plus saved outcome: completed+stopped→STOPPED; ordinary completed→DONE; failed→FAILED; old active→STOPPING; old queued→STOPPED. Do not rewrite previously completed jobs. `getScanRuntime()` counts all pages of active/queued scan jobs across three queues, excludes discovery and cancelled technical records.
- [ ] GREEN focused worker/coordinator tests, including active cleanup barrier and Redis poll failure without unhandled rejection. Review actual abort propagation, cleanup, no dangling timers.

Coordinator and monitor core:

```ts
const control = await jobs.readScanControl();
if (control.state !== EScanControlState.STOPPING) return;
await state.cancelScansBefore(control.epoch);
if (await jobs.hasActiveScansBefore(control.epoch)) return;
await state.cancelScansBefore(control.epoch);
if (await jobs.hasActiveScansBefore(control.epoch)) return;
await jobs.completeScanStop(control.epoch);
```

```ts
let checking = false;
const pollStop = async () => {
  if (checking || abort.signal.aborted) return;
  checking = true;
  try {
    if (await shouldStop()) abort.abort();
  } catch {
    abort.abort(new ScanControlError('scan_control_unavailable'));
  } finally {
    checking = false;
  }
};
```

The active test holds a synthetic cleanup promise after abort; `readScanControl().state` must remain `stopping` until that promise resolves.

### Task 5: HTTP, authorization і dependency injection

**Files:** create `application/use-cases/stop-all-scans.use-case.ts`, `presentation/scan-control-exception.filter.ts`, unit/integration HTTP tests; modify `application/use-cases/get-scan-status.use-case.ts`, `presentation/scan.controller.ts`, `scanner.module.ts`.

**Produces:** `POST /scan/stop` admin-only → 202 `IScanControlState`; `GET /scan/status` → `IScanStatus`; `scan_stopping` → 409, unavailable → 503.

- [ ] RED unit tests: `StopAllScansUseCase.execute()` delegates to queue port; `GetScanStatusUseCase.execute()` combines SQLite counts and Redis runtime. RED HTTP tests: non-admin Stop 403, admin Stop 202, rejected Start 409 with stable `scan_stopping` code, unavailable 503, no false IN_PROGRESS.
- [ ] Run `npm run test -w apps/api -- --runInBand tests/unit/scanner/application/use-cases/get-scan-status.use-case.spec.ts tests/unit/scanner/application/use-cases/stop-all-scans.use-case.spec.ts tests/integration/scanner/scan-control.http.spec.ts`; observe expected failures.
- [ ] Implement thin use-cases; register with existing `provideUseCase`; controller `@Post('stop') @HttpCode(202) @UseGuards(AdminGuard)` calls exactly one use-case. Exception filter handles only ScanControlError and applies consistently to all Start endpoints.
- [ ] Run focused HTTP/unit tests green. Freeze response types and error copy for web handoff.

Use-case and controller shape:

```ts
async execute(): Promise<IScanStatus> {
  const [counts, runtime] = await Promise.all([
    this.state.getQueueStatus(), this.jobs.getScanRuntime(),
  ]);
  return { ...counts, runtime };
}
```

```ts
@Post('stop')
@HttpCode(202)
@UseGuards(AdminGuard)
stopAll(): Promise<IScanControlState> {
  return this.stopAllScans.execute();
}
```

HTTP RED: non-admin `POST /scan/stop` returns 403; admin returns 202 with `state: 'stopping'`; `ScanControlError('scan_stopping')` on a Start endpoint returns 409 and no scan state write.

### Task 6: Web глобальний Stop і правдиві статуси

**Owner:** web worker after Task 5 contract. **Writable scope:** only `apps/web/**`.

**Files:** create `src/lib/types/scan-control.type.ts` and focused progress-panel tests; modify `src/lib/types/queue-status.type.ts`, `src/lib/constant/job-status.constant.ts`, `scan-status.constant.ts`, `src/lib/api-client.ts`, `src/app/dashboard.tsx`, `src/components/progress-panel.tsx`, `scan-controls.tsx`, `my-repos-panel.tsx`, `testing-panel.tsx`, `scanned-repos-table.tsx` and focused tests.

**Consumes:** Task-5 HTTP contract. `stopAllScans(): Promise<IScanControlState>`. Admin controls get runtime; non-admin receives only 409 from own Start endpoint, no global counters.

- [ ] RED dashboard test: no stored job ID, HISTORY active 1 → `Stop all scans` enabled. RED test: 202 response shows `Stopping…`, not `Stopped` until status poll confirms; reload still shows stopping.
- [ ] Run `npm run test -w apps/web -- src/app/dashboard.test.tsx`; observe expected failure.
- [ ] Add API types/call, bounded serial admin status polling with cleanup and stale-response guard. On API failure display unavailable, not zero. Show queued/active Control, HEAD, HISTORY jobs separately; repo `Done` label must not claim HISTORY complete.
- [ ] Keep global Stop outside last-job ProgressPanel. Disable scan/rescan starts while stopping, not discovery, filters, live testing or authorization. Explicitly display 409; no auto-retry. Add STOPPING/STOPPED styling and terminal refresh; preserve per-job discovery Stop.
- [ ] GREEN dashboard/progress tests: global button after root DONE, API error, socket loss, non-admin hiding, stale poll response, cancelled repo tone, live testing still enabled.

UI RED/implementation shape:

```tsx
expect(await screen.findByRole('button', { name: 'Stop all scans' }))
  .toBeEnabled(); // history.active=1, no last jobId
await user.click(screen.getByRole('button', { name: 'Stop all scans' }));
expect(screen.getByText('Stopping…')).toBeInTheDocument();
expect(screen.queryByText('Stopped')).not.toBeInTheDocument();
```

```ts
export function stopAllScans(): Promise<IScanControlState> {
  return post<IScanControlState>('/scan/stop');
}
```

The admin poll stores a response only if its request revision is still current; Stop increments the revision before calling the API, so an older in-flight `ready` response cannot overwrite `stopping`.

### Task 7: Наскрізна перевірка з реальними чергами

**Owner:** verifier after integrated backend; fixes return to backend writer. **Files:** create `apps/api/tests/integration/scanner/global-scan-stop.spec.ts`; modify Piscina/BullMQ integration tests.

- [ ] Use isolated Redis URL and temporary SQLite only; never FLUSHDB working Redis. Tests use synthetic refs/repo content, deterministic deferred promises/barriers, and close workers/clients in finally.
- [ ] Real BullMQ RED/GREEN scenario: active and queued jobs of all scan types + phases; Stop via second adapter; assert no post-Stop scan start, abort of active work, state remains stopping until cleanup resolves, then stopped. Discovery continues independently.
- [ ] Restart worker with same isolated Redis/SQLite while stopping: legacy epoch-0 pending phase is cancelled, no Git starts; repeat Stop idempotent; new explicit scan of same repo/SHA after stopped runs at new epoch.
- [ ] Build API before real Piscina tests. Synthetic HEAD and HISTORY scans abort on first progress and return cancelled; a subsequent short scan on same pool succeeds, demonstrating resource release. Use no arbitrary sleeps as correctness proof.
- [ ] Run `npm run build -w apps/api`, then `npm run test -w apps/api -- --runInBand tests/integration/scanner/global-scan-stop.spec.ts tests/integration/scanner/piscina-scan-worker.adapter.spec.ts`. Fix failures and rerun.

Integration assertions use the real queue adapter with a synthetic delayed worker:

```ts
expect((await secondAdapter.requestStopAllScans()).state).toBe('stopping');
await waitForStopped({ timeoutMs: 5000 });
expect((await firstAdapter.readScanControl()).state).toBe('stopped');
expect(startedAfterStop).toEqual([]);
expect(cancelledKinds.sort()).toEqual(
  ['head', 'history', 'rescan-service', 'scan', 'scan-repo'].sort(),
);
```

### Task 8: Операційна документація, повні checks, reviews

**Files:** modify `credsScrapper/README.md`; review all task diffs, not unrelated files.

- [ ] Document controlled `npm run scan:control -w apps/api -- init` for first upgrade and `recover --epoch N` after confirmed data loss, Redis persistence, no mixed old/new workers, no auto-reset, and Stop/new Start semantics. Do not execute CLI against working Redis.
- [ ] Run Prettier only on changed API source `.ts` files with explicit list; then `./node_modules/.bin/tsc --noEmit -p apps/api/tsconfig.json` from `credsScrapper/`.
- [ ] One verifier runs full `npm run build -w apps/api`, `npm run test -w apps/api -- --runInBand`, `npm run test -w apps/web`, `npm run build -w apps/web` using isolated test services. Report each failure; after fixes rerun affected and required full checks.
- [ ] Independent read-only reviewer applies `.agents/skills/hex-architecture-reviewer/SKILL.md`, `secret-handling-reviewer/SKILL.md`, `lazy-simplifier/SKILL.md` and all five Review Focus points. Actionable findings return to writer; no blind acceptance of agent results.
- [ ] Recheck all 15 spec acceptance criteria against tests/runtime checks; report delivered behavior, exact checks, remaining operational risks and lack of commit/push/deploy.

## Self-review

Tasks cover Redis barrier, three queues, root/child races, SQLite generations, legacy/restart, status/API/UI, retention and authorization. The five Review Focus cases each have a test owner. Existing `StateRepositoryPort.getQueueStatus()` stays SQLite-only to preserve hexagonal boundaries. No placeholder implementation, unrelated migration, live secret validation, commit or push is in scope.

## Execution handoff

The written spec was approved before this plan. The plan itself needs review and an execution method choice before implementation. Recommended: **subagent-driven**, because cancellation/recovery mistakes could restart forbidden work and benefit from independent gates; web can follow the fixed HTTP contract. Alternative: **native** implementation in this task with one final independent review. Neither option authorizes commit, push or deploy.
