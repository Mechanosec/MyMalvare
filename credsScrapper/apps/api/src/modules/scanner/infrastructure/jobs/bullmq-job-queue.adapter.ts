import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
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
import {
  EScanControlState,
  SCAN_CONTROL_KEY,
} from '../../domain/constant/scan-control.constant';
import {
  IScanControlState,
  IScanQueueCounts,
  IScanRuntime,
} from '../../domain/types/scan-control.type';
import { ScanControlError } from '../../domain/errors/scan-control.error';
import { SCAN_CONTROL_SCRIPT } from './scan-control-script';

const ROOT_SCAN_TYPES = new Set(['scan', 'scan-repo', 'rescan-service']);

function validEpoch(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function scanEpoch(payload: unknown): number {
  if (
    typeof payload !== 'object' ||
    payload === null ||
    !Object.prototype.hasOwnProperty.call(payload, 'scanEpoch')
  ) {
    return 0;
  }
  const value = (payload as { scanEpoch: unknown }).scanEpoch;
  if (!validEpoch(value)) {
    throw new ScanControlError('scan_control_unavailable');
  }
  return value;
}

function parseControl(raw: unknown): IScanControlState {
  let value: unknown = raw;
  try {
    if (typeof value === 'string') value = JSON.parse(value);
  } catch {
    throw new ScanControlError('scan_control_unavailable');
  }
  if (typeof value !== 'object' || value === null) {
    throw new ScanControlError('scan_control_unavailable');
  }
  const control = value as Partial<IScanControlState>;
  const epoch = control.epoch;
  const stopEpoch = control.stopEpoch;
  const validDate = (date: unknown) => {
    if (date === null) return true;
    if (
      typeof date !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(date)
    )
      return false;
    const parsed = new Date(date);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === date;
  };
  if (
    !validEpoch(epoch) ||
    !Object.values(EScanControlState).includes(
      control.state as EScanControlState,
    ) ||
    !(
      stopEpoch === null ||
      (validEpoch(stopEpoch) && stopEpoch > 0 && stopEpoch <= epoch)
    ) ||
    !validDate(control.requestedAt) ||
    !validDate(control.finishedAt) ||
    (control.state === EScanControlState.STOPPING &&
      (stopEpoch !== epoch ||
        control.requestedAt === null ||
        control.finishedAt !== null)) ||
    (control.state === EScanControlState.STOPPED &&
      (stopEpoch !== epoch ||
        control.requestedAt === null ||
        control.finishedAt === null)) ||
    (control.state === EScanControlState.READY &&
      ((stopEpoch === null &&
        (control.requestedAt !== null || control.finishedAt !== null)) ||
        (stopEpoch !== null &&
          (control.requestedAt === null || control.finishedAt === null))))
  ) {
    throw new ScanControlError('scan_control_unavailable');
  }
  return control as IScanControlState;
}

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
  readonly outcome?: EJobStatus;
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
    maxRetriesPerRequest: 1,
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
    let jobPayload = payload;
    if (ROOT_SCAN_TYPES.has(type)) {
      const epoch = await this.transition('admit');
      if (!validEpoch(Number(epoch))) {
        throw new ScanControlError('scan_control_unavailable');
      }
      jobPayload = { ...(payload as object), scanEpoch: Number(epoch) };
    }
    const job = await this.queue.add(type, jobPayload);
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
    const id = `${scanEpoch(payload)}-${repoRef.repoId}-${targetSha}`;
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
    const progress: IJobProgressData = isJobProgressData(job.progress)
      ? job.progress
      : { message: `${job.name} queued`, log: [] };

    let status = this.mapStatus(state);
    let message = progress.message;
    if (
      ROOT_SCAN_TYPES.has(job.name) ||
      job.name === EScanPhase.HEAD ||
      job.name === EScanPhase.HISTORY
    ) {
      if (state === 'completed') {
        status =
          progress.outcome === EJobStatus.STOPPED
            ? EJobStatus.STOPPED
            : EJobStatus.DONE;
      } else if (state !== 'failed') {
        const control = await this.readScanControl();
        if (
          control.state !== EScanControlState.READY ||
          scanEpoch(job.data) !== control.epoch
        ) {
          status =
            state === 'active' ? EJobStatus.STOPPING : EJobStatus.STOPPED;
          message =
            status === EJobStatus.STOPPING ? 'Scan stopping' : 'Scan stopped';
        }
      }
    }

    return {
      id: jobId,
      type: jobNameToType(job.name),
      status,
      processed: progress.processed ?? 0,
      message,
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

  async readScanControl(): Promise<IScanControlState> {
    try {
      return parseControl(await this.redis.get(SCAN_CONTROL_KEY));
    } catch {
      throw new ScanControlError('scan_control_unavailable');
    }
  }

  async requestStopAllScans(): Promise<IScanControlState> {
    return parseControl(
      await this.transition('stop', new Date().toISOString()),
    );
  }

  async completeScanStop(epoch: number): Promise<boolean> {
    if (!validEpoch(epoch)) return false;
    return (
      (await this.transition(
        'finish',
        String(epoch),
        new Date().toISOString(),
      )) === 1
    );
  }

  async hasActiveScansBefore(epoch: number): Promise<boolean> {
    try {
      await this.readScanControl();
      const groups = await Promise.all([
        this.allJobs(this.queue, ['active']),
        this.allJobs(this.headQueue, ['active']),
        this.allJobs(this.historyQueue, ['active']),
      ]);
      return groups.some((jobs, group) =>
        jobs.some(
          (job) =>
            (group !== 0 || ROOT_SCAN_TYPES.has(job.name)) &&
            scanEpoch(job.data) < epoch,
        ),
      );
    } catch {
      throw new ScanControlError('scan_control_unavailable');
    }
  }

  async hasOtherActiveScanForRepo(
    repoId: number,
    currentJobId: string,
    currentTimestamp: number,
  ): Promise<boolean> {
    try {
      if (!Number.isSafeInteger(currentTimestamp) || currentTimestamp < 0)
        throw new ScanControlError('scan_control_unavailable');
      const [control, head, history] = await Promise.all([
        this.allJobs(this.queue, ['active']),
        this.allJobs(this.headQueue, ['active']),
        this.allJobs(this.historyQueue, ['active']),
      ]);
      const sameRepo = (job: Job) => {
        const candidate = (job.data as { repoRef?: { repoId?: unknown } })
          ?.repoRef?.repoId;
        if (!Number.isSafeInteger(candidate))
          throw new ScanControlError('scan_control_unavailable');
        return candidate === repoId;
      };
      const olderRoot = (job: Job) => {
        if (
          !Number.isSafeInteger(job.timestamp) ||
          job.timestamp < 0 ||
          !job.id
        )
          throw new ScanControlError('scan_control_unavailable');
        if (job.timestamp !== currentTimestamp)
          return job.timestamp < currentTimestamp;
        const numericPeer = /^\d+$/.test(job.id);
        const numericCurrent = /^\d+$/.test(currentJobId);
        if (numericPeer && numericCurrent)
          return BigInt(job.id) < BigInt(currentJobId);
        if (!numericPeer && !numericCurrent) return job.id < currentJobId;
        return true; // Mixed ID formats have no safe ordering at equal timestamps.
      };
      return (
        control.some(
          (job) =>
            job.id !== currentJobId &&
            (job.name === 'scan' ||
              (job.name === 'rescan-service' && sameRepo(job)) ||
              (job.name === 'scan-repo' && sameRepo(job) && olderRoot(job))),
        ) ||
        head.some((job) => job.name === EScanPhase.HEAD && sameRepo(job)) ||
        history.some((job) => job.name === EScanPhase.HISTORY && sameRepo(job))
      );
    } catch {
      throw new ScanControlError('scan_control_unavailable');
    }
  }

  async getScanRuntime(): Promise<IScanRuntime> {
    try {
      const control = await this.readScanControl();
      const counts = await Promise.all([
        this.queueCounts(this.queue, control, true),
        this.queueCounts(this.headQueue, control, false),
        this.queueCounts(this.historyQueue, control, false),
      ]);
      return {
        ...control,
        queues: { control: counts[0], head: counts[1], history: counts[2] },
      };
    } catch {
      throw new ScanControlError('scan_control_unavailable');
    }
  }

  private async queueCounts(
    queue: Queue,
    control: IScanControlState,
    rootsOnly: boolean,
  ): Promise<IScanQueueCounts> {
    const [queued, active] = await Promise.all([
      this.allJobs(queue, [
        'waiting',
        'delayed',
        'waiting-children',
        'prioritized',
      ]),
      this.allJobs(queue, ['active']),
    ]);
    const isScan = (job: Job) => !rootsOnly || ROOT_SCAN_TYPES.has(job.name);
    const allowed = (job: Job) => {
      if (!isScan(job)) return false;
      const epoch = scanEpoch(job.data);
      return (
        control.state === EScanControlState.READY && epoch === control.epoch
      );
    };
    return {
      queued: queued.filter(allowed).length,
      active: active.filter((job) => {
        if (!isScan(job)) return false;
        scanEpoch(job.data);
        return true;
      }).length,
    };
  }

  private async allJobs(
    queue: Queue,
    states: Parameters<Queue['getJobs']>[0],
  ): Promise<Job[]> {
    const jobs: Job[] = [];
    for (let start = 0; ; start += 100) {
      const page = await queue.getJobs(states, start, start + 99);
      jobs.push(...page);
      if (page.length < 100) return jobs;
    }
  }

  private async transition(
    operation: string,
    ...args: string[]
  ): Promise<unknown> {
    try {
      return await this.redis.eval(
        SCAN_CONTROL_SCRIPT,
        1,
        SCAN_CONTROL_KEY,
        operation,
        ...args,
      );
    } catch (error) {
      if (error instanceof Error && error.message.includes('scan_stopping')) {
        throw new ScanControlError('scan_stopping');
      }
      throw new ScanControlError('scan_control_unavailable');
    }
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
