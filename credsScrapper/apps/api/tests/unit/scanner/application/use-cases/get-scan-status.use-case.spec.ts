import { GetScanStatusUseCase } from '../../../../../src/modules/scanner/application/use-cases/get-scan-status.use-case';
import { FakeStateRepository } from '../../fakes/fake-state-repository';

describe('GetScanStatusUseCase', () => {
  it('delegates to the state repository', async () => {
    const state = new FakeStateRepository();
    await state.addCandidate(1, 'octocat', 'repo');
    const useCase = new GetScanStatusUseCase(state);

    const status = await useCase.execute();

    expect(status.pendingCandidates).toBe(1);
  });
});
