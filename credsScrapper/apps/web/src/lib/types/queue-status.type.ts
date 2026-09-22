import { EScanStatus } from '../constant/scan-status.constant';
import { IScanRuntime } from './scan-control.type';

// Mirrors apps/api's IQueueStatus.
export interface IQueueStatus {
  readonly pendingCandidates: number;
  readonly scannedByStatus: Readonly<Partial<Record<EScanStatus, number>>>;
  readonly runtime: IScanRuntime;
}
