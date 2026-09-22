import { EScanPhase, EScanPhaseStatus } from '../constant/scan-phase.constant';

export interface IScanPhaseRecord {
  readonly repoId: number;
  readonly phase: EScanPhase;
  readonly status: EScanPhaseStatus;
  readonly targetSha: string | null;
  readonly completedSha: string | null;
  readonly scannerVersion: string | null;
  readonly startedAt: Date | null;
  readonly completedAt: Date | null;
  readonly reason: string | null;
  readonly retryCount: number;
  readonly scanEpoch: number;
}

export interface ICompletedScanPhase {
  readonly targetSha: string;
  readonly completedSha: string;
  readonly scannerVersion: string;
  readonly scanEpoch?: number;
}

export interface IInterruptedScanPhase {
  readonly targetSha: string;
  readonly reason: string;
  readonly scanEpoch?: number;
}
