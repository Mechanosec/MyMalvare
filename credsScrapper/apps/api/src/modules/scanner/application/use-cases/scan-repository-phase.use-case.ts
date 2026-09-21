import { EScanPhase } from '../../domain/constant/scan-phase.constant';
import { IFindingInput } from '../../domain/types/finding-record.type';
import { IRepoRef } from '../../domain/types/repo-ref.type';
import { HeadScanWorkerPort } from '../ports/head-scan-worker.port';
import { HistoryScanWorkerPort } from '../ports/history-scan-worker.port';
import { LoggerPort } from '../ports/logger.port';
import { ScanCachePort } from '../ports/scan-cache.port';
import { StateRepositoryPort } from '../ports/state-repository.port';
import { WorkdirCleanerPort } from '../ports/workdir-cleaner.port';
import {
  HEAD_SCAN_BUDGET,
  HISTORY_SCAN_BUDGET,
} from '../types/scan-budget.type';
import { TScanJobResult } from './run-scan-job.use-case';

export interface IScanRepositoryPhaseOptions {
  readonly repoRef: IRepoRef;
  readonly phase: EScanPhase;
  readonly cloneSource: string;
  readonly workdir: string;
  readonly targetSha?: string;
  readonly signal?: AbortSignal;
  readonly onProgress?: (message: string) => void;
}

export class ScanRepositoryPhaseUseCase {
  private readonly active = new Map<string, Promise<TScanJobResult>>();

  constructor(
    private readonly headWorker: HeadScanWorkerPort,
    private readonly historyWorker: HistoryScanWorkerPort,
    private readonly state: StateRepositoryPort,
    private readonly logger: LoggerPort,
    private readonly cleaner: WorkdirCleanerPort,
    private readonly cache: ScanCachePort,
  ) {}

  async execute(options: IScanRepositoryPhaseOptions): Promise<TScanJobResult> {
    const key = `${options.repoRef.repoId}:${options.phase}`;
    const existing = this.active.get(key);
    if (existing) return existing;
    const pending = this.run(options);
    this.active.set(key, pending);
    try {
      return await pending;
    } finally {
      this.active.delete(key);
    }
  }

  private async run(
    options: IScanRepositoryPhaseOptions,
  ): Promise<TScanJobResult> {
    const requestedTarget = options.targetSha ?? 'latest';
    const current = await this.state.getPhase(
      options.repoRef.repoId,
      options.phase,
    );
    if (
      current?.status === 'done' &&
      options.phase === EScanPhase.HISTORY &&
      current.completedSha === requestedTarget
    ) {
      return {
        status: 'done',
        headSha: requestedTarget,
        targetSha: requestedTarget,
      };
    }
    if (
      current?.status !== 'pending' ||
      current.targetSha !== requestedTarget
    ) {
      await this.state.schedulePhase(
        options.repoRef.repoId,
        options.phase,
        requestedTarget,
      );
    }
    if (
      !(await this.state.claimPhase(
        options.repoRef.repoId,
        options.phase,
        requestedTarget,
      ))
    ) {
      return {
        status: 'failed',
        failReason: 'scan_phase_already_claimed',
        targetSha: requestedTarget,
      };
    }

    const findings: IFindingInput[] = [];
    let lease: Awaited<ReturnType<ScanCachePort['acquire']>> | undefined;
    try {
      lease = await this.cache.acquire(
        options.workdir,
        options.cloneSource,
        options.phase,
      );
      const checkpoint =
        options.phase === EScanPhase.HISTORY &&
        current?.completedSha &&
        current.scannerVersion
          ? {
              headSha: current.completedSha,
              scannerVersion: current.scannerVersion,
            }
          : undefined;
      const worker =
        options.phase === EScanPhase.HEAD
          ? this.headWorker
          : this.historyWorker;
      const result = await worker.run(
        options.repoRef,
        options.cloneSource,
        lease.repoPath,
        (event) => {
          if (event.type === 'progress') {
            this.logger.log(event.message);
            options.onProgress?.(event.message);
          } else {
            findings.push({
              filePath: event.filePath,
              commitSha: event.commitSha,
              commitShas: event.commitShas,
              secretType: event.finding.secretType,
              secretValue: event.finding.secretValue,
              lineNumber: event.finding.lineNumber,
              context: event.finding.context,
            });
          }
        },
        {
          phase: options.phase,
          targetSha: options.targetSha,
          checkpoint,
          scannerVersion: lease.scannerVersion,
          budget:
            options.phase === EScanPhase.HEAD
              ? HEAD_SCAN_BUDGET
              : HISTORY_SCAN_BUDGET,
          signal: options.signal ?? new AbortController().signal,
        },
      );
      await this.state.addFindings(
        options.repoRef.repoId,
        options.repoRef.owner,
        options.repoRef.name,
        findings,
      );

      const targetSha =
        result.targetSha ?? options.targetSha ?? requestedTarget;
      if (result.status === 'done') {
        await this.state.markPhaseDone(options.repoRef.repoId, options.phase, {
          targetSha,
          completedSha: result.headSha,
          scannerVersion: lease.scannerVersion,
        });
        if (options.phase === EScanPhase.HEAD) {
          await this.state.schedulePhase(
            options.repoRef.repoId,
            EScanPhase.HISTORY,
            result.headSha,
          );
        }
      } else if (result.status === 'incomplete') {
        await this.state.markPhaseIncomplete(
          options.repoRef.repoId,
          options.phase,
          {
            targetSha,
            reason: result.failReason,
          },
        );
      } else if (result.status === 'cancelled') {
        await this.state.markPhaseCancelled(
          options.repoRef.repoId,
          options.phase,
          {
            targetSha,
            reason: result.failReason,
          },
        );
      } else {
        await this.state.markPhaseFailed(
          options.repoRef.repoId,
          options.phase,
          {
            targetSha,
            reason: result.failReason,
          },
        );
      }
      return result;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await this.state.markPhaseFailed(options.repoRef.repoId, options.phase, {
        targetSha: requestedTarget,
        reason,
      });
      return {
        status: 'failed',
        failReason: reason,
        targetSha: requestedTarget,
      };
    } finally {
      if (lease) await lease.release();
      else await this.cleaner.remove(options.workdir);
    }
  }
}
