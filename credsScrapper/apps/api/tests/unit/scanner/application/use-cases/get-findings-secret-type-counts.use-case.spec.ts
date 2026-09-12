import { GetFindingsSecretTypeCountsUseCase } from '../../../../../src/modules/scanner/application/use-cases/get-findings-secret-type-counts.use-case';
import { ESecretType } from '../../../../../src/modules/scanner/domain/constant/secret-type.constant';
import { FakeStateRepository } from '../../fakes/fake-state-repository';

describe('GetFindingsSecretTypeCountsUseCase', () => {
  it('counts findings per secret type', async () => {
    const state = new FakeStateRepository();
    await state.addFinding(1, 'octocat', 'repo', 'a.py', 'sha', ESecretType.AWS_ACCESS_KEY_ID, 'v', 1, null);
    await state.addFinding(1, 'octocat', 'repo', 'b.py', 'sha', ESecretType.AWS_ACCESS_KEY_ID, 'v', 1, null);
    await state.addFinding(1, 'octocat', 'repo', 'c.py', 'sha', ESecretType.GITHUB_PAT, 'v', 1, null);
    const useCase = new GetFindingsSecretTypeCountsUseCase(state);

    const counts = await useCase.execute();

    expect(counts).toContainEqual({ secretType: ESecretType.AWS_ACCESS_KEY_ID, count: 2 });
    expect(counts).toContainEqual({ secretType: ESecretType.GITHUB_PAT, count: 1 });
  });

  it('defaults to 0 for every secret type with no findings, covering the full enum', async () => {
    const state = new FakeStateRepository();
    const useCase = new GetFindingsSecretTypeCountsUseCase(state);

    const counts = await useCase.execute();

    expect(counts).toHaveLength(Object.values(ESecretType).length);
    expect(counts).toContainEqual({ secretType: ESecretType.STRIPE_LIVE_SECRET_KEY, count: 0 });
  });

  it('scopes counts to a single repo when repoId is given', async () => {
    const state = new FakeStateRepository();
    await state.addFinding(1, 'octocat', 'repo', 'a.py', 'sha', ESecretType.AWS_ACCESS_KEY_ID, 'v', 1, null);
    await state.addFinding(2, 'octocat', 'other', 'b.py', 'sha', ESecretType.AWS_ACCESS_KEY_ID, 'v', 1, null);
    await state.addFinding(1, 'octocat', 'repo', 'c.py', 'sha', ESecretType.GITHUB_PAT, 'v', 1, null);
    const useCase = new GetFindingsSecretTypeCountsUseCase(state);

    const counts = await useCase.execute(1);

    expect(counts).toContainEqual({ secretType: ESecretType.AWS_ACCESS_KEY_ID, count: 1 });
    expect(counts).toContainEqual({ secretType: ESecretType.GITHUB_PAT, count: 1 });
  });
});
