import { BullmqJobWorker } from '../../../../../src/modules/scanner/infrastructure/jobs/bullmq-job-worker';
import { EJobStatus } from '../../../../../src/modules/scanner/domain/constant/job-status.constant';
import { EScanControlState } from '../../../../../src/modules/scanner/domain/constant/scan-control.constant';
import { EScanPhase } from '../../../../../src/modules/scanner/domain/constant/scan-phase.constant';
import { FakeScanJobQueue } from '../../fakes/fake-scan-job-queue';
import { JobQueuePort } from '../../../../../src/modules/scanner/application/ports/job-queue.port';
import { BullmqJobQueueAdapter } from '../../../../../src/modules/scanner/infrastructure/jobs/bullmq-job-queue.adapter';
import { Job } from 'bullmq';

const repoRef = { repoId: 1, owner: 'local', name: 'fixture' };
const oldControl = {
  epoch: 1,
  state: EScanControlState.STOPPED,
  stopEpoch: 1,
  requestedAt: new Date(0).toISOString(),
  finishedAt: new Date(1).toISOString(),
};

describe('BullmqJobWorker global Stop preflight (no Redis)', () => {
  it('keeps HTTP startup available when phase recovery cannot read control', async () => {
    const worker = new BullmqJobWorker(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      undefined,
      {
        execute: jest
          .fn()
          .mockRejectedValue(new Error('scan_control_unavailable')),
      } as never,
    );
    jest.spyOn(worker, 'start').mockResolvedValue();
    const errorLog = jest.spyOn(console, 'error').mockImplementation();

    try {
      await expect(worker.onModuleInit()).resolves.toBeUndefined();
      expect(errorLog).toHaveBeenCalledWith(
        '[BullmqJobWorker] Phase reconciliation unavailable',
      );
    } finally {
      await worker.close();
      errorLog.mockRestore();
    }
  });
  it.each(['scan', 'scan-repo', 'rescan-service'])(
    'stops a stale queued %s before any scan state or worker call',
    async (name) => {
      const jobs = new FakeScanJobQueue();
      jest
        .spyOn(jobs as JobQueuePort, 'readScanControl')
        .mockResolvedValue(oldControl);
      const scanLoop = { execute: jest.fn() };
      const scanRepo = { execute: jest.fn() };
      const rescan = { execute: jest.fn() };
      const events: Array<{ status: EJobStatus }> = [];
      const worker = new BullmqJobWorker(
        {} as never,
        scanLoop as never,
        scanRepo as never,
        {
          emit: (event: { status: EJobStatus }) => events.push(event),
        } as never,
        jobs,
        undefined,
        undefined,
        rescan as never,
      );
      const job = {
        id: `stale-${name}`,
        name,
        data: {
          scanEpoch: 0,
          workdirRoot: 'synthetic',
          repoRef,
          cloneSource: 'synthetic',
          workdir: 'synthetic',
        },
        updateProgress: jest.fn(async () => {}),
      };

      await expect(
        (worker as unknown as { process(job: unknown): Promise<void> }).process(
          job,
        ),
      ).resolves.toBeUndefined();
      expect(scanLoop.execute).not.toHaveBeenCalled();
      expect(scanRepo.execute).not.toHaveBeenCalled();
      expect(rescan.execute).not.toHaveBeenCalled();
      expect(events.at(-1)?.status).toBe(EJobStatus.STOPPED);
      expect(job.updateProgress).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: EJobStatus.STOPPED }),
      );
    },
  );

  it.each([EScanPhase.HEAD, EScanPhase.HISTORY])(
    'stops a stale queued %s before phase execution',
    async (phase) => {
      const jobs = new FakeScanJobQueue();
      jest
        .spyOn(jobs as JobQueuePort, 'readScanControl')
        .mockResolvedValue(oldControl);
      const phaseScanner = { execute: jest.fn() };
      const worker = new BullmqJobWorker(
        {} as never,
        {} as never,
        {} as never,
        { emit: jest.fn() } as never,
        jobs,
        phaseScanner as never,
      );
      const job = {
        id: `stale-${phase}`,
        name: phase,
        data: { repoRef, scanEpoch: 0, targetSha: 'a'.repeat(40) },
        updateProgress: jest.fn(async () => {}),
      };

      await expect(
        (
          worker as unknown as {
            processPhase(job: unknown, phase: EScanPhase): Promise<void>;
          }
        ).processPhase(job, phase),
      ).resolves.toBeUndefined();
      expect(phaseScanner.execute).not.toHaveBeenCalled();
      expect(job.updateProgress).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: EJobStatus.STOPPED }),
      );
    },
  );

  it('starts scan-repo state only after admission and passes the immutable epoch', async () => {
    const jobs = new FakeScanJobQueue();
    jest.spyOn(jobs as JobQueuePort, 'readScanControl').mockResolvedValue({
      epoch: 4,
      state: EScanControlState.READY,
      stopEpoch: null,
      requestedAt: null,
      finishedAt: null,
    });
    const state = { startRepoScan: jest.fn(async () => {}) };
    const phaseScanner = {
      execute: jest.fn(async () => ({
        status: 'done' as const,
        headSha: 'a'.repeat(40),
      })),
    };
    const worker = new BullmqJobWorker(
      {} as never,
      {} as never,
      {} as never,
      { emit: jest.fn() } as never,
      jobs,
      phaseScanner as never,
      undefined,
      undefined,
      state as never,
    );
    const job = {
      id: 'current-root',
      timestamp: 100,
      name: 'scan-repo',
      data: {
        repoRef,
        cloneSource: 'synthetic',
        workdir: 'synthetic',
        scanEpoch: 4,
      },
      updateProgress: jest.fn(async () => {}),
    };

    await (
      worker as unknown as { process(job: unknown): Promise<void> }
    ).process(job);

    expect(state.startRepoScan).toHaveBeenCalledWith(
      1,
      'local',
      'fixture',
      4,
      true,
    );
    expect(phaseScanner.execute).toHaveBeenCalledWith(
      expect.objectContaining({ scanEpoch: 4 }),
    );
    expect(state.startRepoScan.mock.invocationCallOrder[0]).toBeLessThan(
      phaseScanner.execute.mock.invocationCallOrder[0],
    );
    expect(jobs.enqueued[0].payload).toMatchObject({
      payload: { scanEpoch: 4 },
    });
  });

  it('lets an older root proceed and defers the younger retry until the old root is terminal', async () => {
    const jobs = new FakeScanJobQueue();
    jest.spyOn(jobs as JobQueuePort, 'readScanControl').mockResolvedValue({
      epoch: 4,
      state: EScanControlState.READY,
      stopEpoch: null,
      requestedAt: null,
      finishedAt: null,
    });
    const active = new Map([
      ['old-root', 100],
      ['retry-busy', 200],
    ]);
    Object.assign(jobs, {
      hasOtherActiveScanForRepo: jest.fn(
        async (
          _repoId: number,
          currentJobId: string,
          currentTimestamp: number,
        ) =>
          [...active].some(
            ([id, timestamp]) =>
              id !== currentJobId &&
              (timestamp < currentTimestamp ||
                (timestamp === currentTimestamp && id < currentJobId)),
          ),
      ),
    });
    let cancelled = false;
    const state = {
      startRepoScan: jest.fn(async () => {
        cancelled = false;
      }),
    };
    let oldStarted!: () => void;
    const oldPhaseStarted = new Promise<void>((resolve) => {
      oldStarted = resolve;
    });
    let releaseOld!: () => void;
    const oldCleanup = new Promise<{ status: 'cancelled' }>((resolve) => {
      releaseOld = () => resolve({ status: 'cancelled' });
    });
    const phaseScanner = {
      execute: jest
        .fn()
        .mockImplementationOnce(() => {
          oldStarted();
          return oldCleanup;
        })
        .mockResolvedValue({ status: 'done', headSha: 'a'.repeat(40) }),
    };
    const worker = new BullmqJobWorker(
      {} as never,
      {} as never,
      {} as never,
      { emit: jest.fn() } as never,
      jobs,
      phaseScanner as never,
      undefined,
      undefined,
      state as never,
    );
    const makeJob = (id: string, timestamp: number) => ({
      id,
      timestamp,
      name: 'scan-repo',
      data: {
        repoRef,
        cloneSource: 'synthetic',
        workdir: 'synthetic',
        scanEpoch: 4,
      },
      updateProgress: jest.fn(async () => {}),
    });
    const process = (job: ReturnType<typeof makeJob>) =>
      (worker as unknown as { process(job: unknown): Promise<void> }).process(
        job,
      );
    const oldJob = makeJob('old-root', 100);
    const oldProcessing = process(oldJob);
    await oldPhaseStarted;

    const busyRetry = makeJob('retry-busy', 200);
    await process(busyRetry);
    expect(cancelled).toBe(false);
    expect(state.startRepoScan).toHaveBeenCalledTimes(1);
    expect(phaseScanner.execute).toHaveBeenCalledTimes(1);
    expect(busyRetry.updateProgress).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: EJobStatus.STOPPED }),
    );
    active.delete('retry-busy');

    releaseOld();
    await oldProcessing;
    active.delete('old-root');
    cancelled = true;
    const readyRetry = makeJob('retry-after', 300);
    await process(readyRetry);
    expect(state.startRepoScan).toHaveBeenCalledTimes(2);
    expect(phaseScanner.execute).toHaveBeenCalledTimes(2);
    expect(cancelled).toBe(false);
  });

  it('waits for an active service scan to release resources after the 500ms Stop poll', async () => {
    const jobs = new FakeScanJobQueue();
    let control = {
      epoch: 0,
      state: EScanControlState.READY,
      stopEpoch: null as number | null,
      requestedAt: null as string | null,
      finishedAt: null as string | null,
    };
    jest
      .spyOn(jobs as JobQueuePort, 'readScanControl')
      .mockImplementation(async () => control);
    let entered!: () => void;
    const enteredScan = new Promise<void>((resolve) => (entered = resolve));
    let release!: () => void;
    const cleanup = new Promise<void>((resolve) => (release = resolve));
    const rescan = {
      execute: jest.fn(async (options: { signal: AbortSignal }) => {
        entered();
        await new Promise<void>((resolve) =>
          options.signal.addEventListener('abort', () => resolve(), {
            once: true,
          }),
        );
        await cleanup;
        return { status: 'cancelled', failReason: 'scan_cancelled' };
      }),
    };
    const events: Array<{ status: EJobStatus }> = [];
    const worker = new BullmqJobWorker(
      {} as never,
      {} as never,
      {} as never,
      { emit: (event: { status: EJobStatus }) => events.push(event) } as never,
      jobs,
      undefined,
      undefined,
      rescan as never,
    );
    const job = {
      id: 'active-service',
      name: 'rescan-service',
      data: { repoRef, scanEpoch: 0, secretType: 'github_pat' },
      updateProgress: jest.fn(async () => {}),
    };
    let settled = false;
    const processing = (
      worker as unknown as { process(job: unknown): Promise<void> }
    )
      .process(job)
      .finally(() => {
        settled = true;
      });
    await enteredScan;
    control = {
      epoch: 1,
      state: EScanControlState.STOPPING,
      stopEpoch: 1,
      requestedAt: new Date(0).toISOString(),
      finishedAt: null,
    };
    await new Promise<void>((resolve) => setTimeout(resolve, 600));
    expect(settled).toBe(false);
    release();
    await processing;
    expect(events.at(-1)?.status).toBe(EJobStatus.STOPPED);
    expect(job.updateProgress).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: EJobStatus.STOPPED }),
    );
  });

  it('fails an active scan safely when its Redis control poll rejects', async () => {
    const jobs = new FakeScanJobQueue();
    let unavailable = false;
    jest
      .spyOn(jobs as JobQueuePort, 'readScanControl')
      .mockImplementation(async () => {
        if (unavailable) throw new Error('synthetic Redis failure');
        return {
          epoch: 0,
          state: EScanControlState.READY,
          stopEpoch: null,
          requestedAt: null,
          finishedAt: null,
        };
      });
    let entered!: () => void;
    const enteredScan = new Promise<void>((resolve) => (entered = resolve));
    const rescan = {
      execute: jest.fn(async (options: { signal: AbortSignal }) => {
        entered();
        await new Promise<void>((resolve) =>
          options.signal.addEventListener('abort', () => resolve(), {
            once: true,
          }),
        );
        return { status: 'cancelled', failReason: 'scan_cancelled' };
      }),
    };
    const events: Array<{ status: EJobStatus }> = [];
    const worker = new BullmqJobWorker(
      {} as never,
      {} as never,
      {} as never,
      { emit: (event: { status: EJobStatus }) => events.push(event) } as never,
      jobs,
      undefined,
      undefined,
      rescan as never,
    );
    const job = {
      id: 'redis-failure',
      name: 'rescan-service',
      data: { repoRef, scanEpoch: 0, secretType: 'github_pat' },
      updateProgress: jest.fn(async () => {}),
    };
    const processing = (
      worker as unknown as { process(job: unknown): Promise<void> }
    ).process(job);
    await enteredScan;
    unavailable = true;
    await expect(processing).rejects.toThrow('scan_control_unavailable');
    expect(events.at(-1)?.status).toBe(EJobStatus.FAILED);
  });
});

