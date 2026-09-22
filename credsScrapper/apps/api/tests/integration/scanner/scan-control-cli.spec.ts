import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import {
  EScanControlState,
  SCAN_CONTROL_KEY,
} from '../../../src/modules/scanner/domain/constant/scan-control.constant';

const apiDir = path.resolve(__dirname, '../../..');

describe('scan-control CLI recovery (isolated synthetic services)', () => {
  it('starts recovery in STOPPING and refuses persisted or existing epochs', async () => {
    const redisUrl = process.env.SCAN_CONTROL_CLI_TEST_REDIS_URL;
    if (
      !redisUrl ||
      !process.env.REDIS_URL ||
      redisUrl === process.env.REDIS_URL
    ) {
      throw new Error('Set a separate SCAN_CONTROL_CLI_TEST_REDIS_URL');
    }

    const dbPath = path.join(
      mkdtempSync(path.join(tmpdir(), 'scan-cli-')),
      'test.db',
    );
    const databaseUrl = `file:${dbPath}`;
    const prisma = new PrismaClient({
      datasources: { db: { url: databaseUrl } },
    });
    const redis = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
    const run = (epoch: number) =>
      spawnSync(
        'npm',
        ['run', 'scan:control', '--', 'recover', '--epoch', String(epoch)],
        {
          cwd: apiDir,
          env: {
            ...process.env,
            DATABASE_URL: databaseUrl,
            REDIS_URL: redisUrl,
          },
          encoding: 'utf8',
          timeout: 30000,
        },
      );

    try {
      // Fail closed before any write if this logical Redis database is not fresh.
      expect(await redis.get(SCAN_CONTROL_KEY)).toBeNull();
      await prisma.$executeRawUnsafe(
        'CREATE TABLE scanned_repos (scan_epoch INTEGER NOT NULL DEFAULT 0)',
      );
      await prisma.$executeRawUnsafe(
        'CREATE TABLE scan_phases (scan_epoch INTEGER NOT NULL DEFAULT 0)',
      );
      await prisma.$executeRawUnsafe(
        'INSERT INTO scanned_repos (scan_epoch) VALUES (1)',
      );

      expect(run(1).status).not.toBe(0);
      expect(await redis.get(SCAN_CONTROL_KEY)).toBeNull();
      expect(run(2).status).toBe(0);
      const rawControl = await redis.get(SCAN_CONTROL_KEY);
      expect(rawControl).not.toBeNull();
      const control = JSON.parse(rawControl!) as Record<string, unknown>;
      expect(control).toMatchObject({
        epoch: 2,
        state: EScanControlState.STOPPING,
        stopEpoch: 2,
        finishedAt: null,
      });
      expect(typeof control.requestedAt).toBe('string');
      expect(new Date(control.requestedAt as string).toISOString()).toBe(
        control.requestedAt,
      );
      expect(run(3).status).not.toBe(0);
      expect(await redis.get(SCAN_CONTROL_KEY)).toBe(rawControl);
    } finally {
      await Promise.all([prisma.$disconnect(), redis.quit()]);
    }
  });
});
