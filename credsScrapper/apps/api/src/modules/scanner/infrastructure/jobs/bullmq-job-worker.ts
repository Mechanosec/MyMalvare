import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Job, Worker } from 'bullmq';
import { DiscoverReposUseCase } from '../../application/use-cases/discover-repos.use-case';
import { RunScanLoopUseCase } from '../../application/use-cases/run-scan-loop.use-case';
import { ScanRepositoryUseCase } from '../../application/use-cases/scan-repository.use-case';
import { JobQueuePort } from '../../application/ports/job-queue.port';
import { ProgressPort } from '../../application/ports/progress.port';
import { IRepoRef } from '../../domain/types/repo-ref.type';
import { IJobProgressEvent } from '../../domain/types/job-progress-event.type';
import { EJobStatus } from '../../domain/constant/job-status.constant';
import { redisConnection, SCANNER_QUEUE_NAME } from './bullmq-connection';
import { SCAN_WORKER_POOL_SIZE } from '../workers/pool-size';

function buildCloneUrl(ref: IRepoRef): string {
  return `https://github.com/${ref.owner}/${ref.name}.git`;
}

interface IScanRepoJobData {
  readonly repoRef: IRepoRef;
  readonly cloneSource: string;
  readonly workdir: string;
}

interface IScanLoopJobData {
  readonly workdirRoot: string;
  readonly workers?: number;
  readonly maxRepos?: number;
  readonly staleTimeoutSeconds?: number;
}

interface IDiscoverJobData {
  readonly date?: string;
}

@Injectable()
export class BullmqJobWorker implements OnModuleInit, OnModuleDestroy {
  private worker?: Worker;

  constructor(
    private readonly discoverRepos: DiscoverReposUseCase,
    private readonly runScanLoop: RunScanLoopUseCase,
    private readonly scanRepository: ScanRepositoryUseCase,
    private readonly progress: ProgressPort,
    private readonly jobQueue: JobQueuePort,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.start();
  }

  async start(): Promise<void> {
    this.worker = new Worker(SCANNER_QUEUE_NAME, (job) => this.process(job), {
      connection: redisConnection,
      concurrency: SCAN_WORKER_POOL_SIZE,
    });
    this.worker.on('error', (err) => {
      console.error('[BullmqJobWorker] Redis connection error:', err);
    });
  }

  private async process(job: Job): Promise<void> {
    const log: IJobProgressEvent[] = [];
    let processed = 0;
    // Synchronous and fire-and-forget, matching the onProgress contract
    // DiscoverReposUseCase/RunScanLoopUseCase/ScanRepositoryUseCase
    // already take (unchanged by this plan) - job.updateProgress()'s
    // promise isn't awaited here (same as InMemoryJobRunner's equivalent
    // callback wasn't awaited either), but progress.emit() is
    // synchronous, so the WebSocket update still goes out immediately.
    const onProgress = (message: string, newProcessed?: number): void => {
      if (newProcessed !== undefined) {
        processed = newProcessed;
      }
      const event: IJobProgressEvent = {
        jobId: job.id!,
        status: EJobStatus.RUNNING,
        message,
        processed,
      };
      log.push(event);
      void job.updateProgress({ message, processed, log }).catch(() => {});
      this.progress.emit(event);
    };

    const shouldStop = () => this.jobQueue.isStopRequested(job.id!);

    try {
      if (job.name === 'discover') {
        const data = job.data as IDiscoverJobData;
        const date = data.date ? new Date(data.date) : undefined;
        processed = await this.discoverRepos.execute(date, onProgress, shouldStop);
      } else if (job.name === 'scan') {
        const data = job.data as IScanLoopJobData;
        processed = await this.runScanLoop.execute({
          workdirRoot: data.workdirRoot,
          sourceUrlFn: buildCloneUrl,
          workers: data.workers,
          maxRepos: data.maxRepos,
          staleTimeoutSeconds: data.staleTimeoutSeconds,
          onProgress,
          shouldStop,
        });
      } else if (job.name === 'scan-repo') {
        const data = job.data as IScanRepoJobData;
        await this.scanRepository.execute(
          data.repoRef,
          data.cloneSource,
          data.workdir,
          (message) => onProgress(message),
        );
      } else {
        throw new Error(`Unknown job name: ${job.name}`);
      }

      const doneMessage = `${job.name} finished: ${processed} processed`;
      const doneEvent: IJobProgressEvent = {
        jobId: job.id!,
        status: EJobStatus.DONE,
        message: doneMessage,
        processed,
      };
      log.push(doneEvent);
      void job
        .updateProgress({ message: doneMessage, processed, log })
        .catch(() => {});
      this.progress.emit(doneEvent);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const failMessage = `${job.name} failed: ${errorMessage}`;
      const failEvent: IJobProgressEvent = {
        jobId: job.id!,
        status: EJobStatus.FAILED,
        message: failMessage,
        processed,
      };
      log.push(failEvent);
      void job
        .updateProgress({ message: failMessage, processed, log })
        .catch(() => {});
      this.progress.emit(failEvent);
      throw err;
    }
  }

  async close(): Promise<void> {
    await this.worker?.close();
  }

  async onModuleDestroy(): Promise<void> {
    await this.close();
  }
}
