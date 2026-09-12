import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ProgressPort } from '../../application/ports/progress.port';
import { EJobStatus, EJobType } from '../../domain/constant/job-status.constant';
import { IJobProgressEvent } from '../../domain/types/job-progress-event.type';

export interface IJobState {
  readonly id: string;
  readonly type: EJobType;
  status: EJobStatus;
  processed: number;
  message: string;
  readonly startedAt: Date;
  finishedAt?: Date;
  error?: string;
  // Every event emitted for this job, in order - lets a client that
  // (re)connects after the job already started (e.g. a page reload)
  // replay the full log instead of only ever seeing events from the
  // moment it happened to be listening.
  readonly log: IJobProgressEvent[];
}

export type TJobTask = (onProgress: (message: string, processed?: number) => void) => Promise<number>;

// No Redis/BullMQ at this scale (per the design spec) - jobs live in a
// Map for the lifetime of the process. A future multi-tenant SaaS would
// need a durable queue; this MVP just needs a UI button not to hang.
@Injectable()
export class InMemoryJobRunner {
  private readonly jobs = new Map<string, IJobState>();

  constructor(private readonly progress: ProgressPort) {}

  start(type: EJobType, task: TJobTask): string {
    const jobId = randomUUID();
    const job: IJobState = {
      id: jobId,
      type,
      status: EJobStatus.RUNNING,
      processed: 0,
      message: `${type} started`,
      startedAt: new Date(),
      log: [],
    };
    this.jobs.set(jobId, job);
    this.emit(job, { jobId, status: EJobStatus.RUNNING, message: job.message });

    task((message, processed) => {
      job.message = message;
      if (processed !== undefined) {
        job.processed = processed;
      }
      this.emit(job, { jobId, status: EJobStatus.RUNNING, message, processed });
    })
      .then((result) => {
        job.status = EJobStatus.DONE;
        job.processed = result;
        job.finishedAt = new Date();
        job.message = `${type} finished: ${result} processed`;
        this.emit(job, { jobId, status: EJobStatus.DONE, message: job.message, processed: result });
      })
      .catch((err: unknown) => {
        job.status = EJobStatus.FAILED;
        job.error = err instanceof Error ? err.message : String(err);
        job.finishedAt = new Date();
        job.message = `${type} failed: ${job.error}`;
        this.emit(job, { jobId, status: EJobStatus.FAILED, message: job.message });
      });

    return jobId;
  }

  get(jobId: string): IJobState | undefined {
    return this.jobs.get(jobId);
  }

  private emit(job: IJobState, event: IJobProgressEvent): void {
    job.log.push(event);
    this.progress.emit(event);
  }
}
