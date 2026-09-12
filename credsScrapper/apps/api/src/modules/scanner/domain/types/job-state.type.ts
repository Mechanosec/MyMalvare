import { EJobStatus, EJobType } from '../constant/job-status.constant';
import { IJobProgressEvent } from './job-progress-event.type';

export interface IJobState {
  readonly id: string;
  readonly type: EJobType;
  readonly status: EJobStatus;
  readonly processed: number;
  readonly message: string;
  readonly startedAt: Date;
  readonly finishedAt?: Date;
  readonly error?: string;
  readonly log: readonly IJobProgressEvent[];
}
