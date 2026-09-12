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
      const result = await this.scanWorker.run(
        repoRef,
        cloneSource,
        workdir,
        (event) => {
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
        },
      );
      await pendingWrites;

      if (result.status === 'done') {
        await this.state.markDone(repoRef.repoId, result.headSha);
      } else {
        await this.state.markFailed(repoRef.repoId, result.failReason);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `scan: ${repoRef.owner}/${repoRef.name} - failed: ${message}`,
      );
      onProgress?.(`scan: ${repoRef.owner}/${repoRef.name} - failed: ${message}`);
      await this.state.markFailed(repoRef.repoId, message);
    } finally {
      await this.workdirCleaner.remove(workdir);
    }
  }
}
