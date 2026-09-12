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
  // Every event emitted for this job so far - lets a client that (re)connects
  // after the job already started (e.g. a page reload) replay the full log.
  readonly log: readonly IJobProgressEvent[];
}
