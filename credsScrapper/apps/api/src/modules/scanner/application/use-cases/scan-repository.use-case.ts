import { IFindingInput } from '../../domain/types/finding-record.type';
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
    const collectedFindings: IFindingInput[] = [];

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
          collectedFindings.push({
            filePath: event.filePath,
            commitSha: event.commitSha,
            secretType: event.finding.secretType,
            secretValue: event.finding.secretValue,
            lineNumber: event.finding.lineNumber,
            context: event.finding.context,
          });
        },
      );
      // One batch write for everything the scan found, instead of one
      // findFirst+create round-trip per finding - a noisy repo's history
      // can produce hundreds of thousands of findings, and persisting
      // those one at a time was taking minutes after the scan itself had
      // already finished.
      await this.state.addFindings(repoRef.repoId, repoRef.owner, repoRef.name, collectedFindings);

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
