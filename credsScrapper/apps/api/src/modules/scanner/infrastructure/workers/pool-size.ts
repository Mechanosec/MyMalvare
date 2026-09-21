import * as os from 'node:os';
import { positiveInteger } from '../../application/types/scan-budget.type';

// Deliberately NOT `os.cpus().length` uncapped - running this on a
// developer machine with more cores shouldn't try to pin all of them
// just because a scan is being tested locally. 4 is the default ceiling;
// SCAN_WORKER_POOL_SIZE overrides it for ops tuning in prod.
export const SCAN_WORKER_POOL_SIZE: number = process.env.SCAN_WORKER_POOL_SIZE
  ? positiveInteger('SCAN_WORKER_POOL_SIZE', 4)
  : Math.max(1, Math.min(4, os.cpus().length));

export const HEAD_SCAN_WORKER_POOL_SIZE = positiveInteger(
  'HEAD_SCAN_WORKER_POOL_SIZE',
  2,
);
export const HISTORY_SCAN_WORKER_POOL_SIZE = positiveInteger(
  'HISTORY_SCAN_WORKER_POOL_SIZE',
  1,
);
