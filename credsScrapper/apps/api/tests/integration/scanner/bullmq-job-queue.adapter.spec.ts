import { Job, Queue } from 'bullmq';
import { BullmqJobQueueAdapter } from '../../../src/modules/scanner/infrastructure/jobs/bullmq-job-queue.adapter';
import {
  redisConnection,
  SCANNER_QUEUE_NAME,
} from '../../../src/modules/scanner/infrastructure/jobs/bullmq-connection';
import {
  EJobStatus,
  EJobType,
} from '../../../src/modules/scanner/domain/constant/job-status.constant';
import { EScanPhase } from '../../../src/modules/scanner/domain/constant/scan-phase.constant';
import Redis from 'ioredis';

const CONTROL_KEY = 'scanner:control';

describe('BullmqJobQueueAdapter (real Redis)', () => {
  let adapter: BullmqJobQueueAdapter;
  let queue: Queue;
  let redis: Redis;

  beforeAll(() => {
    if (
      !process.env.SCAN_CONTROL_TEST_REDIS_URL ||
      process.env.SCAN_CONTROL_TEST_REDIS_URL !== process.env.REDIS_URL
    ) {
      throw new Error('This test requires an explicit isolated Redis endpoint');
    }
    adapter = new BullmqJobQueueAdapter();
    queue = new Queue(SCANNER_QUEUE_NAME, { connection: redisConnection });
    redis = new Redis(redisConnection.url);
  });

  beforeEach(async () => {
    await redis.set(
      CONTROL_KEY,
      JSON.stringify({
        epoch: 0,
        state: 'ready',
        stopEpoch: null,
        requestedAt: null,
        finishedAt: null,
      }),
    );
  });

  afterAll(async () => {
    await redis.del(CONTROL_KEY);
    await adapter.close();
    await queue.close();
    await redis.quit();
  });

  it('enqueues a job and getJob reports it queued (nothing consumes it in this test)', async () => {
    const jobId = await adapter.enqueue(EJobType.DISCOVER, {
      date: new Date().toISOString(),
    });

    const job = await adapter.getJob(jobId);

    expect(job).not.toBeNull();
    expect(job?.status).toBe(EJobStatus.QUEUED);
    expect(job?.type).toBe(EJobType.DISCOVER);
    expect(job?.log).toEqual([]);
  });

  it('returns null for an id that was never enqueued', async () => {
    const job = await adapter.getJob('not-a-real-job-id');
    expect(job).toBeNull();
  });

  it('deduplicates a phase job by phase, repo and target SHA', async () => {
    const repoRef = { repoId: 991337, owner: 'local', name: 'fixture' };
    const targetSha = 'f'.repeat(40);
    const first = await adapter.enqueuePhase(
      EScanPhase.HEAD,
      repoRef,
      targetSha,
      { repoRef, targetSha },
    );
    const second = await adapter.enqueuePhase(
      EScanPhase.HEAD,
      repoRef,
      targetSha,
      { repoRef, targetSha },
    );
    expect(second).toBe(first);
    expect(first).toBe(`head:0-${repoRef.repoId}-${targetSha}`);
    expect(await adapter.getJob(first)).toMatchObject({
      id: first,
      status: EJobStatus.QUEUED,
    });
  });

  it('uses a new phase job ID for a new epoch at the same SHA', async () => {
    const repoRef = { repoId: 991338, owner: 'local', name: 'fixture' };
    const targetSha = 'e'.repeat(40);
    const first = await adapter.enqueuePhase(
      EScanPhase.HEAD,
      repoRef,
      targetSha,
      { repoRef, targetSha, scanEpoch: 0 },
    );
    const second = await adapter.enqueuePhase(
      EScanPhase.HEAD,
      repoRef,
      targetSha,
      { repoRef, targetSha, scanEpoch: 1 },
    );
    expect(first).toBe(`head:0-${repoRef.repoId}-${targetSha}`);
    expect(second).toBe(`head:1-${repoRef.repoId}-${targetSha}`);
  });

  it('keeps the admitted epoch when queue.add finishes after Stop', async () => {
    const internalQueue = adapter['queue'];
    const realAdd = internalQueue.add.bind(internalQueue);
    let releaseAdd!: () => void;
    let admitted!: () => void;
    const hold = new Promise<void>((resolve) => {
      releaseAdd = resolve;
    });
    const reachedAdd = new Promise<void>((resolve) => {
      admitted = resolve;
    });
    const spy = jest
      .spyOn(internalQueue, 'add')
      .mockImplementationOnce(async (name, data, opts) => {
        admitted();
        await hold;
        return realAdd(name, data, opts);
      });
    try {
      const enqueuing = adapter.enqueue('scan', {
        workdirRoot: 'synthetic',
        scanEpoch: 999,
      });
      await reachedAdd;
      await adapter.requestStopAllScans();
      releaseAdd();
      const id = await enqueuing;
      expect((await queue.getJob(id))?.data.scanEpoch).toBe(0);
    } finally {
      releaseAdd();
      spy.mockRestore();
    }
  });

  it('reports only admissible queued scans and retains active-check semantics', async () => {
    const before = await adapter.getScanRuntime();
    await adapter.enqueue('scan', { workdirRoot: 'synthetic' });
    const ready = await adapter.getScanRuntime();
    expect(ready.queues.control.queued).toBe(before.queues.control.queued + 1);
    expect(await adapter.hasActiveScansBefore(1)).toBe(false);
    await adapter.requestStopAllScans();
    const stopping = await adapter.getScanRuntime();
    expect(stopping.queues.control.queued).toBe(0);
  });

  it('rejects explicitly invalid phase epochs instead of using legacy zero', async () => {
    const repoRef = { repoId: 991339, owner: 'local', name: 'fixture' };
    for (const invalid of [null, '0', 0.5, undefined]) {
      await expect(
        adapter.enqueuePhase(EScanPhase.HEAD, repoRef, 'd'.repeat(40), {
          repoRef,
          scanEpoch: invalid,
        }),
      ).rejects.toMatchObject({ code: 'scan_control_unavailable' });
    }
  });

  it('fails closed on an invalid queued epoch when calculating runtime', async () => {
    const head = new Queue('scanner-head', { connection: redisConnection });
    const job = await head.add('head', { scanEpoch: '0' });
    try {
      await expect(adapter.getScanRuntime()).rejects.toMatchObject({
        code: 'scan_control_unavailable',
      });
    } finally {
      await job.remove();
      await head.close();
    }
  });

  it('fails closed on an invalid active epoch before reporting no old scans', async () => {
    const spy = jest
      .spyOn(adapter['queue'], 'getJobs')
      .mockResolvedValueOnce([
        { name: 'scan', data: { scanEpoch: null } } as Job,
      ]);
    try {
      await expect(adapter.hasActiveScansBefore(1)).rejects.toMatchObject({
        code: 'scan_control_unavailable',
      });
    } finally {
      spy.mockRestore();
    }
  });

  it('fails closed on an invalid active epoch in runtime counts', async () => {
    const spy = jest
      .spyOn(adapter['queue'], 'getJobs')
      .mockImplementation(async (types) =>
        types?.includes('active')
          ? ([{ name: 'scan', data: { scanEpoch: 0.5 } }] as Job[])
          : [],
      );
    try {
      await expect(adapter.getScanRuntime()).rejects.toMatchObject({
        code: 'scan_control_unavailable',
      });
    } finally {
      spy.mockRestore();
    }
  });

  it('rejects an unknown prefixed public job id', async () => {
    await expect(adapter.getJob('unknown:1')).rejects.toThrow(
      'Unknown job prefix',
    );
  });
});
