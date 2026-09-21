# Independent HEAD and history scans

## Goal and accepted scope

Return findings from current repository files promptly while large historical
downloads run independently. Keep Node/NestJS, Git, Prisma/SQLite and BullMQ.
The user approved separating HEAD/history, two HEAD workers plus one history
worker, bounded work, visible progress and independent checkpoints.

## Current constraints verified in code

- `RunScanLoopUseCase` defaults to one repository at a time.
- `RunScanJobUseCase` synchronizes a full bare repository, scans history, then HEAD.
- `ScanRepositoryUseCase` joins active scans by repo ID and marks one shared
  checkpoint only after findings persistence.
- BullMQ jobs and Piscina currently share capacity across kinds of work.
- Cache locks are keyed by workdir. Git clone/fetch has no time or disk budget.
- Stop is currently checked between repositories, not during clone/detection.

## Selected approach

Use shallow bare Git for HEAD (`--depth=1 --single-branch --no-tags`). Reuse
the existing safe blob reader and detector. Use a separate full bare cache for
history. HEAD never unshallows its cache; history never takes HEAD's cache lock.
For local fixture sources use `file://` or `--no-local` so Git honors depth.

Archive download is deferred: shallow Git reuses the tested object reader and
avoids introducing archive parsing in this change. Increasing full-clone
concurrency alone would multiply network/disk pressure and would not meet the
goal. HEAD itself may still be large; it receives explicit budgets too.

## Scheduling and isolation

Retain the existing control queue for discovery and scan-run orchestration.
Add dedicated HEAD and history repository queues with globally enforced
concurrency 2 and 1 respectively. Give each queue its own Piscina pool with
matching capacity; history cannot consume HEAD threads.

The scan loop dispatches HEAD work. Once HEAD findings and checkpoint are
persisted, enqueue history without awaiting its completion. Each repository
phase has a stable deduplication identity; retries and repeated requests join
the same pending phase instead of creating parallel clones.

Persist `history=pending` with the HEAD completion transaction before enqueue.
On startup and during dispatch, reconcile pending history rows without a live
job, making the database-to-Redis handoff recoverable after a crash. A failed
enqueue must not erase successful HEAD coverage. Retained completed BullMQ jobs
must not prevent scheduling a newer SHA or retrying incomplete work.

Queue-aware job lookup, stop and progress retain the existing public job ID
contract through an opaque phase prefix. Existing unprefixed control job IDs
remain readable. Validate queue selection; clients cannot supply queue names.

## Persistence and coverage

Add a repository scan-phase record keyed by `(repoId, phase)`, containing:
status, target SHA, last fully completed SHA, scanner version, timestamps,
failure category, safe reason and retry count. Phases are `head` and `history`.
Statuses are `pending`, `running`, `done`, `incomplete`, `failed`, `cancelled`.

Preserve existing repository rows and findings. Migrate existing completed
full-scan checkpoints to both phases only when a SHA and scanner version exist.
Legacy incomplete/failed rows do not acquire successful coverage by migration.
Old in-progress work is reconciled at restart, not migrated as done.

HEAD completion never advances history's checkpoint. History snapshots its
actual fetched SHA and scans only that immutable target; a later HEAD scan may
report a newer SHA. UI must expose which SHA each completed phase covers.
History retains the current full-history semantics; incremental traversal is
allowed only for a compatible scanner version and an ancestor checkpoint.

Findings retain all commit sightings and HEAD-path preference. Partial findings
are persisted on cooperative cancellation or budget expiry. Mark a phase done
only after the complete phase and findings write succeed. Do not move the
successful checkpoint after partial work or a failed write.

## Budgets, progress and stop

Initial configurable budgets per repository phase:

| Phase | Wall time | Cache size |
|---|---:|---:|
| HEAD | 120 seconds | 512 MiB |
| History | 15 minutes | 2 GiB |

Validate positive finite configuration values at startup. Count existing cache
bytes as well as bytes downloaded during the attempt. Disk budgets are monitored
ceilings with possible overshoot between checks, not hard filesystem quotas.
Sample cache growth at most every five seconds without walking unrelated caches.

Progress includes phase, elapsed time, acquired bytes, processed files/commits
and safe aggregate finding counts, throttled to at most one update per second.
Never include source contents, credential values or raw Git stderr.

Stop propagates from a scan run to its queued/active child jobs. It cancels
queued work and signals running workers; it must also work inside clone/fetch.
Terminate the Git process group, wait for children to exit, flush available
aggregates, then release the cache lock. A deadline fallback may terminate a
non-cooperative worker, reporting that unflushed findings require retry.

Budget expiry is `incomplete`; an explicit stop is `cancelled`. Neither becomes
done or triggers an automatic retry loop. Transient transport failures receive
bounded retry/backoff. Unavailable-to-anonymous-access repositories receive a
distinct non-automatic-retry category; do not claim an auth error proves deletion.
An explicit user retry remains available. Clean only failed attempt files owned
by the scanner after all child processes stop; preserve successful cache/data.

## UI and compatibility

Display HEAD and history status separately in repository listings, including
coverage SHA, progress and reason for incomplete/failed work. A successful HEAD
scan displays “Current files checked; history pending/running” as appropriate.
An empty HEAD result must not imply historical secrets were checked.

Expose history jobs through existing job status/progress APIs. A control run
finishing HEAD processing must say history may remain pending, rather than
claiming the full scan completed. Keep existing authorization checks unchanged;
passive detection never triggers live key testing.

## Verification and acceptance

1. A repository with a secret only in an old commit: HEAD omits it, history finds
   it; HEAD success does not populate history's successful checkpoint.
2. Block the history worker and confirm another repository's HEAD completes
   through the real separate BullMQ queues and Piscina pools.
3. Real shallow Git fixture proves the HEAD cache is shallow and excludes older
   history; historical scanning still uses a separate full cache.
4. Retry/restart/concurrent requests do not duplicate phase jobs or lose pending
   history. Test enqueue failure after HEAD persistence and reconciliation.
5. Cancel and budget-exhaust during Git acquisition and detection: no orphaned
   children/held lock, no false done, available partial findings retained.
6. Test old schema migration, unchanged SHA skip, force-push fallback and phase
   scanner-version invalidation without losing existing findings.
7. UI tests cover HEAD done/history incomplete and explicit coverage differences.
8. Run API/web tests and builds, backend formatting/typecheck, hex architecture,
   secret-handling and simplicity reviews. Use synthetic fixture repositories.
9. Compare full acquisition versus HEAD acquisition and time to first persisted
   findings on identical snapshots, clearly labeling different coverage. Do not
   launch competing benchmarks against the user's active production scan.

## Rollout

Do not change or terminate the currently running scan during development. Stage
the schema migration and code together, then restart with the old worker stopped.
Recover stale phase work at startup. No automatic commit/push is part of this
task. The previous request to publish applied to the previous completed change.
