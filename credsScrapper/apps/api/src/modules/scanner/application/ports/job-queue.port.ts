import { IJobState } from '../../domain/types/job-state.type';

export abstract class JobQueuePort {
  /** Enqueues a job and returns its id immediately - the caller never waits for it to run. */
  abstract enqueue(type: string, payload: unknown): Promise<string>;

  abstract getJob(jobId: string): Promise<IJobState | null>;
}
