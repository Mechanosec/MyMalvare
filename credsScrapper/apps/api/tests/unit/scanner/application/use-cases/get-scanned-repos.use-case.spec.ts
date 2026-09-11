import { GetScannedReposUseCase } from '../../../../../src/modules/scanner/application/use-cases/get-scanned-repos.use-case';
import { FakeStateRepository } from '../../fakes/fake-state-repository';

describe('GetScannedReposUseCase', () => {
  it('delegates to the state repository', async () => {
    const state = new FakeStateRepository();
    await state.addCandidate(1, 'octocat', 'repo');
    await state.claimNext();
    await state.markDone(1);
    const useCase = new GetScannedReposUseCase(state);

    const repos = await useCase.execute();

    expect(repos).toEqual([
      expect.objectContaining({ repoId: 1, owner: 'octocat', name: 'repo' }),
    ]);
  });
});
