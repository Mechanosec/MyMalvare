import { AdminTestFindingUseCase } from '../../../../../src/modules/scanner/application/use-cases/admin-test-finding.use-case';
import { StateRepositoryPort } from '../../../../../src/modules/scanner/application/ports/state-repository.port';
import { KeyValidatorPort } from '../../../../../src/modules/scanner/application/ports/key-validator.port';
import { EFindingStatus } from '../../../../../src/modules/scanner/domain/constant/finding-status.constant';
import { ESecretType } from '../../../../../src/modules/scanner/domain/constant/secret-type.constant';

function makeFinding(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 10,
    repoId: 42,
    owner: 'acme',
    name: 'widgets',
    filePath: 'a.py',
    commitSha: 'sha',
    secretType: ESecretType.TELEGRAM_BOT_TOKEN,
    secretValue: 'fake-token',
    lineNumber: 1,
    context: null,
    foundAt: new Date(),
    status: EFindingStatus.UNKNOWN,
    checkedAt: null,
    leakCommits: [],
    ...overrides,
  };
}

describe('AdminTestFindingUseCase', () => {
  it('returns null when the finding does not exist, with no authorization check', async () => {
    const state = {
      getFindingById: jest.fn().mockResolvedValue(null),
      recordTestResult: jest.fn(),
    } as unknown as StateRepositoryPort;
    const validator = { validate: jest.fn() } as unknown as KeyValidatorPort;
    const useCase = new AdminTestFindingUseCase(state, validator);

    const result = await useCase.execute(10);

    expect(result).toBeNull();
    expect(validator.validate).not.toHaveBeenCalled();
  });

  it('validates the finding and persists the result regardless of repo ownership', async () => {
    const finding = makeFinding();
    const state = {
      getFindingById: jest.fn().mockResolvedValue(finding),
      recordTestResult: jest.fn(),
    } as unknown as StateRepositoryPort;
    const validator = { validate: jest.fn().mockResolvedValue(EFindingStatus.VALID) } as unknown as KeyValidatorPort;
    const useCase = new AdminTestFindingUseCase(state, validator);

    const result = await useCase.execute(10);

    expect(validator.validate).toHaveBeenCalledWith(ESecretType.TELEGRAM_BOT_TOKEN, 'fake-token');
    expect(state.recordTestResult).toHaveBeenCalledWith(10, EFindingStatus.VALID);
    expect(result).toMatchObject({ id: 10, status: EFindingStatus.VALID });
    expect(result?.checkedAt).toBeInstanceOf(Date);
  });
});
