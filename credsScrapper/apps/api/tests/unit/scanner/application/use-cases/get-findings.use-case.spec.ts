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

    const findings = await useCase.execute({});

    expect(findings).toHaveLength(1);
    expect(findings[0].secretType).toBe(ESecretType.AWS_ACCESS_KEY_ID);
  });
});
