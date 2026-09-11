import { EScanStatus } from '../constant/scan-status.constant';

export interface IQueueStatus {
  readonly pendingCandidates: number;
  readonly scannedByStatus: Readonly<Partial<Record<EScanStatus, number>>>;
}
