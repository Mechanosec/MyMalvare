export const SCANNER_QUEUE_NAME = 'scanner-jobs';

// BullMQ/ioredis parse a redis:// URL themselves when given as the
// `connection` option directly (no need to hand-construct an ioredis
// instance here).
export const redisConnection = {
  url: process.env.REDIS_URL ?? 'redis://localhost:6379',
};
