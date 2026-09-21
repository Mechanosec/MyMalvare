import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { Job, Worker } from 'bullmq';
import { DiscoverReposUseCase } from '../../application/use-cases/discover-repos.use-case';
import { RunScanLoopUseCase } from '../../application/use-cases/run-scan-loop.use-case';
import { ScanRepositoryUseCase } from '../../application/use-cases/scan-repository.use-case';
import { JobQueuePort } from '../../application/ports/job-queue.port';
import { ProgressPort } from '../../application/ports/progress.port';
import { IRepoRef } from '../../domain/types/repo-ref.type';
import { IJobProgressEvent } from '../../domain/types/job-progress-event.type';
import { EJobStatus } from '../../domain/constant/job-status.constant';
import {
  HEAD_QUEUE,
  HISTORY_QUEUE,
  redisConnection,
  SCANNER_QUEUE_NAME,
} from './bullmq-connection';
import { SCAN_WORKER_POOL_SIZE } from '../workers/pool-size';
import { ScanRepositoryPhaseUseCase } from '../../application/use-cases/scan-repository-phase.use-case';
import { EScanPhase } from '../../domain/constant/scan-phase.constant';
import { ReconcileScanPhasesUseCase } from '../../application/use-cases/reconcile-scan-phases.use-case';
import { RescanRepositoryServiceUseCase } from '../../application/use-cases/rescan-repository-service.use-case';
import { ESecretType } from '../../domain/constant/secret-type.constant';

function buildCloneUrl(ref: IRepoRef): string {
  return `https://github.com/${ref.owner}/${ref.name}.git`;
}

interface IScanRepoJobData {
  readonly repoRef: IRepoRef;
  readonly cloneSource: string;
  readonly workdir: string;
  readonly parentJobId?: string;
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
  private headWorker?: Worker;
  private historyWorker?: Worker;

  constructor(
    private readonly discoverRepos: DiscoverReposUseCase,
    private readonly runScanLoop: RunScanLoopUseCase,
    private readonly scanRepository: ScanRepositoryUseCase,
    private readonly progress: ProgressPort,
    private readonly jobQueue: JobQueuePort,
    @Optional()
    private readonly phaseScanner?: ScanRepositoryPhaseUseCase,
    @Optional()
    private readonly reconcilePhases?: ReconcileScanPhasesUseCase,
    @Optional()
    private readonly rescanService?: RescanRepositoryServiceUseCase,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.start();
    if (this.reconcilePhases) {
      await this.reconcilePhases.execute(process.env.SCAN_WORKDIR ?? 'workdir');
    }
  }

  async start(): Promise<void> {
    this.worker = new Worker(SCANNER_QUEUE_NAME, (job) => this.process(job), {
      connection: redisConnection,
      concurrency: SCAN_WORKER_POOL_SIZE,
    });
    this.worker.on('error', (err) => {
      console.error('[BullmqJobWorker] Redis connection error:', err);
    });
    if (this.phaseScanner) {
      this.headWorker = new Worker(
        HEAD_QUEUE,
        (job) => this.processPhase(job, EScanPhase.HEAD),
        { connection: redisConnection, concurrency: 2 },
      );
      this.historyWorker = new Worker(
        HISTORY_QUEUE,
        (job) => this.processPhase(job, EScanPhase.HISTORY),
        { connection: redisConnection, concurrency: 1 },
      );
      this.headWorker.on('error', (err) =>
        console.error('[BullmqHeadWorker] Redis connection error:', err),
      );
      this.historyWorker.on('error', (err) =>
        console.error('[BullmqHistoryWorker] Redis connection error:', err),
      );
    }
  }

