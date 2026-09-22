import Redis from 'ioredis';
import { BullmqJobQueueAdapter } from '../../../src/modules/scanner/infrastructure/jobs/bullmq-job-queue.adapter';
import { redisConnection } from '../../../src/modules/scanner/infrastructure/jobs/bullmq-connection';

const CONTROL_KEY = 'scanner:control';
const initial = {
  epoch: 0,
  state: 'ready',
  stopEpoch: null,
  requestedAt: null,
  finishedAt: null,
};

describe('scan control barrier (isolated Redis)', () => {
  let redis: Redis;
  let adapter: BullmqJobQueueAdapter;

  beforeAll(() => {
    if (
      !process.env.SCAN_CONTROL_TEST_REDIS_URL ||
      process.env.SCAN_CONTROL_TEST_REDIS_URL !== process.env.REDIS_URL
    ) {
      throw new Error('This test requires an explicit isolated Redis endpoint');
    }
    redis = new Redis(redisConnection.url);
    adapter = new BullmqJobQueueAdapter();
  });

  beforeEach(async () => {
    await redis.set(CONTROL_KEY, JSON.stringify(initial));
  });

  afterAll(async () => {
    await redis.del(CONTROL_KEY);
    await Promise.all([adapter.close(), redis.quit()]);
  });

  it('increments epoch once and keeps a durable, idempotent stop operation', async () => {
    const first = await adapter.requestStopAllScans();
    expect(first).toMatchObject({ epoch: 1, state: 'stopping', stopEpoch: 1 });
    expect(first.requestedAt).toEqual(expect.any(String));
    expect(await adapter.requestStopAllScans()).toEqual(first);
    expect(await redis.ttl(CONTROL_KEY)).toBe(-1);
  });

  it('rejects roots during stopping and allows a new epoch only after finish', async () => {
    await adapter.requestStopAllScans();
    for (const type of ['scan', 'scan-repo', 'rescan-service']) {
      await expect(
        adapter.enqueue(type, { workdirRoot: 'synthetic' }),
      ).rejects.toMatchObject({ code: 'scan_stopping' });
    }
    expect(await adapter.completeScanStop(0)).toBe(false);
    expect(await adapter.completeScanStop(1)).toBe(true);
    expect(await adapter.requestStopAllScans()).toMatchObject({
      epoch: 1,
      state: 'stopped',
    });
    await adapter.enqueue('scan', { workdirRoot: 'synthetic' });
    expect(await adapter.readScanControl()).toMatchObject({
      epoch: 1,
      state: 'ready',
    });
  });

  it('fails closed for missing or malformed control without initializing it', async () => {
    await redis.del(CONTROL_KEY);
    await expect(adapter.readScanControl()).rejects.toMatchObject({
      code: 'scan_control_unavailable',
    });
    await expect(
      adapter.enqueue('scan', { workdirRoot: 'synthetic' }),
    ).rejects.toMatchObject({ code: 'scan_control_unavailable' });
    expect(await redis.exists(CONTROL_KEY)).toBe(0);
    await redis.set(CONTROL_KEY, '{bad json');
    await expect(adapter.readScanControl()).rejects.toMatchObject({
      code: 'scan_control_unavailable',
    });
    await expect(
      adapter.enqueue('scan', { workdirRoot: 'synthetic' }),
    ).rejects.toMatchObject({ code: 'scan_control_unavailable' });
    await expect(adapter.requestStopAllScans()).rejects.toMatchObject({
      code: 'scan_control_unavailable',
    });
    expect(await redis.get(CONTROL_KEY)).toBe('{bad json');
  });

  it('keeps discovery independent when the scanner barrier is missing', async () => {
    await redis.del(CONTROL_KEY);
    const id = await adapter.enqueue('discover', { date: '2026-01-01' });
    expect((await adapter.getJob(id))?.type).toBe('discover');
    expect(await redis.exists(CONTROL_KEY)).toBe(0);
  });

  it('rejects a structurally invalid epoch and does not reset it', async () => {
    await redis.set(CONTROL_KEY, JSON.stringify({ ...initial, epoch: -1 }));
    await expect(adapter.requestStopAllScans()).rejects.toMatchObject({
      code: 'scan_control_unavailable',
    });
    expect(JSON.parse((await redis.get(CONTROL_KEY))!).epoch).toBe(-1);
  });

  it('does not admit a structurally complete control with an invalid calendar date', async () => {
    const malformed = {
      epoch: 1,
      state: 'stopped',
      stopEpoch: 1,
      requestedAt: '2026-13-40T10:00:00.000Z',
      finishedAt: '2026-13-40T10:00:00.000Z',
    };
    await redis.set(CONTROL_KEY, JSON.stringify(malformed));
    await expect(adapter.readScanControl()).rejects.toMatchObject({
      code: 'scan_control_unavailable',
    });
    await expect(
      adapter.enqueue('scan', { workdirRoot: 'synthetic' }),
    ).rejects.toMatchObject({ code: 'scan_control_unavailable' });
    expect(JSON.parse((await redis.get(CONTROL_KEY))!).state).toBe('stopped');
  });
});
