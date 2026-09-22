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
import { EScanControlState } from '../../domain/constant/scan-control.constant';
import { ScanControlError } from '../../domain/errors/scan-control.error';
import { StateRepositoryPort } from '../../application/ports/state-repository.port';
import { ReconcileScanStopUseCase } from '../../application/use-cases/reconcile-scan-stop.use-case';

function buildCloneUrl(ref: IRepoRef): string {
  return `https://github.com/${ref.owner}/${ref.name}.git`;
}

interface IScanRepoJobData {
  readonly repoRef: IRepoRef;
  readonly cloneSource: string;
  readonly workdir: string;
  readonly parentJobId?: string;
  readonly scanEpoch?: number;
}

interface IScanLoopJobData {
  readonly workdirRoot: string;
  readonly workers?: number;
  readonly maxRepos?: number;
  readonly staleTimeoutSeconds?: number;
  readonly scanEpoch?: number;
}

interface IDiscoverJobData {
  readonly date?: string;
}

function scanEpoch(data: unknown): number {
  if (typeof data !== 'object' || data === null)
    throw new ScanControlError('scan_control_unavailable');
  const value = (data as { scanEpoch?: unknown }).scanEpoch;
  if (
    value === undefined &&
    !Object.prototype.hasOwnProperty.call(data, 'scanEpoch')
  )
    return 0;
  if (!Number.isSafeInteger(value) || (value as number) < 0)
    throw new ScanControlError('scan_control_unavailable');
  return value as number;
}

