import { GetFindingsUseCase } from '../../../../../src/modules/scanner/application/use-cases/get-findings.use-case';
import { ESecretType } from '../../../../../src/modules/scanner/domain/constant/secret-type.constant';
import { FakeStateRepository } from '../../fakes/fake-state-repository';

describe('GetFindingsUseCase', () => {
  it('delegates to the state repository', async () => {
    const state = new FakeStateRepository();
    await state.addFinding(
      1,
      'octocat',
      'repo',
      'config.py',
      'sha',
      ESecretType.AWS_ACCESS_KEY_ID,
      'AKIAABCDEFGH12345678',
      1,
      null,
    );
    const useCase = new GetFindingsUseCase(state);

    const page = await useCase.execute({});

    expect(page.total).toBe(1);
    expect(page.items).toHaveLength(1);
    expect(page.items[0].secretType).toBe(ESecretType.AWS_ACCESS_KEY_ID);
  });

  it('reports total independent of limit/offset, for pagination', async () => {
    const state = new FakeStateRepository();
    for (let i = 0; i < 5; i += 1) {
      await state.addFinding(
        1,
        'octocat',
        'repo',
        'config.py',
        'sha',
        ESecretType.AWS_ACCESS_KEY_ID,
        'AKIAABCDEFGH12345678',
        1,
        null,
      );
    }
    const useCase = new GetFindingsUseCase(state);

    const page = await useCase.execute({ limit: 2, offset: 0 });

    expect(page.items).toHaveLength(2);
    expect(page.total).toBe(5);
  });

  it('filters by multiple secret types at once', async () => {
    const state = new FakeStateRepository();
    await state.addFinding(1, 'octocat', 'repo', 'a.py', 'sha', ESecretType.AWS_ACCESS_KEY_ID, 'v', 1, null);
    await state.addFinding(1, 'octocat', 'repo', 'b.py', 'sha', ESecretType.GITHUB_PAT, 'v', 1, null);
    await state.addFinding(1, 'octocat', 'repo', 'c.py', 'sha', ESecretType.GENERIC_HIGH_ENTROPY, 'v', 1, null);
    const useCase = new GetFindingsUseCase(state);

    const page = await useCase.execute({
      secretTypes: [ESecretType.AWS_ACCESS_KEY_ID, ESecretType.GITHUB_PAT],
    });

    expect(page.total).toBe(2);
  });

  it('filters by repoIds', async () => {
    const state = new FakeStateRepository();
    await state.addFinding(1, 'octocat', 'repo1', 'a.py', 'sha', ESecretType.AWS_ACCESS_KEY_ID, 'v', 1, null);
    await state.addFinding(2, 'octocat', 'repo2', 'b.py', 'sha', ESecretType.AWS_ACCESS_KEY_ID, 'v', 1, null);
    const useCase = new GetFindingsUseCase(state);

    const page = await useCase.execute({ repoIds: [2] });

    expect(page.total).toBe(1);
    expect(page.items[0].repoId).toBe(2);
  });

  it('searches across owner/name, file path, and context', async () => {
    const state = new FakeStateRepository();
    await state.addFinding(1, 'octocat', 'hello-world', 'config.py', 'sha', ESecretType.AWS_ACCESS_KEY_ID, 'v', 1, null);
    await state.addFinding(2, 'someone', 'unrelated', 'app.py', 'sha', ESecretType.AWS_ACCESS_KEY_ID, 'v', 1, null);
    const useCase = new GetFindingsUseCase(state);

    const page = await useCase.execute({ search: 'octocat/hello' });

    expect(page.total).toBe(1);
    expect(page.items[0].repoId).toBe(1);
  });
});
