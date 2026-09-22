import { StopAllScansUseCase } from '../../../../../src/modules/scanner/application/use-cases/stop-all-scans.use-case';
import { EScanControlState } from '../../../../../src/modules/scanner/domain/constant/scan-control.constant';
import { JobQueuePort } from '../../../../../src/modules/scanner/application/ports/job-queue.port';
import { FakeScanJobQueue } from '../../fakes/fake-scan-job-queue';

describe('StopAllScansUseCase', () => {
  it('returns the durable Stop snapshot from the queue port', async () => {
    const jobs = new FakeScanJobQueue();
    const control = {
      epoch: 4,
      state: EScanControlState.STOPPING,
      stopEpoch: 4,
      requestedAt: new Date(0).toISOString(),
      finishedAt: null,
    };
    const request = jest
      .spyOn(jobs as JobQueuePort, 'requestStopAllScans')
      .mockResolvedValue(control);

    expect(await new StopAllScansUseCase(jobs).execute()).toEqual(control);
    expect(request).toHaveBeenCalledTimes(1);
  });
});
