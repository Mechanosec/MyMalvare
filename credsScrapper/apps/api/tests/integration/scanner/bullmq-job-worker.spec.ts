import { Queue } from 'bullmq';
import { BullmqJobWorker } from '../../../src/modules/scanner/infrastructure/jobs/bullmq-job-worker';
import {
  redisConnection,
  SCANNER_QUEUE_NAME,
} from '../../../src/modules/scanner/infrastructure/jobs/bullmq-connection';
import { BullmqJobQueueAdapter } from '../../../src/modules/scanner/infrastructure/jobs/bullmq-job-queue.adapter';
import { EJobStatus } from '../../../src/modules/scanner/domain/constant/job-status.constant';
import { ESecretType } from '../../../src/modules/scanner/domain/constant/secret-type.constant';
import Redis from 'ioredis';
import { SCAN_CONTROL_KEY } from '../../../src/modules/scanner/domain/constant/scan-control.constant';

class RecordingScanRepository {
  calls: unknown[] = [];
  shouldReject = false;
  execute = async (
    repoRef: unknown,
    cloneSource: string,
    workdir: string,
    onProgress?: (message: string) => void,
  ) => {
    this.calls.push({ repoRef, cloneSource, workdir });
    if (this.shouldReject) {
      throw new Error('scan worker crashed');
    }
    onProgress?.('scan: test/repo - cloning');
    onProgress?.('scan: test/repo - done, 0 findings total');
    return { status: 'done' as const, headSha: 'a'.repeat(40) };
  };
}

class RecordingDiscoverRepos {
  calls: unknown[] = [];
  lastShouldStop?: () => Promise<boolean>;
  execute = async (
    date?: Date,
    onProgress?: (message: string) => void,
    shouldStop?: () => Promise<boolean>,
  ): Promise<number> => {
    this.calls.push(date);
    this.lastShouldStop = shouldStop;
    onProgress?.(
      'discovery: finished, 0 push events processed, 0 new candidates added',
    );
    return 0;
  };
}

class RecordingRunScanLoop {
  calls: unknown[] = [];
  lastShouldStop?: () => Promise<boolean>;
  execute = async (options: {
    workdirRoot: string;
    shouldStop?: () => Promise<boolean>;
  }): Promise<number> => {
    this.calls.push({ workdirRoot: options.workdirRoot });
    this.lastShouldStop = options.shouldStop;
    return 0;
  };
}

class RecordingProgress {
  events: unknown[] = [];
  emit = (event: unknown): void => {
    this.events.push(event);
  };
}

