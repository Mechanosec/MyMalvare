import { ReconcileScanStopUseCase } from '../../../../../src/modules/scanner/application/use-cases/reconcile-scan-stop.use-case';
import { EScanControlState } from '../../../../../src/modules/scanner/domain/constant/scan-control.constant';
import { FakeScanJobQueue } from '../../fakes/fake-scan-job-queue';
import { FakeStateRepository } from '../../fakes/fake-state-repository';
import { JobQueuePort } from '../../../../../src/modules/scanner/application/ports/job-queue.port';

describe('ReconcileScanStopUseCase', () => {
  it('keeps STOPPING until old active processing has finished and reconciles again', async () => {
    const jobs = new FakeScanJobQueue();
    jest.spyOn(jobs as JobQueuePort, 'readScanControl').mockResolvedValue({
      epoch: 1,
      state: EScanControlState.STOPPING,
      stopEpoch: 1,
      requestedAt: new Date(0).toISOString(),
      finishedAt: null,
    });
    const active = jest
      .spyOn(jobs as JobQueuePort, 'hasActiveScansBefore')
      .mockResolvedValueOnce(true)
      .mockResolvedValue(false);
    const finish = jest
      .spyOn(jobs as JobQueuePort, 'completeScanStop')
      .mockResolvedValue(true);
    const state = new FakeStateRepository();
    const cancel = jest.spyOn(state, 'cancelScansBefore');
    const useCase = new ReconcileScanStopUseCase(state, jobs);

    await useCase.execute();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(finish).not.toHaveBeenCalled();

    await useCase.execute();
    expect(cancel).toHaveBeenCalledTimes(3);
    expect(active).toHaveBeenCalledTimes(3);
    expect(finish).toHaveBeenCalledWith(1);
  });

  it('does not complete when the second active check finds a late processor', async () => {
    const jobs = new FakeScanJobQueue();
    jest.spyOn(jobs as JobQueuePort, 'readScanControl').mockResolvedValue({
      epoch: 4,
      state: EScanControlState.STOPPING,
      stopEpoch: 4,
      requestedAt: new Date(0).toISOString(),
      finishedAt: null,
    });
    jest
      .spyOn(jobs as JobQueuePort, 'hasActiveScansBefore')
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const finish = jest.spyOn(jobs as JobQueuePort, 'completeScanStop');
    const state = new FakeStateRepository();
    const cancel = jest.spyOn(state, 'cancelScansBefore');

    await new ReconcileScanStopUseCase(state, jobs).execute();

    expect(cancel).toHaveBeenCalledTimes(2);
    expect(finish).not.toHaveBeenCalled();
  });
});
