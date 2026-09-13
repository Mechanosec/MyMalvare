import { GetFindingsStatusCountsUseCase } from '../../../../../src/modules/scanner/application/use-cases/get-findings-status-counts.use-case';
import { EFindingStatus } from '../../../../../src/modules/scanner/domain/constant/finding-status.constant';
import { ESecretType } from '../../../../../src/modules/scanner/domain/constant/secret-type.constant';
import { FakeStateRepository } from '../../fakes/fake-state-repository';

describe('GetFindingsStatusCountsUseCase', () => {
  it('counts findings per status', async () => {
    const state = new FakeStateRepository();
    await state.addFinding(1, 'octocat', 'repo', 'a.py', 'sha', ESecretType.AWS_ACCESS_KEY_ID, 'v', 1, null);
    await state.addFinding(1, 'octocat', 'repo', 'b.py', 'sha', ESecretType.AWS_ACCESS_KEY_ID, 'v', 1, null);
    await state.updateFindingStatus(0, EFindingStatus.VALID);
    const useCase = new GetFindingsStatusCountsUseCase(state);

    const counts = await useCase.execute();

    expect(counts).toContainEqual({ status: EFindingStatus.VALID, count: 1 });
    expect(counts).toContainEqual({ status: EFindingStatus.UNKNOWN, count: 1 });
  });

  it('defaults to 0 for every status with no findings, covering the full enum', async () => {
    const state = new FakeStateRepository();
    const useCase = new GetFindingsStatusCountsUseCase(state);

    const counts = await useCase.execute();

    expect(counts).toHaveLength(Object.values(EFindingStatus).length);
    expect(counts).toContainEqual({ status: EFindingStatus.INVALID, count: 0 });
  });

  it('scopes counts to a single repo when repoId is given', async () => {
    const state = new FakeStateRepository();
    await state.addFinding(1, 'octocat', 'repo', 'a.py', 'sha', ESecretType.AWS_ACCESS_KEY_ID, 'v', 1, null);
    await state.addFinding(2, 'octocat', 'other', 'b.py', 'sha', ESecretType.AWS_ACCESS_KEY_ID, 'v', 1, null);
    const useCase = new GetFindingsStatusCountsUseCase(state);

    const counts = await useCase.execute(1);

    expect(counts).toContainEqual({ status: EFindingStatus.UNKNOWN, count: 1 });
  });

  it('restricts counts to the given secret types when provided', async () => {
    const state = new FakeStateRepository();
    await state.addFinding(1, 'octocat', 'repo', 'a.py', 'sha', ESecretType.AWS_ACCESS_KEY_ID, 'v', 1, null);
    await state.addFinding(1, 'octocat', 'repo', 'b.py', 'sha', ESecretType.GITHUB_PAT, 'v', 1, null);
    const useCase = new GetFindingsStatusCountsUseCase(state);

    const counts = await useCase.execute(1, [ESecretType.GITHUB_PAT]);

    expect(counts).toContainEqual({ status: EFindingStatus.UNKNOWN, count: 1 });
  });
});
