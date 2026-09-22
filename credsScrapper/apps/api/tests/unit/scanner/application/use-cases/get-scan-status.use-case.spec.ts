import { GetScanStatusUseCase } from '../../../../../src/modules/scanner/application/use-cases/get-scan-status.use-case';
import { FakeStateRepository } from '../../fakes/fake-state-repository';
import { FakeScanJobQueue } from '../../fakes/fake-scan-job-queue';
import { JobQueuePort } from '../../../../../src/modules/scanner/application/ports/job-queue.port';
import { EScanControlState } from '../../../../../src/modules/scanner/domain/constant/scan-control.constant';

describe('GetScanStatusUseCase', () => {
  it('delegates to the state repository', async () => {
    const state = new FakeStateRepository();
    await state.addCandidate(1, 'octocat', 'repo');
    const jobs = new FakeScanJobQueue();
    jest.spyOn(jobs as JobQueuePort, 'getScanRuntime').mockResolvedValue({
      epoch: 4,
      state: EScanControlState.STOPPING,
      stopEpoch: 4,
      requestedAt: new Date(0).toISOString(),
      finishedAt: null,
      queues: {
        control: { queued: 0, active: 1 },
        head: { queued: 0, active: 1 },
        history: { queued: 0, active: 0 },
      },
    });
    const useCase = new GetScanStatusUseCase(state, jobs);

    const status = await useCase.execute();

    expect(status.pendingCandidates).toBe(1);
    expect(status.runtime).toMatchObject({
      state: EScanControlState.STOPPING,
      queues: { control: { active: 1 }, head: { active: 1 } },
    });
  });
});
