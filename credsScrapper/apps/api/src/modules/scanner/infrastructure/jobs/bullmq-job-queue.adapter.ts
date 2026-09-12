import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import { JobQueuePort } from '../../application/ports/job-queue.port';
import {
  EJobStatus,
  EJobType,
} from '../../domain/constant/job-status.constant';
import { IJobState } from '../../domain/types/job-state.type';
import { IJobProgressEvent } from '../../domain/types/job-progress-event.type';
import { redisConnection, SCANNER_QUEUE_NAME } from './bullmq-connection';

// BullMQ job names double as the type tag this app already used
// (EJobType) for 'discover' and the admin bulk 'scan' loop; a
// user-triggered single-repo scan (ScanMyRepoUseCase, see
// bullmq-job-worker.ts) uses the job name 'scan-repo' for routing but is
// still reported as EJobType.SCAN here, since nothing downstream
// distinguishes the two once a job is running.
function jobNameToType(name: string): EJobType {
  return name === 'discover' ? EJobType.DISCOVER : EJobType.SCAN;
}

interface IJobProgressData {
  readonly message: string;
  readonly processed?: number;
  readonly log: IJobProgressEvent[];
}

function isJobProgressData(value: unknown): value is IJobProgressData {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as IJobProgressData).log)
  );
}

@Injectable()
export class BullmqJobQueueAdapter
  extends JobQueuePort
  implements OnModuleDestroy
{
  private readonly queue = new Queue(SCANNER_QUEUE_NAME, {
    connection: redisConnection,
  });

  async enqueue(type: string, payload: unknown): Promise<string> {
    const job = await this.queue.add(type, payload);
    if (!job.id) {
      throw new Error('BullMQ did not assign a job id');
    }
    return job.id;
  }

  async getJob(jobId: string): Promise<IJobState | null> {
    const job = await this.queue.getJob(jobId);
    if (!job) {
      return null;
    }
    const state = await job.getState();
    const progress = isJobProgressData(job.progress)
      ? job.progress
      : { message: `${job.name} queued`, log: [] };

    return {
      id: jobId,
      type: jobNameToType(job.name),
      status: this.mapStatus(state),
      processed: progress.processed ?? 0,
      message: progress.message,
      startedAt: new Date(job.timestamp),
      finishedAt: job.finishedOn ? new Date(job.finishedOn) : undefined,
      error: job.failedReason,
      log: progress.log,
    };
  }

  private mapStatus(bullState: string): EJobStatus {
    switch (bullState) {
      case 'completed':
        return EJobStatus.DONE;
      case 'failed':
        return EJobStatus.FAILED;
      case 'active':
        return EJobStatus.RUNNING;
      default:
        // 'waiting', 'delayed', 'waiting-children', 'prioritized', etc.
        return EJobStatus.QUEUED;
    }
  }

  async close(): Promise<void> {
    await this.queue.close();
  }

  async onModuleDestroy(): Promise<void> {
    await this.close();
  }
}
