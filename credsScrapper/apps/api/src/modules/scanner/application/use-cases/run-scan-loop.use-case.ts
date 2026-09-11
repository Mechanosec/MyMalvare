import { IRepoRef } from '../../domain/types/repo-ref.type';
import { LoggerPort } from '../ports/logger.port';
import { StateRepositoryPort } from '../ports/state-repository.port';
import { WorkdirJoinerPort } from '../ports/workdir-joiner.port';
import { ScanRepositoryUseCase } from './scan-repository.use-case';

export interface RunScanLoopOptions {
  readonly workdirRoot: string;
  readonly sourceUrlFn: (ref: IRepoRef) => string;
  readonly staleTimeoutSeconds?: number;
  readonly maxRepos?: number;
  readonly workers?: number;
  readonly onProgress?: (processed: number) => void;
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
      maxRepos,
      workers = 1,
      onProgress,
    } = options;

    const requeued = await this.state.requeueStale(staleTimeoutSeconds);
    if (requeued > 0) {
      this.logger.log(`scan: requeued ${requeued} stale in-progress repos`);
    }
    await this.workdirJoiner.ensureDir(workdirRoot);

    let processed = 0;
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
        await this.scanRepository.execute(ref, sourceUrlFn(ref), workdir);
        processed += 1;
        onProgress?.(processed);
      }
    };

    const workerCount = Math.max(1, workers);
    this.logger.log(`scan: starting ${workerCount} concurrent workers`);
    await Promise.all(Array.from({ length: workerCount }, () => workerLoop()));

    this.logger.log(`scan: loop finished, ${processed} repos processed this run`);
    return processed;
  }
}
