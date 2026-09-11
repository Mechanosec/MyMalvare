import { EJobStatus } from '../constant/job-status.constant';

export interface IJobProgressEvent {
  readonly jobId: string;
  readonly status: EJobStatus;
  readonly message: string;
  readonly processed?: number;
}
