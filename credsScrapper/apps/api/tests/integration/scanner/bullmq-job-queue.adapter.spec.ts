import { Queue } from 'bullmq';
import { BullmqJobQueueAdapter } from '../../../src/modules/scanner/infrastructure/jobs/bullmq-job-queue.adapter';
import { redisConnection, SCANNER_QUEUE_NAME } from '../../../src/modules/scanner/infrastructure/jobs/bullmq-connection';
import { EJobStatus, EJobType } from '../../../src/modules/scanner/domain/constant/job-status.constant';

describe('BullmqJobQueueAdapter (real Redis)', () => {
  let adapter: BullmqJobQueueAdapter;
  let queue: Queue;

  beforeAll(() => {
    adapter = new BullmqJobQueueAdapter();
    queue = new Queue(SCANNER_QUEUE_NAME, { connection: redisConnection });
  });

  afterAll(async () => {
    await adapter.close();
    await queue.close();
  });

  it('enqueues a job and getJob reports it queued (nothing consumes it in this test)', async () => {
    const jobId = await adapter.enqueue(EJobType.DISCOVER, { date: new Date().toISOString() });

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
});
