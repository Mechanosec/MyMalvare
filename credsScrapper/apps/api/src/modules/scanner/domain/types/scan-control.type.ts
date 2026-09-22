import { EScanControlState } from '../constant/scan-control.constant';

export interface IScanControlState {
  readonly epoch: number;
  readonly state: EScanControlState;
  readonly stopEpoch: number | null;
  readonly requestedAt: string | null;
  readonly finishedAt: string | null;
}

export interface IScanQueueCounts {
  readonly queued: number;
  readonly active: number;
}

export interface IScanRuntime extends IScanControlState {
  readonly queues: {
    readonly control: IScanQueueCounts;
    readonly head: IScanQueueCounts;
    readonly history: IScanQueueCounts;
  };
}
