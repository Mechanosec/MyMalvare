import { IRepoRef } from '../../domain/types/repo-ref.type';
import { LoggerPort } from '../ports/logger.port';
import { StateRepositoryPort } from '../ports/state-repository.port';
import { WorkdirJoinerPort } from '../ports/workdir-joiner.port';
import { ScanRepositoryUseCase } from './scan-repository.use-case';
import { ScanRepositoryPhaseUseCase } from './scan-repository-phase.use-case';
import { JobQueuePort } from '../ports/job-queue.port';
import { EScanPhase } from '../../domain/constant/scan-phase.constant';

export interface RunScanLoopOptions {
  readonly workdirRoot: string;
  readonly sourceUrlFn: (ref: IRepoRef) => string;
  readonly staleTimeoutSeconds?: number;
  readonly maxRetries?: number;
  readonly maxRepos?: number;
  readonly workers?: number;
  readonly onProgress?: (message: string, processed: number) => void;
  /** Checked once per repo, between claiming one and the next - a cooperative stop, not an immediate kill: a repo already being cloned/scanned finishes first. */
  readonly shouldStop?: () => Promise<boolean>;
  readonly signal?: AbortSignal;
  readonly parentJobId?: string;
  readonly scanEpoch?: number;
}

// Ported from credsScrapper/app/scan/orchestrator.py's run_scan_loop.
// Python used OS threads (ThreadPoolExecutor) with a threading.Lock
// around a shared counter, because CPython threads can genuinely
// interleave between "check the counter" and "increment it". Node has no
// such concurrency here - `workers` independent async loops share one
// event loop, so a synchronous check-then-increment (no `await` in
// between) is already atomic; the reserve-before-claim pattern below
// mirrors the Python version's structure, but the mutual exclusion comes
// for free from the language, not from a lock.
export class RunScanLoopUseCase {
  constructor(
    private readonly state: StateRepositoryPort,
    private readonly scanRepository: ScanRepositoryUseCase,
    private readonly logger: LoggerPort,
    private readonly workdirJoiner: WorkdirJoinerPort,
    private readonly phaseScanner?: ScanRepositoryPhaseUseCase,
    private readonly jobs?: JobQueuePort,
  ) {}

  async execute(options: RunScanLoopOptions): Promise<number> {
    const {
      workdirRoot,
      sourceUrlFn,
      staleTimeoutSeconds = 3600,
      maxRetries = 3,
      maxRepos,
      workers = 2,
      onProgress,
      shouldStop,
      signal,
      parentJobId,
      scanEpoch = 0,
    } = options;

    let processed = 0;
    let failed = 0;
    let stopped = false;
    const report = (message: string) => {
      this.logger.log(message);
      onProgress?.(message, processed);
    };

    if ((await shouldStop?.()) || signal?.aborted) {
      report('scan: stopped by request, 0 repos processed this run');
      return 0;
    }

    const requeued = await this.state.requeueStale(staleTimeoutSeconds);
    if (requeued > 0) {
      report(`scan: requeued ${requeued} stale in-progress repos`);
    }
    const requeuedFailed = await this.state.requeueFailed(maxRetries);
    if (requeuedFailed > 0) {
      report(
        `scan: requeued ${requeuedFailed} failed repos for retry (max ${maxRetries} attempts)`,
      );
    }
    await this.workdirJoiner.ensureDir(workdirRoot);

    let reserved = 0;
    let loopFailed = false;
    let firstError: unknown;

    const workerLoop = async (): Promise<void> => {
      try {
        for (;;) {
          if (loopFailed) return;
          const stopRequested = await shouldStop?.();
          if (loopFailed) return;
          if (stopRequested || signal?.aborted) {
            stopped = true;
            return;
          }
          // No await between checking and reserving: all worker loops share
          // this counter, including when the stop check yields to another loop.
          if (maxRepos !== undefined && reserved >= maxRepos) {
            return;
          }
          reserved += 1;
          const ref: IRepoRef | null = await this.state.claimNext(scanEpoch);
          if (ref === null) {
            reserved -= 1;
            return;
          }
          const workdir = this.workdirJoiner.join(
            workdirRoot,
            `repo-${ref.repoId}`,
          );
          // scanRepository reports its own per-repo progress (cloning,
          // cloned, working tree done, done/failed) through this same
          // onProgress channel, tagged with the count completed so far -
          // without this, the UI only ever saw "processed N" once per
          // whole repo, which looked idle during a slow clone/scan.
          const cloneSource = sourceUrlFn(ref);
          const result = this.phaseScanner
            ? await this.phaseScanner.execute({
                repoRef: ref,
                phase: EScanPhase.HEAD,
                cloneSource,
                workdir,
                scanEpoch,
                shouldStop,
                signal,
                onProgress: (message) => onProgress?.(message, processed),
              })
            : await this.scanRepository.execute(
                ref,
                cloneSource,
                workdir,
                (message) => onProgress?.(message, processed),
              );
          if (result?.status === 'failed') failed += 1;
          const stopAfterRepo =
            (await shouldStop?.()) || signal?.aborted || loopFailed;
          if (
            !stopAfterRepo &&
            this.phaseScanner &&
            this.jobs &&
            result.status === 'done'
          ) {
            await this.jobs.enqueuePhase(
              EScanPhase.HISTORY,
              ref,
              result.headSha,
              {
                repoRef: ref,
                cloneSource,
                workdir,
                targetSha: result.headSha,
                parentJobId,
                scanEpoch,
              },
            );
          }
          processed += 1;
          onProgress?.(`scan: ${processed} repos processed so far`, processed);
          if (stopAfterRepo) {
            stopped = true;
            return;
          }
        }
      } catch (error) {
        if (!loopFailed) firstError = error;
        loopFailed = true;
        throw error;
      }
    };

    const workerCount = Math.max(1, workers);
    report(`scan: starting ${workerCount} concurrent workers`);
    await Promise.allSettled(
      Array.from({ length: workerCount }, () => workerLoop()),
    );
    if (loopFailed) throw firstError;

    report(
      stopped
        ? `scan: stopped by request, ${processed} repos processed this run${failed > 0 ? `, ${failed} failed` : ''}`
        : `scan: loop finished, ${processed} repos processed this run`,
    );
    if (failed > 0 && !stopped) {
      throw new Error(`scan: ${failed} of ${processed} repositories failed`);
    }
    return processed;
  }
}