@Injectable()
export class BullmqJobWorker implements OnModuleInit, OnModuleDestroy {
  private worker?: Worker;
  private headWorker?: Worker;
  private historyWorker?: Worker;
  private reconcileTimer?: NodeJS.Timeout;
  private reconcileInFlight?: Promise<void>;

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
    @Optional()
    private readonly state?: StateRepositoryPort,
    @Optional()
    private readonly reconcileStop?: ReconcileScanStopUseCase,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.start();
    await this.reconcileStopTick();
    if (this.reconcilePhases) {
      try {
        await this.reconcilePhases.execute(
          process.env.SCAN_WORKDIR ?? 'workdir',
        );
      } catch {
        console.error('[BullmqJobWorker] Phase reconciliation unavailable');
      }
    }
    if (this.reconcileStop) {
      this.reconcileTimer = setInterval(() => {
        void this.reconcileStopTick();
      }, 500);
      this.reconcileTimer.unref();
    }
  }

  private reconcileStopTick(): Promise<void> {
    if (!this.reconcileStop) return Promise.resolve();
    if (this.reconcileInFlight) return this.reconcileInFlight;
    const running = this.reconcileStop
      .execute()
      .catch(() =>
        console.error('[BullmqJobWorker] Stop reconciliation failed'),
      )
      .finally(() => {
        this.reconcileInFlight = undefined;
      });
    this.reconcileInFlight = running;
    return running;
  }

  private async admitted(epoch: number): Promise<boolean> {
    const control = await this.jobQueue.readScanControl();
    return control.state === EScanControlState.READY && control.epoch === epoch;
  }

  private stopMonitor(jobId: string, epoch?: number, parentJobId?: string) {
    const abort = new AbortController();
    let checking: Promise<void> | undefined;
    let failure: ScanControlError | undefined;
    const shouldStop = async (): Promise<boolean> => {
      try {
        // A failed global read takes precedence over a local stop flag.
        if (epoch !== undefined && !(await this.admitted(epoch))) return true;
        if (await this.jobQueue.isStopRequested(jobId)) return true;
        return parentJobId ? this.jobQueue.isStopRequested(parentJobId) : false;
      } catch {
        throw new ScanControlError('scan_control_unavailable');
      }
    };
    const poll = (): Promise<void> => {
      if (checking) return checking;
      checking = (async () => {
        try {
          if (await shouldStop()) abort.abort();
        } catch {
          failure = new ScanControlError('scan_control_unavailable');
          abort.abort(failure);
        }
      })().finally(() => {
        checking = undefined;
      });
      return checking;
    };
    const timer = setInterval(() => void poll(), 500);
    timer.unref();
    return {
      signal: abort.signal,
      shouldStop,
      finish: async (): Promise<boolean> => {
        clearInterval(timer);
        await poll();
        if (failure) throw failure;
        return abort.signal.aborted;
      },
    };
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
    const epoch = scanEpoch(data);
    if (!(await this.admitted(epoch))) {
      await this.recordStopped(job, publicId);
      return;
    }
    const monitor = this.stopMonitor(publicId, epoch, data.parentJobId);
    let result:
      Awaited<ReturnType<ScanRepositoryPhaseUseCase['execute']>> | undefined;
    let error: unknown;
    let stopped = false;
    let progressWrite = Promise.resolve();
    try {
      if (await monitor.shouldStop()) stopped = true;
      else {
        result = await this.phaseScanner.execute({
          repoRef: data.repoRef,
          phase,
          cloneSource: data.cloneSource,
          workdir: data.workdir,
          targetSha: data.targetSha,
          scanEpoch: epoch,
          signal: monitor.signal,
          shouldStop: monitor.shouldStop,
          onProgress: (message) => {
            const event: IJobProgressEvent = {
              jobId: publicId,
              status: EJobStatus.RUNNING,
              message,
              processed: 0,
            };
            progressWrite = progressWrite
              .then(() =>
                job.updateProgress({ message, processed: 0, log: [event] }),
              )
              .then(() => undefined)
              .catch(() => undefined);
            this.progress.emit(event);
          },
        });
      }
    } catch (caught) {
      error = caught;
    }
    await progressWrite;
    try {
      stopped = (await monitor.finish()) || stopped;
    } catch (caught) {
      error = caught;
    }
    if (error) throw error;
    if (stopped || result?.status === 'cancelled') {
      await this.recordStopped(job, publicId);
      return;
    }
    if (!result || result.status !== 'done') {
      throw new Error(result?.failReason ?? 'scan_phase_unavailable');
    }
    if (phase === EScanPhase.HEAD) {
      if (await monitor.shouldStop()) {
        await this.recordStopped(job, publicId);
        return;
      }
      await this.enqueueHistory(data, result.headSha, data.parentJobId);
    }
  }

  private async recordStopped(
    job: Job,
    publicId: string,
    processed = 0,
    log: IJobProgressEvent[] = [],
  ): Promise<void> {
    const event: IJobProgressEvent = {
      jobId: publicId,
      status: EJobStatus.STOPPED,
      message: 'Scan stopped',
      processed,
    };
    await job.updateProgress({
      message: event.message,
      processed,
      log: [...log, event],
      outcome: EJobStatus.STOPPED,
    });
    this.progress.emit(event);
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
    let progressWrite = Promise.resolve();
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
      progressWrite = progressWrite
        .then(() => job.updateProgress({ message, processed, log: [...log] }))
        .then(() => undefined)
        .catch(() => undefined);
      this.progress.emit(event);
    };

    const isScan = ['scan', 'scan-repo', 'rescan-service'].includes(job.name);
    const epoch = isScan ? scanEpoch(job.data) : undefined;
    if (epoch !== undefined && !(await this.admitted(epoch))) {
      await this.recordStopped(job, job.id!);
      return;
    }
    const monitor = this.stopMonitor(job.id!, epoch);
    let stopped = false;
    let error: unknown;
    try {
      if (await monitor.shouldStop()) stopped = true;
      else if (job.name === 'discover') {
        const data = job.data as IDiscoverJobData;
        const date = data.date ? new Date(data.date) : undefined;
        processed = await this.discoverRepos.execute(
          date,
          onProgress,
          monitor.shouldStop,
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
          scanEpoch: epoch,
          shouldStop: monitor.shouldStop,
          signal: monitor.signal,
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
          scanEpoch: epoch,
          signal: monitor.signal,
          shouldStop: monitor.shouldStop,
          onProgress,
        });
        if (result.status === 'cancelled') stopped = true;
        else if (result.status !== 'done') throw new Error(result.failReason);
        else processed = 1;
      } else if (job.name === 'scan-repo') {
        const data = job.data as IScanRepoJobData;
        if (await monitor.shouldStop()) stopped = true;
        else {
          if (!this.state)
            throw new Error('Scan state repository is unavailable');
          if (
            await this.jobQueue.hasOtherActiveScanForRepo(
              data.repoRef.repoId,
              job.id!,
              job.timestamp,
            )
          ) {
            onProgress('Scan retry deferred while another scan is active');
            stopped = true;
          } else {
            await this.state.startRepoScan(
              data.repoRef.repoId,
              data.repoRef.owner,
              data.repoRef.name,
              epoch,
              true,
            );
          }
        }
        if (!stopped) {
          const result = this.phaseScanner
            ? await this.phaseScanner.execute({
                repoRef: data.repoRef,
                phase: EScanPhase.HEAD,
                cloneSource: data.cloneSource,
                workdir: data.workdir,
                scanEpoch: epoch,
                signal: monitor.signal,
                shouldStop: monitor.shouldStop,
                onProgress: (message) => onProgress(message),
              })
            : await this.scanRepository.execute(
                data.repoRef,
                data.cloneSource,
                data.workdir,
                (message) => onProgress(message),
              );
          if (result.status === 'cancelled') stopped = true;
          else if (result.status !== 'done') throw new Error(result.failReason);
          else {
            if (this.phaseScanner) {
              if (await monitor.shouldStop()) stopped = true;
              else await this.enqueueHistory(data, result.headSha, job.id!);
            }
            processed = 1;
          }
        }
      } else {
        throw new Error(`Unknown job name: ${job.name}`);
      }
    } catch (caught) {
      error = caught;
    }
    await progressWrite;
    try {
      stopped = (await monitor.finish()) || stopped;
    } catch (caught) {
      error = caught;
    }
    if (stopped && !(error instanceof ScanControlError)) {
      await this.recordStopped(job, job.id!, processed, log);
      return;
    }
    if (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const failMessage = `${job.name} failed: ${errorMessage}`;
      const failEvent: IJobProgressEvent = {
        jobId: job.id!,
        status: EJobStatus.FAILED,
        message: failMessage,
        processed,
      };
      log.push(failEvent);
      await job.updateProgress({ message: failMessage, processed, log });
      this.progress.emit(failEvent);
      throw error;
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
    await job.updateProgress({ message: doneMessage, processed, log });
    this.progress.emit(doneEvent);
  }

  async close(): Promise<void> {
    if (this.reconcileTimer) clearInterval(this.reconcileTimer);
    await this.reconcileInFlight;
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
