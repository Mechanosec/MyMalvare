describe('SCAN_WORKER_POOL_SIZE', () => {
  const originalEnv = process.env.SCAN_WORKER_POOL_SIZE;
  const originalCpus = require('node:os').cpus;

  afterEach(() => {
    process.env.SCAN_WORKER_POOL_SIZE = originalEnv;
    require('node:os').cpus = originalCpus;
    jest.resetModules();
  });

  it('caps at 4 even when the host has more cores', () => {
    delete process.env.SCAN_WORKER_POOL_SIZE;
    require('node:os').cpus = () => new Array(16).fill({});
    jest.resetModules();
    const { SCAN_WORKER_POOL_SIZE } = require('../../../../../src/modules/scanner/infrastructure/workers/pool-size');
    expect(SCAN_WORKER_POOL_SIZE).toBe(4);
  });

  it('uses the host core count when fewer than 4', () => {
    delete process.env.SCAN_WORKER_POOL_SIZE;
    require('node:os').cpus = () => new Array(2).fill({});
    jest.resetModules();
    const { SCAN_WORKER_POOL_SIZE } = require('../../../../../src/modules/scanner/infrastructure/workers/pool-size');
    expect(SCAN_WORKER_POOL_SIZE).toBe(2);
  });

  it('honors SCAN_WORKER_POOL_SIZE when set', () => {
    process.env.SCAN_WORKER_POOL_SIZE = '7';
    jest.resetModules();
    const { SCAN_WORKER_POOL_SIZE } = require('../../../../../src/modules/scanner/infrastructure/workers/pool-size');
    expect(SCAN_WORKER_POOL_SIZE).toBe(7);
  });
});
