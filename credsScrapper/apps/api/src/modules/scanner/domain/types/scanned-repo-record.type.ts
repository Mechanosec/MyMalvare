import { EScanStatus } from '../constant/scan-status.constant';

export interface IScannedRepoRecord {
  readonly repoId: number;
  readonly owner: string;
  readonly name: string;
  readonly status: EScanStatus;
  readonly lastCommitSha: string | null;
  readonly startedAt: Date | null;
  readonly scannedAt: Date | null;
  readonly failReason: string | null;
  readonly retryCount: number;
  readonly findingsCount: number;
}
