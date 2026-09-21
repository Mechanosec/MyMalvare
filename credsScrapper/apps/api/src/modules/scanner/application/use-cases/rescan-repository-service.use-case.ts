import { EScanPhase } from '../../domain/constant/scan-phase.constant';
import { ESecretType } from '../../domain/constant/secret-type.constant';
import { IFindingInput } from '../../domain/types/finding-record.type';
import { HeadScanWorkerPort } from '../ports/head-scan-worker.port';
import { HistoryScanWorkerPort } from '../ports/history-scan-worker.port';
import { ScanCachePort } from '../ports/scan-cache.port';
import { StateRepositoryPort } from '../ports/state-repository.port';
import {
  HEAD_SCAN_BUDGET,
  HISTORY_SCAN_BUDGET,
} from '../types/scan-budget.type';
import { IScanRepositoryPhaseOptions } from './scan-repository-phase.use-case';
import { TScanJobResult } from './run-scan-job.use-case';

/** Explicit, authorized passive rescan. Never advances whole-repo coverage. */
export class RescanRepositoryServiceUseCase {
  constructor(
    private readonly head: HeadScanWorkerPort,
    private readonly history: HistoryScanWorkerPort,
    private readonly cache: ScanCachePort,
    private readonly state: StateRepositoryPort,
  ) {}

  async execute(
    options: Omit<IScanRepositoryPhaseOptions, 'phase'> & {
      secretType: ESecretType;
    },
  ): Promise<TScanJobResult> {
    if (!Object.values(ESecretType).includes(options.secretType)) {
      throw new Error('Unsupported rescan secret type');
    }
    const secretTypes = options.secretType.startsWith('aws_')
      ? [ESecretType.AWS_ACCESS_KEY_ID, ESecretType.AWS_SECRET_ACCESS_KEY]
      : [options.secretType];
    let targetSha: string | undefined;
    for (const phase of [EScanPhase.HEAD, EScanPhase.HISTORY]) {
      const lease = await this.cache.acquire(
        options.workdir,
        options.cloneSource,
        phase,
      );
      const findings: IFindingInput[] = [];
      try {
        const result = await (
          phase === EScanPhase.HEAD ? this.head : this.history
        ).run(
          options.repoRef,
          options.cloneSource,
          lease.repoPath,
          (event) => {
            if (event.type === 'progress') options.onProgress?.(event.message);
            else
              findings.push({
                filePath: event.filePath,
                commitSha: event.commitSha,
                commitShas: event.commitShas,
                ...event.finding,
              });
          },
          {
            phase,
            targetSha,
            secretTypes,
            scannerVersion: lease.scannerVersion,
            budget:
              phase === EScanPhase.HEAD
                ? HEAD_SCAN_BUDGET
                : HISTORY_SCAN_BUDGET,
            signal: options.signal ?? new AbortController().signal,
            // Intentionally no checkpoint: updated rules must visit old commits.
          },
        );
        await this.state.addFindings(
          options.repoRef.repoId,
          options.repoRef.owner,
          options.repoRef.name,
          findings,
        );
        if (result.status !== 'done') return result;
        targetSha = result.headSha;
      } finally {
        await lease.release();
      }
    }
    await this.state.resetTestResults(options.repoRef.repoId, secretTypes);
    return { status: 'done', headSha: targetSha!, targetSha };
  }
}
