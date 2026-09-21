import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { JobQueuePort } from '../../application/ports/job-queue.port';
import {
  EJobStatus,
  EJobType,
} from '../../domain/constant/job-status.constant';
import { IJobState } from '../../domain/types/job-state.type';
import { IJobProgressEvent } from '../../domain/types/job-progress-event.type';
import { redisConnection, SCANNER_QUEUE_NAME } from './bullmq-connection';
import { HEAD_QUEUE, HISTORY_QUEUE } from './bullmq-connection';
import { EScanPhase } from '../../domain/constant/scan-phase.constant';
import { IRepoRef } from '../../domain/types/repo-ref.type';

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
  private readonly headQueue = new Queue(HEAD_QUEUE, {
    connection: redisConnection,
  });
  private readonly historyQueue = new Queue(HISTORY_QUEUE, {
    connection: redisConnection,
  });
  private readonly redis = new Redis(redisConnection.url, {
    maxRetriesPerRequest: null,
  });

  // Keep the local Set for the common single-process path and mirror requests
  // to Redis so control, HEAD, and history workers also observe them when the
  // deployment is split across processes.
  private readonly stopRequests = new Set<string>();

  constructor() {
    super();
    this.queue.on('error', (err) => {
      console.error('[BullmqJobQueueAdapter] Redis connection error:', err);
    });
  }

  async enqueue(type: string, payload: unknown): Promise<string> {
    const job = await this.queue.add(type, payload);
    if (!job.id) {
      throw new Error('BullMQ did not assign a job id');
    }
    return job.id;
  }

  async enqueuePhase(
    phase: EScanPhase,
    repoRef: IRepoRef,
    targetSha: string,
    payload: unknown,
  ): Promise<string> {
    const queue =
      phase === EScanPhase.HEAD ? this.headQueue : this.historyQueue;
    const id = `${repoRef.repoId}-${targetSha}`;
    const existing = await queue.getJob(id);
    if (existing) {
      const state = await existing.getState();
      if (state === 'completed' || state === 'failed') await existing.remove();
    }
    const job = await queue.add(phase, payload, {
      jobId: id,
      removeOnComplete: { age: 3600, count: 1000 },
      removeOnFail: { age: 86400, count: 1000 },
    });
    if (!job.id) throw new Error('BullMQ did not assign a phase job id');
    return `${phase}:${job.id}`;
  }

  async getJob(jobId: string): Promise<IJobState | null> {
    const { queue, internalId } = this.resolveJob(jobId);
    const job = await queue.getJob(internalId);
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

  async requestStop(jobId: string): Promise<void> {
    this.stopRequests.add(jobId);
    await this.redis.set(`scanner:stop:${jobId}`, '1', 'EX', 86400);
  }

  async isStopRequested(jobId: string): Promise<boolean> {
    if (this.stopRequests.has(jobId)) return true;
    return (await this.redis.get(`scanner:stop:${jobId}`)) === '1';
  }

  private resolveJob(jobId: string): { queue: Queue; internalId: string } {
    const separator = jobId.indexOf(':');
    if (separator < 0) return { queue: this.queue, internalId: jobId };
    const prefix = jobId.slice(0, separator);
    const internalId = jobId.slice(separator + 1);
    if (prefix === EScanPhase.HEAD)
      return { queue: this.headQueue, internalId };
    if (prefix === EScanPhase.HISTORY)
      return { queue: this.historyQueue, internalId };
    throw new Error(`Unknown job prefix: ${prefix}`);
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
    await Promise.all([
      this.queue.close(),
      this.headQueue.close(),
      this.historyQueue.close(),
      this.redis.quit(),
    ]);
  }

  async onModuleDestroy(): Promise<void> {
    await this.close();
  }
}