describe('BullmqJobQueueAdapter global status (synthetic BullMQ records)', () => {
  it('lets the older active scan-repo root proceed and defers the younger until terminal', async () => {
    const active = [
      { id: 'older', name: 'scan-repo', timestamp: 100, data: { repoRef } },
      { id: 'younger', name: 'scan-repo', timestamp: 200, data: { repoRef } },
    ];
    const adapter = Object.assign(
      Object.create(BullmqJobQueueAdapter.prototype),
      {
        queue: {
          getJobs: jest.fn(async (_states: string[], start = 0, end = 99) =>
            active.slice(start, end + 1),
          ),
        },
        headQueue: { getJobs: jest.fn(async () => []) },
        historyQueue: { getJobs: jest.fn(async () => []) },
      },
    ) as BullmqJobQueueAdapter;

    expect(await adapter.hasOtherActiveScanForRepo(1, 'older', 100)).toBe(
      false,
    );
    expect(await adapter.hasOtherActiveScanForRepo(1, 'younger', 200)).toBe(
      true,
    );
    active.shift();
    expect(await adapter.hasOtherActiveScanForRepo(1, 'younger', 200)).toBe(
      false,
    );
    active.splice(
      0,
      active.length,
      { id: 'b', name: 'scan-repo', timestamp: 300, data: { repoRef } },
      { id: 'a', name: 'scan-repo', timestamp: 300, data: { repoRef } },
    );
    expect(await adapter.hasOtherActiveScanForRepo(1, 'a', 300)).toBe(false);
    expect(await adapter.hasOtherActiveScanForRepo(1, 'b', 300)).toBe(true);
    active.splice(
      0,
      active.length,
      { id: '10', name: 'scan-repo', timestamp: 300, data: { repoRef } },
      { id: '9', name: 'scan-repo', timestamp: 300, data: { repoRef } },
    );
    expect(await adapter.hasOtherActiveScanForRepo(1, '9', 300)).toBe(false);
    expect(await adapter.hasOtherActiveScanForRepo(1, '10', 300)).toBe(true);
  });

  it('finds other active repo work across queues and conservatively blocks on a bulk scan', async () => {
    const controlJobs: Array<{ id: string; name: string; data: unknown }> = [
      { id: 'current', name: 'scan-repo', data: { repoRef } },
      { id: 'unrelated', name: 'scan-repo', data: { repoRef: { repoId: 2 } } },
    ];
    const headJobs: Array<{ id: string; name: string; data: unknown }> = [];
    const historyJobs: Array<{ id: string; name: string; data: unknown }> = [];
    const queue = (
      jobs: Array<{ id: string; name: string; data: unknown }>,
    ) => ({
      getJobs: jest.fn(async (_states: string[], start = 0, end = 99) =>
        jobs.slice(start, end + 1),
      ),
    });
    const adapter = Object.assign(
      Object.create(BullmqJobQueueAdapter.prototype),
      {
        queue: queue(controlJobs),
        headQueue: queue(headJobs),
        historyQueue: queue(historyJobs),
      },
    ) as BullmqJobQueueAdapter;

    expect(await adapter.hasOtherActiveScanForRepo(1, 'current', 100)).toBe(
      false,
    );
    headJobs.push({ id: 'head', name: EScanPhase.HEAD, data: { repoRef } });
    expect(await adapter.hasOtherActiveScanForRepo(1, 'current', 100)).toBe(
      true,
    );
    headJobs.length = 0;
    historyJobs.push({
      id: 'history',
      name: EScanPhase.HISTORY,
      data: { repoRef },
    });
    expect(await adapter.hasOtherActiveScanForRepo(1, 'current', 100)).toBe(
      true,
    );
    historyJobs.length = 0;
    controlJobs.push({ id: 'bulk', name: 'scan', data: {} });
    expect(await adapter.hasOtherActiveScanForRepo(1, 'current', 100)).toBe(
      true,
    );
  });

  it('reports old queued/active jobs truthfully while preserving completed DONE', async () => {
    const job = {
      id: 'synthetic',
      name: 'scan',
      data: { scanEpoch: 0 },
      progress: { message: 'done', log: [] },
      timestamp: 0,
      getState: jest.fn(),
    } as unknown as Job;
    const queue = { getJob: jest.fn().mockResolvedValue(job) };
    const adapter = Object.assign(
      Object.create(BullmqJobQueueAdapter.prototype),
      {
        queue,
        headQueue: queue,
        historyQueue: queue,
      },
    ) as BullmqJobQueueAdapter;
    jest.spyOn(adapter, 'readScanControl').mockResolvedValue(oldControl);

    (job.getState as jest.Mock).mockResolvedValue('waiting');
    expect((await adapter.getJob('synthetic'))?.status).toBe(
      EJobStatus.STOPPED,
    );
    (job.getState as jest.Mock).mockResolvedValue('active');
    expect((await adapter.getJob('synthetic'))?.status).toBe(
      EJobStatus.STOPPING,
    );
    (job.getState as jest.Mock).mockResolvedValue('completed');
    expect((await adapter.getJob('synthetic'))?.status).toBe(EJobStatus.DONE);
  });

  it('counts all active scan pages and detects old work beyond the first page', async () => {
    const active = Array.from({ length: 101 }, (_, index) => ({
      name: 'scan',
      data: { scanEpoch: index === 100 ? 0 : 1 },
    })) as Job[];
    const control = {
      ...oldControl,
      state: EScanControlState.READY,
      stopEpoch: null,
      requestedAt: null,
      finishedAt: null,
    };
    const queue = {
      getJobs: jest.fn(async (states: string[], start = 0, end = 99) =>
        states.includes('active') ? active.slice(start, end + 1) : [],
      ),
    };
    const emptyQueue = { getJobs: jest.fn(async () => []) };
    const adapter = Object.assign(
      Object.create(BullmqJobQueueAdapter.prototype),
      {
        queue,
        headQueue: emptyQueue,
        historyQueue: emptyQueue,
      },
    ) as BullmqJobQueueAdapter;
    jest.spyOn(adapter, 'readScanControl').mockResolvedValue(control);

    expect(await adapter.hasActiveScansBefore(1)).toBe(true);
    expect((await adapter.getScanRuntime()).queues.control.active).toBe(101);
  });
});
