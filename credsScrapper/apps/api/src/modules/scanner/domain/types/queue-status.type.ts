import { EScanStatus } from '../constant/scan-status.constant';
import { IScanRuntime } from './scan-control.type';

export interface IQueueStatus {
  readonly pendingCandidates: number;
  readonly scannedByStatus: Readonly<Partial<Record<EScanStatus, number>>>;
}

export interface IScanStatus extends IQueueStatus {
  readonly runtime: IScanRuntime;
}
