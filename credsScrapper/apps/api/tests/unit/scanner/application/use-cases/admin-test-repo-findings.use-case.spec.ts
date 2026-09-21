import { AdminTestRepoFindingsUseCase } from '../../../../../src/modules/scanner/application/use-cases/admin-test-repo-findings.use-case';
import { StateRepositoryPort } from '../../../../../src/modules/scanner/application/ports/state-repository.port';
import { KeyValidatorPort } from '../../../../../src/modules/scanner/application/ports/key-validator.port';
import { EFindingStatus } from '../../../../../src/modules/scanner/domain/constant/finding-status.constant';
import { ESecretType } from '../../../../../src/modules/scanner/domain/constant/secret-type.constant';

function makeFinding(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    repoId: 10,
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

describe('AdminTestRepoFindingsUseCase', () => {
  it('validates every finding for the repo and returns the refreshed list, with no authorization check', async () => {
    const finding = makeFinding();
    const state = {
      listFindings: jest
        .fn()
        .mockResolvedValueOnce({ items: [finding], total: 1 })
        .mockResolvedValueOnce({ items: [{ ...finding, status: EFindingStatus.VALID }], total: 1 }),
      recordTestResult: jest.fn(),
    } as unknown as StateRepositoryPort;
    const validator = { validateDetailed: jest.fn().mockResolvedValue({ status: EFindingStatus.VALID, reason: null }) } as unknown as KeyValidatorPort;
    const useCase = new AdminTestRepoFindingsUseCase(state, validator);

    const result = await useCase.execute(10);

    expect(validator.validateDetailed).toHaveBeenCalledWith(ESecretType.TELEGRAM_BOT_TOKEN, 'fake-token', undefined);
    expect(state.recordTestResult).toHaveBeenCalledWith(1, EFindingStatus.VALID, null);
    expect(result).toEqual([{ ...finding, status: EFindingStatus.VALID }]);
  });

  it('pairs an AWS access key ID with the AWS secret key already in the fetched findings, no extra query', async () => {
    const accessKey = makeFinding({ id: 1, secretType: ESecretType.AWS_ACCESS_KEY_ID, secretValue: 'AKIAFAKE' });
    const secretKey = makeFinding({
      id: 2,
      secretType: ESecretType.AWS_SECRET_ACCESS_KEY,
      secretValue: 'b'.repeat(40),
    });
    const state = {
      listFindings: jest
        .fn()
        .mockResolvedValueOnce({ items: [accessKey, secretKey], total: 2 })
        .mockResolvedValueOnce({ items: [accessKey, secretKey], total: 2 }),
      recordTestResult: jest.fn(),
    } as unknown as StateRepositoryPort;
    const validator = { validateDetailed: jest.fn().mockResolvedValue({ status: EFindingStatus.VALID, reason: null }) } as unknown as KeyValidatorPort;
    const useCase = new AdminTestRepoFindingsUseCase(state, validator);

    await useCase.execute(10);

    expect(state.listFindings).toHaveBeenCalledTimes(2);
    expect(validator.validateDetailed).toHaveBeenCalledWith(ESecretType.AWS_ACCESS_KEY_ID, 'AKIAFAKE', 'b'.repeat(40));
    expect(validator.validateDetailed).toHaveBeenCalledWith(ESecretType.AWS_SECRET_ACCESS_KEY, 'b'.repeat(40), undefined);
  });

  it('is a no-op when the repo has no findings', async () => {
    const state = {
      listFindings: jest.fn().mockResolvedValue({ items: [], total: 0 }),
      recordTestResult: jest.fn(),
    } as unknown as StateRepositoryPort;
    const validator = { validateDetailed: jest.fn() } as unknown as KeyValidatorPort;
    const useCase = new AdminTestRepoFindingsUseCase(state, validator);

    const result = await useCase.execute(10);

    expect(result).toEqual([]);
    expect(validator.validateDetailed).not.toHaveBeenCalled();
  });
});
