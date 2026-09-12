import { GetFindingsRepoOptionsUseCase } from '../../../../../src/modules/scanner/application/use-cases/get-findings-repo-options.use-case';
import { ESecretType } from '../../../../../src/modules/scanner/domain/constant/secret-type.constant';
import { FakeStateRepository } from '../../fakes/fake-state-repository';

describe('GetFindingsRepoOptionsUseCase', () => {
  it('delegates to the state repository', async () => {
    const state = new FakeStateRepository();
    await state.addFinding(1, 'octocat', 'repo', 'a.py', 'sha', ESecretType.AWS_ACCESS_KEY_ID, 'v', 1, null);
    const useCase = new GetFindingsRepoOptionsUseCase(state);

    const options = await useCase.execute();

    expect(options).toEqual([{ repoId: 1, owner: 'octocat', name: 'repo', count: 1 }]);
  });

  it('counts every finding for a repo, not just the first', async () => {
    const state = new FakeStateRepository();
    await state.addFinding(1, 'octocat', 'repo', 'a.py', 'sha', ESecretType.AWS_ACCESS_KEY_ID, 'v', 1, null);
    await state.addFinding(1, 'octocat', 'repo', 'b.py', 'sha', ESecretType.GITHUB_PAT, 'v', 1, null);
    const useCase = new GetFindingsRepoOptionsUseCase(state);

    const options = await useCase.execute();

    expect(options).toEqual([{ repoId: 1, owner: 'octocat', name: 'repo', count: 2 }]);
  });

  it('defaults the limit to 500 when none is given', async () => {
    const state = new FakeStateRepository();
    for (let i = 1; i <= 3; i += 1) {
      await state.addFinding(i, 'octocat', `repo${i}`, 'a.py', 'sha', ESecretType.AWS_ACCESS_KEY_ID, 'v', 1, null);
    }
    const useCase = new GetFindingsRepoOptionsUseCase(state);

    const options = await useCase.execute();

    expect(options).toHaveLength(3);
  });
});
