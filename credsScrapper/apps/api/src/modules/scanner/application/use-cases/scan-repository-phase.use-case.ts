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
  readonly scanEpoch?: number;
  readonly shouldStop?: () => Promise<boolean>;
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
    const key = `${options.repoRef.repoId}:${options.phase}:${options.scanEpoch ?? 0}`;
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
    const scanEpoch = options.scanEpoch ?? 0;
    let stopCheckFailed = false;
    const isStopped = async (): Promise<boolean> => {
      try {
        const requested = (await options.shouldStop?.()) ?? false;
        return requested || options.signal?.aborted === true;
      } catch (error) {
        stopCheckFailed = true;
        throw error;
      }
    };
    const cancelled = (): TScanJobResult => ({
      status: 'cancelled',
      failReason: 'scan_cancelled',
      targetSha: requestedTarget,
    });
    if (await isStopped()) return cancelled();
    const current = await this.state.getPhase(
      options.repoRef.repoId,
      options.phase,
    );
    if (
      current?.status === 'done' &&
      current.scanEpoch === scanEpoch &&
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
      current.targetSha !== requestedTarget ||
      current.scanEpoch !== scanEpoch
    ) {
      await this.state.schedulePhase(
        options.repoRef.repoId,
        options.phase,
        requestedTarget,
        scanEpoch,
      );
    }
    if (await isStopped()) return cancelled();
    if (
      !(await this.state.claimPhase(
        options.repoRef.repoId,
        options.phase,
        requestedTarget,
        scanEpoch,
      ))
    ) {
      if (await isStopped()) return cancelled();
      return {
        status: 'failed',
        failReason: 'scan_phase_already_claimed',
        targetSha: requestedTarget,
      };
    }

    if (await isStopped()) {
      await this.state.markPhaseCancelled(
        options.repoRef.repoId,
        options.phase,
        {
          targetSha: requestedTarget,
          reason: 'scan_cancelled',
          scanEpoch,
        },
      );
      return cancelled();
    }

    const findings: IFindingInput[] = [];
    let lease: Awaited<ReturnType<ScanCachePort['acquire']>> | undefined;
    try {
      lease = await this.cache.acquire(
        options.workdir,
        options.cloneSource,
        options.phase,
      );
      if (await isStopped()) {
        await this.state.markPhaseCancelled(
          options.repoRef.repoId,
          options.phase,
          {
            targetSha: requestedTarget,
            reason: 'scan_cancelled',
            scanEpoch,
          },
        );
        return cancelled();
      }
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
          scanEpoch,
        });
        if (options.phase === EScanPhase.HEAD && !(await isStopped())) {
          await this.state.schedulePhase(
            options.repoRef.repoId,
            EScanPhase.HISTORY,
            result.headSha,
            scanEpoch,
          );
        }
      } else if (result.status === 'incomplete') {
        await this.state.markPhaseIncomplete(
          options.repoRef.repoId,
          options.phase,
          {
            targetSha,
            reason: result.failReason,
            scanEpoch,
          },
        );
      } else if (result.status === 'cancelled') {
        await this.state.markPhaseCancelled(
          options.repoRef.repoId,
          options.phase,
          {
            targetSha,
            reason: result.failReason,
            scanEpoch,
          },
        );
      } else {
        await this.state.markPhaseFailed(
          options.repoRef.repoId,
          options.phase,
          {
            targetSha,
            reason: result.failReason,
            scanEpoch,
          },
        );
      }
      return result;
    } catch (error) {
      if (stopCheckFailed) throw error;
      const reason = error instanceof Error ? error.message : String(error);
      await this.state.markPhaseFailed(options.repoRef.repoId, options.phase, {
        targetSha: requestedTarget,
        reason,
        scanEpoch,
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
