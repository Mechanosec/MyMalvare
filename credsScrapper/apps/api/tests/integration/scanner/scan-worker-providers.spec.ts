import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { ScannerModule } from '../../../src/modules/scanner/scanner.module';
import { ScanWorkerPort } from '../../../src/modules/scanner/application/ports/scan-worker.port';
import { HeadScanWorkerPort } from '../../../src/modules/scanner/application/ports/head-scan-worker.port';
import { HistoryScanWorkerPort } from '../../../src/modules/scanner/application/ports/history-scan-worker.port';

it('constructs all production scan worker providers through Nest DI', async () => {
  const tokens = [ScanWorkerPort, HeadScanWorkerPort, HistoryScanWorkerPort];
  const providers = Reflect.getMetadata(
    MODULE_METADATA.PROVIDERS,
    ScannerModule,
  ).filter((provider: { provide?: unknown }) =>
    tokens.includes(provider.provide as typeof ScanWorkerPort),
  );
  expect(providers).toHaveLength(3);
  const module = await Test.createTestingModule({ providers }).compile();
  try {
    const workers = tokens.map((token) => module.get(token));
    expect(new Set(workers).size).toBe(3);
  } finally {
    await module.close();
  }
});
