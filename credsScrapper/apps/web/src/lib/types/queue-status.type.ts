import { EScanStatus } from '../constant/scan-status.constant';

// Mirrors apps/api's IQueueStatus.
export interface IQueueStatus {
  readonly pendingCandidates: number;
  readonly scannedByStatus: Readonly<Partial<Record<EScanStatus, number>>>;
}
