import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import {
  SCAN_CONTROL_KEY,
  EScanControlState,
} from '../src/modules/scanner/domain/constant/scan-control.constant';
import { IScanControlState } from '../src/modules/scanner/domain/types/scan-control.type';

type Column = { name: string };
type Maximum = { epoch: number | bigint | null };

async function persistedEpoch(prisma: PrismaClient): Promise<number> {
  let highest = 0;
  for (const table of ['scanned_repos', 'scan_phases'] as const) {
    const columns = await prisma.$queryRawUnsafe<Column[]>(
      `PRAGMA table_info('${table}')`,
    );
    if (columns.length === 0) throw new Error('scan_control_unavailable');
    if (!columns.some((column) => column.name === 'scan_epoch')) continue;
    const result = await prisma.$queryRawUnsafe<Maximum[]>(
      `SELECT MAX(scan_epoch) AS epoch FROM ${table}`,
    );
    const value = result[0]?.epoch;
    if (value !== null && value !== undefined) {
      const epoch = Number(value);
      if (!Number.isSafeInteger(epoch) || epoch < 0)
        throw new Error('scan_control_unavailable');
      highest = Math.max(highest, epoch);
    }
  }
  return highest;
}

async function main(): Promise<void> {
  const [command, flag, rawEpoch, extra] = process.argv.slice(2);
  if (!process.env.REDIS_URL || !process.env.DATABASE_URL) {
    throw new Error('REDIS_URL and DATABASE_URL are required');
  }
  if (command !== 'init' && command !== 'recover') {
    throw new Error('Use init or recover --epoch N');
  }
  if (command === 'init' && (flag !== undefined || rawEpoch !== undefined)) {
    throw new Error('init takes no arguments');
  }
  const epoch = command === 'init' ? 0 : Number(rawEpoch);
  if (
    command === 'recover' &&
    (flag !== '--epoch' ||
      !Number.isSafeInteger(epoch) ||
      epoch < 1 ||
      extra !== undefined)
  ) {
    throw new Error('recover requires --epoch N with a positive safe integer');
  }

  const prisma = new PrismaClient();
  const redis = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 1 });
  try {
    const highest = await persistedEpoch(prisma);
    if (epoch < highest || (command === 'recover' && epoch <= highest)) {
      throw new Error('Requested epoch must exceed persisted scan epochs');
    }
    const control: IScanControlState = {
      epoch,
      state:
        command === 'recover'
          ? EScanControlState.STOPPING
          : EScanControlState.READY,
      stopEpoch: command === 'recover' ? epoch : null,
      requestedAt: command === 'recover' ? new Date().toISOString() : null,
      finishedAt: null,
    };
    if (
      (await redis.set(SCAN_CONTROL_KEY, JSON.stringify(control), 'NX')) !==
      'OK'
    ) {
      throw new Error('Scan control already exists; no changes made');
    }
    process.stdout.write(`Scan control initialized at epoch ${epoch}.\n`);
  } finally {
    await Promise.all([prisma.$disconnect(), redis.quit()]);
  }
}

main().catch(() => {
  process.stderr.write(
    'Scan control operation failed; inspect state before retrying.\n',
  );
  process.exitCode = 1;
});
