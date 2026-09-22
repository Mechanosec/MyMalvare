import { Test } from '@nestjs/testing';
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { ScanController } from '../../../src/modules/scanner/presentation/scan.controller';
import { ScanControlExceptionFilter } from '../../../src/modules/scanner/presentation/scan-control-exception.filter';
import { ScanControlError } from '../../../src/modules/scanner/domain/errors/scan-control.error';
import { EScanControlState } from '../../../src/modules/scanner/domain/constant/scan-control.constant';
import { AdminGuard } from '../../../src/modules/identity/infrastructure/guards/admin.guard';
import { GetScanStatusUseCase } from '../../../src/modules/scanner/application/use-cases/get-scan-status.use-case';
import { GetScannedReposUseCase } from '../../../src/modules/scanner/application/use-cases/get-scanned-repos.use-case';
import { AdminScanRepoUseCase } from '../../../src/modules/scanner/application/use-cases/admin-scan-repo.use-case';
import { StopAllScansUseCase } from '../../../src/modules/scanner/application/use-cases/stop-all-scans.use-case';
import { JobQueuePort } from '../../../src/modules/scanner/application/ports/job-queue.port';

describe('scan control HTTP (synthetic ports, no Redis)', () => {
  let app: INestApplication;
  let admin = true;
  const snapshot = {
    epoch: 2,
    state: EScanControlState.STOPPING,
    stopEpoch: 2,
    requestedAt: new Date(0).toISOString(),
    finishedAt: null,
  };
  const stop = { execute: jest.fn().mockResolvedValue(snapshot) };
  const queue = { enqueue: jest.fn() };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [ScanController],
      providers: [
        { provide: GetScanStatusUseCase, useValue: { execute: jest.fn() } },
        { provide: GetScannedReposUseCase, useValue: { execute: jest.fn() } },
        { provide: AdminScanRepoUseCase, useValue: { execute: jest.fn() } },
        { provide: StopAllScansUseCase, useValue: stop },
        { provide: JobQueuePort, useValue: queue },
      ],
    })
      .overrideGuard(AdminGuard)
      .useValue({ canActivate: () => admin })
      .compile();
    app = module.createNestApplication();
    app.useGlobalFilters(new ScanControlExceptionFilter());
    await app.init();
  });

  beforeEach(() => {
    admin = true;
    stop.execute.mockClear();
    queue.enqueue.mockReset();
  });

  afterAll(async () => {
    await app.close();
  });

  it('requires admin for Stop', async () => {
    admin = false;
    await request(app.getHttpServer()).post('/scan/stop').expect(403);
    expect(stop.execute).not.toHaveBeenCalled();
  });

  it('returns 202 with the durable Stop snapshot', async () => {
    const response = await request(app.getHttpServer())
      .post('/scan/stop')
      .expect(202);
    expect(response.body).toEqual(snapshot);
    expect(stop.execute).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['scan_stopping', 409],
    ['scan_control_unavailable', 503],
  ] as const)('maps %s from Start to HTTP %i', async (code, status) => {
    queue.enqueue.mockRejectedValueOnce(new ScanControlError(code));
    const response = await request(app.getHttpServer())
      .post('/scan')
      .send({})
      .expect(status);
    expect(response.body.code).toBe(code);
  });
});