describe('BullmqJobWorker (real Redis + real BullMQ Worker)', () => {
  let queue: Queue;
  let queueAdapter: BullmqJobQueueAdapter;
  let worker: BullmqJobWorker;
  let discover: RecordingDiscoverRepos;
  let runScanLoop: RecordingRunScanLoop;
  let scanRepository: RecordingScanRepository;
  let progress: RecordingProgress;
  let redis: Redis;
  const rescan = {
    execute: jest
      .fn()
      .mockResolvedValue({ status: 'done', headSha: 'a'.repeat(40) }),
  };

  beforeAll(async () => {
    if (
      !process.env.SCAN_CONTROL_TEST_REDIS_URL ||
      process.env.REDIS_URL !== process.env.SCAN_CONTROL_TEST_REDIS_URL
    ) {
      throw new Error('This test requires an explicit isolated Redis endpoint');
    }
    redis = new Redis(redisConnection.url);
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
    queue = new Queue(SCANNER_QUEUE_NAME, { connection: redisConnection });
    queueAdapter = new BullmqJobQueueAdapter();
    discover = new RecordingDiscoverRepos();
    runScanLoop = new RecordingRunScanLoop();
    scanRepository = new RecordingScanRepository();
    progress = new RecordingProgress();
    worker = new BullmqJobWorker(
      discover as never,
      runScanLoop as never,
      scanRepository as never,
      progress as never,
      queueAdapter,
      undefined,
      undefined,
      rescan as never,
      { startRepoScan: jest.fn(async () => {}) } as never,
    );
    await worker.start();
  });

  beforeEach(() => {
    discover.calls = [];
    runScanLoop.calls = [];
    scanRepository.calls = [];
    progress.events = [];
  });

  afterAll(async () => {
    await worker.close();
    await queueAdapter.close();
    await queue.close();
    await redis.quit();
  });

  async function waitForStatus(
    jobId: string,
    status: EJobStatus,
    timeoutMs = 5000,
  ): Promise<void> {
    const start = Date.now();
    for (;;) {
      const job = await queueAdapter.getJob(jobId);
      if (job?.status === status) return;
      if (Date.now() - start > timeoutMs)
        throw new Error(
          `Timed out waiting for job ${jobId} to reach ${status}`,
        );
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  it('processes a scan-repo job by calling ScanRepositoryUseCase.execute directly', async () => {
    const job = await queue.add('scan-repo', {
      repoRef: { repoId: 1, owner: 'test', name: 'repo' },
      cloneSource: 'https://example.com/repo.git',
      workdir: 'workdir/repo-1',
    });

    await waitForStatus(job.id!, EJobStatus.DONE);

    expect(scanRepository.calls).toEqual([
      {
        repoRef: { repoId: 1, owner: 'test', name: 'repo' },
        cloneSource: 'https://example.com/repo.git',
        workdir: 'workdir/repo-1',
      },
    ]);
    const finalState = await queueAdapter.getJob(job.id!);
    expect(finalState?.log.map((e) => e.message)).toContain(
      'scan: test/repo - cloning',
    );
    expect(
      progress.events.some(
        (e: any) => e.message === 'scan: test/repo - cloning',
      ),
    ).toBe(true);
    expect(progress.events.some((e: any) => e.status === EJobStatus.DONE)).toBe(
      true,
    );
  });

  it('delivers the selected service through the real queue and records completion', async () => {
    const jobId = await queueAdapter.enqueue('rescan-service', {
      repoRef: { repoId: 123, owner: 'test', name: 'fixture' },
      cloneSource: '/synthetic/fixture',
      workdir: '/synthetic/work',
      secretType: ESecretType.GCP_SERVICE_ACCOUNT_KEY,
    });
    await waitForStatus(jobId, EJobStatus.DONE);
    expect(rescan.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        repoRef: { repoId: 123, owner: 'test', name: 'fixture' },
        secretType: ESecretType.GCP_SERVICE_ACCOUNT_KEY,
      }),
    );
    expect(scanRepository.calls).toHaveLength(0);
    expect((await queueAdapter.getJob(jobId))?.processed).toBe(1);
  });

  it('emits a FAILED progress event when scan-repo processing rejects', async () => {
    scanRepository.shouldReject = true;
    try {
      const job = await queue.add('scan-repo', {
        repoRef: { repoId: 2, owner: 'test', name: 'repo2' },
        cloneSource: 'https://example.com/repo2.git',
        workdir: 'workdir/repo-2',
      });

      await waitForStatus(job.id!, EJobStatus.FAILED);

      expect(
        progress.events.some(
          (e: any) =>
            e.status === EJobStatus.FAILED &&
            typeof e.message === 'string' &&
            e.message.includes('scan worker crashed'),
        ),
      ).toBe(true);
    } finally {
      scanRepository.shouldReject = false;
    }
  });

  it('processes a discover job by calling DiscoverReposUseCase.execute', async () => {
    const job = await queue.add('discover', {});

    await waitForStatus(job.id!, EJobStatus.DONE);

    expect(discover.calls).toHaveLength(1);
  });

  it('processes a scan job by calling RunScanLoopUseCase.execute', async () => {
    const job = await queue.add('scan', { workdirRoot: 'workdir' });

    await waitForStatus(job.id!, EJobStatus.DONE);

    expect(runScanLoop.calls).toEqual([{ workdirRoot: 'workdir' }]);
  });

  it('wires a shouldStop callback into DiscoverReposUseCase.execute that reflects a real requestStop() through JobQueuePort', async () => {
    const job = await queue.add('discover', {});

    await waitForStatus(job.id!, EJobStatus.DONE);

    expect(await discover.lastShouldStop?.()).toBe(false);
    await queueAdapter.requestStop(job.id!);
    expect(await discover.lastShouldStop?.()).toBe(true);
  });

  it('wires a shouldStop callback into RunScanLoopUseCase.execute that reflects a real requestStop() through JobQueuePort', async () => {
    const job = await queue.add('scan', { workdirRoot: 'workdir' });

    await waitForStatus(job.id!, EJobStatus.DONE);

    expect(await runScanLoop.lastShouldStop?.()).toBe(false);
    await queueAdapter.requestStop(job.id!);
    expect(await runScanLoop.lastShouldStop?.()).toBe(true);
  });
});
