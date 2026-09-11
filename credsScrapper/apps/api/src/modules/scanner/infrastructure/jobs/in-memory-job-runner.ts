import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ProgressPort } from '../../application/ports/progress.port';
import { EJobStatus, EJobType } from '../../domain/constant/job-status.constant';

export interface IJobState {
  readonly id: string;
  readonly type: EJobType;
  status: EJobStatus;
  processed: number;
  message: string;
  readonly startedAt: Date;
  finishedAt?: Date;
  error?: string;
}

export type TJobTask = (onProgress: (processed: number) => void) => Promise<number>;

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
    };
    this.jobs.set(jobId, job);
    this.progress.emit({ jobId, status: EJobStatus.RUNNING, message: job.message });

    task((processed) => {
      job.processed = processed;
      this.progress.emit({
        jobId,
        status: EJobStatus.RUNNING,
        message: `processed ${processed}`,
        processed,
      });
    })
      .then((result) => {
        job.status = EJobStatus.DONE;
        job.processed = result;
        job.finishedAt = new Date();
        job.message = `${type} finished: ${result} processed`;
        this.progress.emit({
          jobId,
          status: EJobStatus.DONE,
          message: job.message,
          processed: result,
        });
      })
      .catch((err: unknown) => {
        job.status = EJobStatus.FAILED;
        job.error = err instanceof Error ? err.message : String(err);
        job.finishedAt = new Date();
        job.message = `${type} failed: ${job.error}`;
        this.progress.emit({ jobId, status: EJobStatus.FAILED, message: job.message });
      });

    return jobId;
  }

  get(jobId: string): IJobState | undefined {
    return this.jobs.get(jobId);
  }
}
