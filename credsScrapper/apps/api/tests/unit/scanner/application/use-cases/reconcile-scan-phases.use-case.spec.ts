import { ReconcileScanPhasesUseCase } from '../../../../../src/modules/scanner/application/use-cases/reconcile-scan-phases.use-case';
import { EScanControlState } from '../../../../../src/modules/scanner/domain/constant/scan-control.constant';
import {
  EScanPhase,
  EScanPhaseStatus,
} from '../../../../../src/modules/scanner/domain/constant/scan-phase.constant';
import { FakeScanJobQueue } from '../../fakes/fake-scan-job-queue';
import { FakeStateRepository } from '../../fakes/fake-state-repository';
import { WorkdirJoinerPort } from '../../../../../src/modules/scanner/application/ports/workdir-joiner.port';
import { JobQueuePort } from '../../../../../src/modules/scanner/application/ports/job-queue.port';

const joiner = {
  join: (...parts: string[]) => parts.join('/'),
} as WorkdirJoinerPort;

describe('ReconcileScanPhasesUseCase', () => {
  it('cancels an old pending HISTORY phase instead of upgrading its epoch', async () => {
    const state = new FakeStateRepository();
    await state.startRepoScan(1, 'local', 'fixture', 0);
    await state.schedulePhase(1, EScanPhase.HISTORY, 'a'.repeat(40), 0);
    const jobs = new FakeScanJobQueue();
    jest.spyOn(jobs as JobQueuePort, 'readScanControl').mockResolvedValue({
      epoch: 1,
      state: EScanControlState.READY,
      stopEpoch: null,
      requestedAt: null,
      finishedAt: null,
    });

    const count = await new ReconcileScanPhasesUseCase(
      state,
      jobs,
      joiner,
    ).execute('workdir');

    expect(count).toBe(0);
    expect(jobs.enqueued).toHaveLength(0);
    expect(await state.getPhase(1, EScanPhase.HISTORY)).toMatchObject({
      status: EScanPhaseStatus.CANCELLED,
      scanEpoch: 0,
    });
  });

  it('enqueues only current pending HISTORY with its persisted epoch', async () => {
    const state = new FakeStateRepository();
    await state.startRepoScan(1, 'local', 'fixture', 7);
    await state.schedulePhase(1, EScanPhase.HISTORY, 'a'.repeat(40), 7);
    const jobs = new FakeScanJobQueue();
    jest.spyOn(jobs as JobQueuePort, 'readScanControl').mockResolvedValue({
      epoch: 7,
      state: EScanControlState.READY,
      stopEpoch: null,
      requestedAt: null,
      finishedAt: null,
    });

    const count = await new ReconcileScanPhasesUseCase(
      state,
      jobs,
      joiner,
    ).execute('workdir');

    expect(count).toBe(1);
    expect(jobs.enqueued[0].payload).toMatchObject({
      payload: { scanEpoch: 7 },
    });
  });

  it('does not enqueue during STOPPING or swallow control-read failures', async () => {
    const state = new FakeStateRepository();
    await state.startRepoScan(1, 'local', 'fixture', 7);
    await state.schedulePhase(1, EScanPhase.HISTORY, 'a'.repeat(40), 7);
    const jobs = new FakeScanJobQueue();
    const control = jest
      .spyOn(jobs as JobQueuePort, 'readScanControl')
      .mockResolvedValue({
        epoch: 7,
        state: EScanControlState.STOPPING,
        stopEpoch: 7,
        requestedAt: new Date(0).toISOString(),
        finishedAt: null,
      });
    const useCase = new ReconcileScanPhasesUseCase(state, jobs, joiner);

    expect(await useCase.execute('workdir')).toBe(0);
    expect(jobs.enqueued).toHaveLength(0);
    control.mockRejectedValue(new Error('control unavailable'));
    await expect(useCase.execute('workdir')).rejects.toThrow(
      'control unavailable',
    );
  });
});