  private async processPhase(job: Job, phase: EScanPhase): Promise<void> {
    if (!this.phaseScanner) throw new Error('Phase scanner is unavailable');
    const data = job.data as IScanRepoJobData & { targetSha?: string };
    const publicId = `${phase}:${job.id!}`;
    const abort = new AbortController();
    const timer = setInterval(() => {
      void Promise.all([
        this.jobQueue.isStopRequested(publicId),
        data.parentJobId
          ? this.jobQueue.isStopRequested(data.parentJobId)
          : Promise.resolve(false),
      ]).then(([self, parent]) => {
        if (self || parent) abort.abort();
      });
    }, 500);
    try {
      const result = await this.phaseScanner.execute({
        repoRef: data.repoRef,
        phase,
        cloneSource: data.cloneSource,
        workdir: data.workdir,
        targetSha: data.targetSha,
        signal: abort.signal,
        onProgress: (message) => {
          const event: IJobProgressEvent = {
            jobId: publicId,
            status: EJobStatus.RUNNING,
            message,
            processed: 0,
          };
          void job.updateProgress({ message, processed: 0, log: [event] });
          this.progress.emit(event);
        },
      });
      if (result.status !== 'done') throw new Error(result.failReason);
      if (phase === EScanPhase.HEAD) {
        await this.enqueueHistory(data, result.headSha, data.parentJobId);
      }
    } finally {
      clearInterval(timer);
    }
  }

  private async enqueueHistory(
    data: IScanRepoJobData,
    targetSha: string,
    parentJobId?: string,
  ): Promise<void> {
    await this.jobQueue.enqueuePhase(
      EScanPhase.HISTORY,
      data.repoRef,
      targetSha,
      { ...data, targetSha, parentJobId },
    );
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
    const abort = new AbortController();
    const stopTimer = setInterval(() => {
      void shouldStop().then((stop) => {
        if (stop) abort.abort();
      });
    }, 500);

    try {
      if (job.name === 'discover') {
        const data = job.data as IDiscoverJobData;
        const date = data.date ? new Date(data.date) : undefined;
        processed = await this.discoverRepos.execute(
          date,
          onProgress,
          shouldStop,
        );
      } else if (job.name === 'scan') {
        const data = job.data as IScanLoopJobData;
        await this.reconcilePhases?.execute(data.workdirRoot);
        processed = await this.runScanLoop.execute({
          workdirRoot: data.workdirRoot,
          sourceUrlFn: buildCloneUrl,
          workers: data.workers,
          maxRepos: data.maxRepos,
          staleTimeoutSeconds: data.staleTimeoutSeconds,
          onProgress,
          shouldStop,
          signal: abort.signal,
          parentJobId: job.id!,
        });
      } else if (job.name === 'rescan-service') {
        if (!this.rescanService)
          throw new Error('Service rescan is unavailable');
        const data = job.data as IScanRepoJobData & { secretType: ESecretType };
        onProgress(
          `Rescanning ${data.secretType} in ${data.repoRef.owner}/${data.repoRef.name}`,
        );
        const result = await this.rescanService.execute({
          ...data,
          signal: abort.signal,
          onProgress,
        });
        if (result.status !== 'done') throw new Error(result.failReason);
        processed = 1;
      } else if (job.name === 'scan-repo') {
        const data = job.data as IScanRepoJobData;
        const result = this.phaseScanner
          ? await this.phaseScanner.execute({
              repoRef: data.repoRef,
              phase: EScanPhase.HEAD,
              cloneSource: data.cloneSource,
              workdir: data.workdir,
              signal: abort.signal,
              onProgress: (message) => onProgress(message),
            })
          : await this.scanRepository.execute(
              data.repoRef,
              data.cloneSource,
              data.workdir,
              (message) => onProgress(message),
            );
        if (result.status === 'failed') throw new Error(result.failReason);
        if (result.status !== 'done') throw new Error(result.failReason);
        if (this.phaseScanner)
          await this.enqueueHistory(data, result.headSha, job.id!);
        processed = 1;
      } else {
        throw new Error(`Unknown job name: ${job.name}`);
      }

      const doneMessage =
        job.name === 'scan'
          ? `scan HEAD processing finished: ${processed} processed; history continues in background`
          : `${job.name} finished: ${processed} processed`;
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
    } finally {
      clearInterval(stopTimer);
    }
  }

  async close(): Promise<void> {
    await Promise.all([
      this.worker?.close(),
      this.headWorker?.close(),
      this.historyWorker?.close(),
    ]);
  }

  async onModuleDestroy(): Promise<void> {
    await this.close();
  }
}
