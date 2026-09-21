export const CONTROL_QUEUE = 'scanner-jobs';
export const HEAD_QUEUE = 'scanner-head';
export const HISTORY_QUEUE = 'scanner-history';
export const SCANNER_QUEUE_NAME = CONTROL_QUEUE;

// BullMQ/ioredis parse a redis:// URL themselves when given as the
// `connection` option directly (no need to hand-construct an ioredis
// instance here).
export const redisConnection = {
  url: process.env.REDIS_URL ?? 'redis://localhost:6379',
};
