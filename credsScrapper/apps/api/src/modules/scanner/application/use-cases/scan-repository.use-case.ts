import { IFindingInput } from '../../domain/types/finding-record.type';
import { IRepoRef } from '../../domain/types/repo-ref.type';
import { TScanJobResult } from './run-scan-job.use-case';
import { ScanWorkerPort } from '../ports/scan-worker.port';
import { LoggerPort } from '../ports/logger.port';
import { StateRepositoryPort } from '../ports/state-repository.port';
import { WorkdirCleanerPort } from '../ports/workdir-cleaner.port';
import { ScanCachePort } from '../ports/scan-cache.port';

// The CPU-heavy work (clone, diff parsing, secret detection) now runs in
// a worker thread behind ScanWorkerPort (see RunScanJobUseCase /
// infrastructure/workers) - this class is the main-thread orchestrator:
// clean the workdir, dispatch, persist whatever comes back, clean again.
export class ScanRepositoryUseCase {
  // All scan entry points share this singleton in the current single-process
  // deployment. Concurrent jobs for a repo join its existing scan, so they
  // cannot remove one another's workdir or race writes to its findings.
  private readonly active = new Map<number, Promise<TScanJobResult>>();
  constructor(
    private readonly scanWorker: ScanWorkerPort,
    private readonly state: StateRepositoryPort,
    private readonly logger: LoggerPort,
    private readonly workdirCleaner: WorkdirCleanerPort,
    private readonly cache?: ScanCachePort,
  ) {}

  async execute(
    repoRef: IRepoRef,
    cloneSource: string,
    workdir: string,
    onProgress?: (message: string) => void,
  ): Promise<TScanJobResult> {
    const existing = this.active.get(repoRef.repoId);
    if (existing) {
      onProgress?.(
        `scan: ${repoRef.owner}/${repoRef.name} - joining active scan`,
      );
      return existing;
    }
    const pending = this.scan(repoRef, cloneSource, workdir, onProgress);
    this.active.set(repoRef.repoId, pending);
    try {
      return await pending;
    } finally {
      this.active.delete(repoRef.repoId);
    }
  }

  private async scan(
    repoRef: IRepoRef,
    cloneSource: string,
    workdir: string,
    onProgress?: (message: string) => void,
  ): Promise<TScanJobResult> {
    const collectedFindings: IFindingInput[] = [];
    let lease: Awaited<ReturnType<ScanCachePort['acquire']>> | undefined;
    try {
      if (this.cache) lease = await this.cache.acquire(workdir, cloneSource);
      else await this.workdirCleaner.remove(workdir);
      const checkpoint = lease
        ? await this.state.getScanCheckpoint(repoRef.repoId)
        : null;
      const result = await this.scanWorker.run(
        repoRef,
        cloneSource,
        lease?.repoPath ?? workdir,
        (event) => {
          if (event.type === 'progress') {
            this.logger.log(event.message);
            onProgress?.(event.message);
            return;
          }
          collectedFindings.push({
            filePath: event.filePath,
            commitSha: event.commitSha,
            commitShas: event.commitShas,
            secretType: event.finding.secretType,
            secretValue: event.finding.secretValue,
            lineNumber: event.finding.lineNumber,
            context: event.finding.context,
          });
        },
        lease
          ? {
              reuseGit: true,
              scannerVersion: lease.scannerVersion,
              checkpoint: checkpoint ?? undefined,
            }
          : undefined,
      );
      // One batch write for everything the scan found, instead of one
      // findFirst+create round-trip per finding - a noisy repo's history
      // can produce hundreds of thousands of findings, and persisting
      // those one at a time was taking minutes after the scan itself had
      // already finished.
      await this.state.addFindings(
        repoRef.repoId,
        repoRef.owner,
        repoRef.name,
        collectedFindings,
      );

      if (result.status === 'done') {
        // Only acknowledge the checkpoint AFTER every finding was persisted.
        // A failed/partial write is retried from the preceding checkpoint.
        await this.state.markDone(
          repoRef.repoId,
          result.headSha,
          lease?.scannerVersion,
        );
      } else {
        await this.state.markFailed(repoRef.repoId, result.failReason);
      }
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `scan: ${repoRef.owner}/${repoRef.name} - failed: ${message}`,
      );
      onProgress?.(
        `scan: ${repoRef.owner}/${repoRef.name} - failed: ${message}`,
      );
      // A lock conflict belongs to this job, not the other process's active scan.
      if (!this.cache || lease)
        await this.state.markFailed(repoRef.repoId, message);
      return { status: 'failed', failReason: message };
    } finally {
      if (lease) await lease.release();
      else if (!this.cache) await this.workdirCleaner.remove(workdir);
    }
  }
}
