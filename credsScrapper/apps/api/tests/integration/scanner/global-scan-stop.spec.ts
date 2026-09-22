import { Job, Queue } from 'bullmq';
import Redis from 'ioredis';
import { ReconcileScanStopUseCase } from '../../../src/modules/scanner/application/use-cases/reconcile-scan-stop.use-case';
import { EJobStatus } from '../../../src/modules/scanner/domain/constant/job-status.constant';
import { EScanPhase } from '../../../src/modules/scanner/domain/constant/scan-phase.constant';
import { SCAN_CONTROL_KEY } from '../../../src/modules/scanner/domain/constant/scan-control.constant';
import {
  CONTROL_QUEUE,
  HEAD_QUEUE,
  HISTORY_QUEUE,
  redisConnection,
} from '../../../src/modules/scanner/infrastructure/jobs/bullmq-connection';
import { BullmqJobQueueAdapter } from '../../../src/modules/scanner/infrastructure/jobs/bullmq-job-queue.adapter';
import { BullmqJobWorker } from '../../../src/modules/scanner/infrastructure/jobs/bullmq-job-worker';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
}

async function within<T>(promise: Promise<T>): Promise<T> {
  let timer!: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Timed out waiting for BullMQ')),
          10000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function waitForCompleted(queue: Queue, id: string): Promise<Job> {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const job = await queue.getJob(id);
    if (job && (await job.getState()) === 'completed') return job;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for completed job ${id}`);
}

describe('global Stop across real Redis and BullMQ workers', () => {
  jest.setTimeout(30000);

  it('waits for active cleanup, rejects stale queued work after restart, and permits a new epoch at the same SHA', async () => {
    if (
      !process.env.SCAN_CONTROL_TEST_REDIS_URL ||
      process.env.REDIS_URL !== process.env.SCAN_CONTROL_TEST_REDIS_URL
    ) {
      throw new Error('This test requires an explicit isolated Redis endpoint');
    }

    const redis = new Redis(redisConnection.url);
    const firstAdapter = new BullmqJobQueueAdapter();
    const secondAdapter = new BullmqJobQueueAdapter();
    const controlQueue = new Queue(CONTROL_QUEUE, {
      connection: redisConnection,
    });
    const headQueue = new Queue(HEAD_QUEUE, { connection: redisConnection });
    const historyQueue = new Queue(HISTORY_QUEUE, {
      connection: redisConnection,
    });
    const activeStarted = deferred();
    const cleanupEntered = deferred();
    const releaseCleanup = deferred();
    const repoRef = { repoId: Date.now(), owner: 'synthetic', name: 'fixture' };
    const workdir = `synthetic-${repoRef.repoId}`;
    const targetSha = 'a'.repeat(40);
    const scanLoop = { execute: jest.fn(async (_options?: unknown) => 0) };
    const scanRepo = {
      execute: jest.fn(async () => ({ status: 'done', headSha: targetSha })),
    };
    const phaseScanner = {
      execute: jest.fn(async () => ({ status: 'done', headSha: targetSha })),
    };
    const discover = { execute: jest.fn(async () => 0) };
    const rescan = {
      execute: jest.fn(
        async ({
          signal,
        }: {
          signal: AbortSignal;
          repoRef: typeof repoRef;
        }) => {
          activeStarted.resolve();
          if (!signal.aborted) {
            await new Promise<void>((resolve) =>
              signal.addEventListener('abort', () => resolve(), { once: true }),
            );
          }
          cleanupEntered.resolve();
          await releaseCleanup.promise;
          return { status: 'cancelled', failReason: 'scan_cancelled' };
        },
      ),
    };
    const state = {
      cancelScansBefore: jest.fn(async () => {}),
      startRepoScan: jest.fn(async () => {}),
    };
    const makeWorker = (adapter: BullmqJobQueueAdapter) =>
      new BullmqJobWorker(
        discover as never,
        scanLoop as never,
        scanRepo as never,
        { emit: jest.fn() } as never,
        adapter,
        phaseScanner as never,
        undefined,
        rescan as never,
        state as never,
      );
    let firstWorker: BullmqJobWorker | undefined;
    let restartedWorker: BullmqJobWorker | undefined;

    try {
      await redis.set(
        SCAN_CONTROL_KEY,
        JSON.stringify({
          epoch: 0,
          state: 'ready',
          stopEpoch: null,
          requestedAt: null,
          finishedAt: null,
        }),
      );
      firstWorker = makeWorker(firstAdapter);
      await firstWorker.start();
      const activeId = await firstAdapter.enqueue('rescan-service', {
        repoRef,
        cloneSource: 'synthetic',
        workdir,
        secretType: 'github_pat',
      });
      await within(activeStarted.promise);

      expect((await secondAdapter.requestStopAllScans()).state).toBe(
        'stopping',
      );
      await within(cleanupEntered.promise);
      const coordinator = new ReconcileScanStopUseCase(
        state as never,
        secondAdapter,
      );
      await coordinator.execute();
      expect((await secondAdapter.readScanControl()).state).toBe('stopping');
      releaseCleanup.resolve();
      expect(
        (await waitForCompleted(controlQueue, activeId)).progress,
      ).toMatchObject({
        outcome: EJobStatus.STOPPED,
      });
      await firstWorker.close();
      firstWorker = undefined;

      // These legacy jobs were queued after the barrier and survive the worker restart.
      const staleRootIds = await Promise.all([
        controlQueue.add('scan', { workdirRoot: workdir }),
        controlQueue.add('scan-repo', {
          repoRef,
          cloneSource: 'synthetic',
          workdir,
        }),
        controlQueue.add('rescan-service', {
          repoRef,
          cloneSource: 'synthetic',
          workdir,
          secretType: 'github_pat',
        }),
      ]);
      const staleHeadId = await secondAdapter.enqueuePhase(
        EScanPhase.HEAD,
        repoRef,
        targetSha,
        {
          repoRef,
          targetSha,
          scanEpoch: 0,
          cloneSource: 'synthetic',
          workdir,
        },
      );
      const staleHistoryId = await secondAdapter.enqueuePhase(
        EScanPhase.HISTORY,
        repoRef,
        targetSha,
        {
          repoRef,
          targetSha,
          scanEpoch: 0,
          cloneSource: 'synthetic',
          workdir,
        },
      );
      const discoverId = await secondAdapter.enqueue('discover', {
        date: '2026-01-01',
      });

      restartedWorker = makeWorker(secondAdapter);
      await restartedWorker.start();
      for (const job of staleRootIds) {
        expect(
          (await waitForCompleted(controlQueue, job.id!)).progress,
        ).toMatchObject({
          outcome: EJobStatus.STOPPED,
        });
      }
      expect(
        (await waitForCompleted(headQueue, staleHeadId.slice('head:'.length)))
          .progress,
      ).toMatchObject({
        outcome: EJobStatus.STOPPED,
      });
      expect(
        (
          await waitForCompleted(
            historyQueue,
            staleHistoryId.slice('history:'.length),
          )
        ).progress,
      ).toMatchObject({
        outcome: EJobStatus.STOPPED,
      });
      expect(
        (await waitForCompleted(controlQueue, discoverId)).progress,
      ).not.toMatchObject({
        outcome: EJobStatus.STOPPED,
      });
      expect(scanLoop.execute).not.toHaveBeenCalledWith(
        expect.objectContaining({ workdirRoot: workdir }),
      );
      expect(scanRepo.execute).not.toHaveBeenCalledWith(
        expect.objectContaining({ repoId: repoRef.repoId }),
      );
      expect(phaseScanner.execute).not.toHaveBeenCalledWith(
        expect.objectContaining({ repoRef }),
      );
      expect(
        rescan.execute.mock.calls.filter(
          ([call]) => call.repoRef.repoId === repoRef.repoId,
        ),
      ).toHaveLength(1);
      expect(state.startRepoScan).not.toHaveBeenCalledWith(
        repoRef.repoId,
        repoRef.owner,
        repoRef.name,
        0,
      );

      await coordinator.execute();
      expect((await secondAdapter.readScanControl()).state).toBe('stopped');
      const newRootId = await secondAdapter.enqueue('scan-repo', {
        repoRef,
        cloneSource: 'synthetic',
        workdir,
      });
      expect((await controlQueue.getJob(newRootId))?.data.scanEpoch).toBe(1);
      await waitForCompleted(controlQueue, newRootId);
      const newHeadId = await secondAdapter.enqueuePhase(
        EScanPhase.HEAD,
        repoRef,
        targetSha,
        {
          repoRef,
          targetSha,
          scanEpoch: 1,
          cloneSource: 'synthetic',
          workdir,
        },
      );
      expect(newHeadId).not.toBe(staleHeadId);
      await waitForCompleted(headQueue, newHeadId.slice('head:'.length));
      expect(state.startRepoScan).toHaveBeenCalledWith(
        repoRef.repoId,
        repoRef.owner,
        repoRef.name,
        1,
        true,
      );
      expect(phaseScanner.execute).toHaveBeenCalledWith(
        expect.objectContaining({ scanEpoch: 1 }),
      );
    } finally {
      releaseCleanup.resolve();
      await restartedWorker?.close();
      await firstWorker?.close();
      await Promise.all([
        firstAdapter.close(),
        secondAdapter.close(),
        controlQueue.close(),
        headQueue.close(),
        historyQueue.close(),
        redis.quit(),
      ]);
    }
  });
});
