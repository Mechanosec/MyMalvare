import { EJobStatus } from '../constant/job-status.constant';

// Mirrors apps/api's IJobProgressEvent and IJobState (GET /jobs/:id shares
// the same fields plus a few timestamps the UI doesn't need).
export interface IJobProgressEvent {
  readonly jobId: string;
  readonly status: EJobStatus;
  readonly message: string;
  readonly processed?: number;
}

export interface IJobState {
  readonly id: string;
  readonly status: EJobStatus;
  readonly processed: number;
  readonly message: string;
  readonly error?: string;
}
