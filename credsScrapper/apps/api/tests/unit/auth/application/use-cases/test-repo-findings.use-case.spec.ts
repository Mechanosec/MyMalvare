import { TestRepoFindingsUseCase } from '../../../../../src/modules/auth/application/use-cases/test-repo-findings.use-case';
import { RepoAuthorizationRepositoryPort } from '../../../../../src/modules/auth/application/ports/repo-authorization-repository.port';
import { ERepoAuthorizationStatus } from '../../../../../src/modules/auth/domain/constant/repo-authorization-status.constant';
import { StateRepositoryPort } from '../../../../../src/modules/scanner/application/ports/state-repository.port';
import { KeyValidatorPort } from '../../../../../src/modules/scanner/application/ports/key-validator.port';
import { EFindingStatus } from '../../../../../src/modules/scanner/domain/constant/finding-status.constant';
import { ESecretType } from '../../../../../src/modules/scanner/domain/constant/secret-type.constant';

function makeFinding(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    repoId: 10,
    owner: 'Acme',
    name: 'Widgets',
    filePath: 'a.py',
    commitSha: 'sha',
    secretType: ESecretType.TELEGRAM_BOT_TOKEN,
    secretValue: 'fake-token',
    lineNumber: 1,
    context: null,
    foundAt: new Date(),
    status: EFindingStatus.UNKNOWN,
    leakCommits: ['sha'],
    ...overrides,
  };
}

describe('TestRepoFindingsUseCase', () => {
  it('returns null when the user has no approved authorization for the repo', async () => {
    const finding = makeFinding();
    const state = {
      listFindings: jest.fn().mockResolvedValue({ items: [finding], total: 1 }),
      updateFindingStatus: jest.fn(),
    } as unknown as StateRepositoryPort;
    const authorizations = {
      listByUser: jest.fn().mockResolvedValue([
        { id: 1, userId: 1, owner: 'acme', name: 'widgets', note: null, status: ERepoAuthorizationStatus.PENDING, adminNote: null, createdAt: new Date(), decidedAt: null, decidedByUserId: null },
      ]),
    } as unknown as RepoAuthorizationRepositoryPort;
    const validator = { validate: jest.fn() } as unknown as KeyValidatorPort;
    const useCase = new TestRepoFindingsUseCase(authorizations, state, validator);

    const result = await useCase.execute(1, 10);

    expect(result).toBeNull();
    expect(validator.validate).not.toHaveBeenCalled();
  });

  it('validates each finding and persists the resulting status when the repo is approved', async () => {
    const finding = makeFinding();
    const state = {
      listFindings: jest
        .fn()
        .mockResolvedValueOnce({ items: [finding], total: 1 })
        .mockResolvedValueOnce({ items: [{ ...finding, status: EFindingStatus.VALID }], total: 1 }),
      updateFindingStatus: jest.fn(),
    } as unknown as StateRepositoryPort;
    const authorizations = {
      listByUser: jest.fn().mockResolvedValue([
        { id: 1, userId: 1, owner: 'acme', name: 'widgets', note: null, status: ERepoAuthorizationStatus.APPROVED, adminNote: null, createdAt: new Date(), decidedAt: new Date(), decidedByUserId: 2 },
      ]),
    } as unknown as RepoAuthorizationRepositoryPort;
    const validator = { validate: jest.fn().mockResolvedValue(EFindingStatus.VALID) } as unknown as KeyValidatorPort;
    const useCase = new TestRepoFindingsUseCase(authorizations, state, validator);

    const result = await useCase.execute(1, 10);

    expect(validator.validate).toHaveBeenCalledWith(ESecretType.TELEGRAM_BOT_TOKEN, 'fake-token');
    expect(state.updateFindingStatus).toHaveBeenCalledWith(1, EFindingStatus.VALID);
    expect(result).toEqual([{ ...finding, status: EFindingStatus.VALID }]);
  });

  it('returns an empty array without checking authorization when the repo has no findings', async () => {
    const state = {
      listFindings: jest.fn().mockResolvedValue({ items: [], total: 0 }),
      updateFindingStatus: jest.fn(),
    } as unknown as StateRepositoryPort;
    const authorizations = { listByUser: jest.fn() } as unknown as RepoAuthorizationRepositoryPort;
    const validator = { validate: jest.fn() } as unknown as KeyValidatorPort;
    const useCase = new TestRepoFindingsUseCase(authorizations, state, validator);

    const result = await useCase.execute(1, 10);

    expect(result).toEqual([]);
    expect(authorizations.listByUser).not.toHaveBeenCalled();
  });
});
