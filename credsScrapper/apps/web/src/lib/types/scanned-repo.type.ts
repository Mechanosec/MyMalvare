import { EScanStatus } from '../constant/scan-status.constant';

export interface IScannedRepo {
  readonly repoId: number;
  readonly owner: string;
  readonly name: string;
  readonly status: EScanStatus;
  readonly lastCommitSha: string | null;
  readonly startedAt: string | null;
  readonly scannedAt: string | null;
  readonly failReason: string | null;
  readonly retryCount: number;
  readonly findingsCount: number;
}
