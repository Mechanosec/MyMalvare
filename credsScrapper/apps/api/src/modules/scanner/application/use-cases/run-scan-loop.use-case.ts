import { IRepoRef } from '../../domain/types/repo-ref.type';
import { LoggerPort } from '../ports/logger.port';
import { StateRepositoryPort } from '../ports/state-repository.port';
import { WorkdirJoinerPort } from '../ports/workdir-joiner.port';
import { ScanRepositoryUseCase } from './scan-repository.use-case';

export interface RunScanLoopOptions {
  readonly workdirRoot: string;
  readonly sourceUrlFn: (ref: IRepoRef) => string;
  readonly staleTimeoutSeconds?: number;
  readonly maxRetries?: number;
  readonly maxRepos?: number;
  readonly workers?: number;
  readonly onProgress?: (message: string, processed: number) => void;
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
  ) {}

  async execute(options: RunScanLoopOptions): Promise<number> {
    const {
      workdirRoot,
      sourceUrlFn,
      staleTimeoutSeconds = 3600,
      maxRetries = 3,
      maxRepos,
      workers = 1,
      onProgress,
    } = options;

    let processed = 0;
    const report = (message: string) => {
      this.logger.log(message);
      onProgress?.(message, processed);
    };

    const requeued = await this.state.requeueStale(staleTimeoutSeconds);
    if (requeued > 0) {
      report(`scan: requeued ${requeued} stale in-progress repos`);
    }
    const requeuedFailed = await this.state.requeueFailed(maxRetries);
    if (requeuedFailed > 0) {
      report(`scan: requeued ${requeuedFailed} failed repos for retry (max ${maxRetries} attempts)`);
    }
    await this.workdirJoiner.ensureDir(workdirRoot);

    let reserved = 0;

    const workerLoop = async (): Promise<void> => {
      for (;;) {
        if (maxRepos !== undefined && reserved >= maxRepos) {
          return;
        }
        reserved += 1;
        const ref: IRepoRef | null = await this.state.claimNext();
        if (ref === null) {
          reserved -= 1;
          return;
        }
        const workdir = this.workdirJoiner.join(workdirRoot, `repo-${ref.repoId}`);
        // scanRepository reports its own per-repo progress (cloning,
        // cloned, working tree done, done/failed) through this same
        // onProgress channel, tagged with the count completed so far -
        // without this, the UI only ever saw "processed N" once per
        // whole repo, which looked idle during a slow clone/scan.
        await this.scanRepository.execute(ref, sourceUrlFn(ref), workdir, (message) =>
          onProgress?.(message, processed),
        );
        processed += 1;
        onProgress?.(`scan: ${processed} repos processed so far`, processed);
      }
    };

    const workerCount = Math.max(1, workers);
    report(`scan: starting ${workerCount} concurrent workers`);
    await Promise.all(Array.from({ length: workerCount }, () => workerLoop()));

    report(`scan: loop finished, ${processed} repos processed this run`);
    return processed;
  }
}
