import { Queue } from 'bullmq';
import { BullmqJobWorker } from '../../../src/modules/scanner/infrastructure/jobs/bullmq-job-worker';
import { redisConnection, SCANNER_QUEUE_NAME } from '../../../src/modules/scanner/infrastructure/jobs/bullmq-connection';
import { BullmqJobQueueAdapter } from '../../../src/modules/scanner/infrastructure/jobs/bullmq-job-queue.adapter';
import { EJobStatus } from '../../../src/modules/scanner/domain/constant/job-status.constant';

class RecordingScanRepository {
  calls: unknown[] = [];
  execute = async (
    repoRef: unknown,
    cloneSource: string,
    workdir: string,
    onProgress?: (message: string) => void,
  ): Promise<void> => {
    this.calls.push({ repoRef, cloneSource, workdir });
    onProgress?.('scan: test/repo - cloning');
    onProgress?.('scan: test/repo - done, 0 findings total');
  };
}

class RecordingDiscoverRepos {
  calls: unknown[] = [];
  execute = async (date?: Date, onProgress?: (message: string) => void): Promise<number> => {
    this.calls.push(date);
    onProgress?.('discovery: finished, 0 push events processed, 0 new candidates added');
    return 0;
  };
}

class RecordingRunScanLoop {
  calls: unknown[] = [];
  execute = async (options: { workdirRoot: string }): Promise<number> => {
    this.calls.push({ workdirRoot: options.workdirRoot });
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

  beforeAll(async () => {
    queue = new Queue(SCANNER_QUEUE_NAME, { connection: redisConnection });
    queueAdapter = new BullmqJobQueueAdapter();
    discover = new RecordingDiscoverRepos();
    runScanLoop = new RecordingRunScanLoop();
    scanRepository = new RecordingScanRepository();
    progress = new RecordingProgress();
    worker = new BullmqJobWorker(discover as never, runScanLoop as never, scanRepository as never, progress as never);
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
  });

  async function waitForStatus(jobId: string, status: EJobStatus, timeoutMs = 5000): Promise<void> {
    const start = Date.now();
    for (;;) {
      const job = await queueAdapter.getJob(jobId);
      if (job?.status === status) return;
      if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for job ${jobId} to reach ${status}`);
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
      { repoRef: { repoId: 1, owner: 'test', name: 'repo' }, cloneSource: 'https://example.com/repo.git', workdir: 'workdir/repo-1' },
    ]);
    const finalState = await queueAdapter.getJob(job.id!);
    expect(finalState?.log.map((e) => e.message)).toContain('scan: test/repo - cloning');
    expect(progress.events.some((e: any) => e.message === 'scan: test/repo - cloning')).toBe(true);
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
});
