import * as os from 'node:os';

// Deliberately NOT `os.cpus().length` uncapped - running this on a
// developer machine with more cores shouldn't try to pin all of them
// just because a scan is being tested locally. 4 is the default ceiling;
// SCAN_WORKER_POOL_SIZE overrides it for ops tuning in prod.
export const SCAN_WORKER_POOL_SIZE: number = process.env.SCAN_WORKER_POOL_SIZE
  ? Number(process.env.SCAN_WORKER_POOL_SIZE)
  : Math.max(1, Math.min(4, os.cpus().length));
