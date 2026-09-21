import { EScanStatus } from "../constant/scan-status.constant";

export interface IScanPhase {
  readonly status:
    "pending" | "running" | "done" | "incomplete" | "failed" | "cancelled";
  readonly targetSha: string | null;
  readonly completedSha: string | null;
  readonly reason: string | null;
}

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
  readonly headPhase?: IScanPhase | null;
  readonly historyPhase?: IScanPhase | null;
}
