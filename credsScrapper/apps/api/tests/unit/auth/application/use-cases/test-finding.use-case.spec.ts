import { TestFindingUseCase } from '../../../../../src/modules/auth/application/use-cases/test-finding.use-case';
import { RepoAuthorizationRepositoryPort } from '../../../../../src/modules/auth/application/ports/repo-authorization-repository.port';
import { ERepoAuthorizationStatus } from '../../../../../src/modules/auth/domain/constant/repo-authorization-status.constant';
import { StateRepositoryPort } from '../../../../../src/modules/scanner/application/ports/state-repository.port';
import { KeyValidatorPort } from '../../../../../src/modules/scanner/application/ports/key-validator.port';
import { EFindingStatus } from '../../../../../src/modules/scanner/domain/constant/finding-status.constant';
import { ESecretType } from '../../../../../src/modules/scanner/domain/constant/secret-type.constant';

function makeApproval(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    userId: 1,
    owner: 'acme',
    name: 'widgets',
    note: null,
    status: ERepoAuthorizationStatus.APPROVED,
    adminNote: null,
    createdAt: new Date(),
    decidedAt: new Date(),
    decidedByUserId: 2,
    ...overrides,
  };
}

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

describe('TestFindingUseCase', () => {
  it('returns null when the finding does not exist', async () => {
    const authorizations = {
      listByUser: jest.fn(),
    } as unknown as RepoAuthorizationRepositoryPort;
    const state = {
      getFindingById: jest.fn().mockResolvedValue(null),
      recordTestResult: jest.fn(),
    } as unknown as StateRepositoryPort;
    const validator = {
      validateDetailed: jest.fn(),
    } as unknown as KeyValidatorPort;
    const useCase = new TestFindingUseCase(authorizations, state, validator);

    const result = await useCase.execute(1, 10);

    expect(result).toBeNull();
    expect(validator.validateDetailed).not.toHaveBeenCalled();
  });

  it("returns null when the user has no approved authorization for the finding's repo", async () => {
    const authorizations = {
      listByUser: jest
        .fn()
        .mockResolvedValue([
          makeApproval({ status: ERepoAuthorizationStatus.PENDING }),
        ]),
    } as unknown as RepoAuthorizationRepositoryPort;
    const state = {
      getFindingById: jest.fn().mockResolvedValue(makeFinding()),
      recordTestResult: jest.fn(),
    } as unknown as StateRepositoryPort;
    const validator = {
      validateDetailed: jest.fn(),
    } as unknown as KeyValidatorPort;
    const useCase = new TestFindingUseCase(authorizations, state, validator);

    const result = await useCase.execute(1, 10);

    expect(result).toBeNull();
    expect(validator.validateDetailed).not.toHaveBeenCalled();
  });

  it("returns null when the finding isn't among the caller's own approved-repo findings", async () => {
    const authorizations = {
      listByUser: jest.fn().mockResolvedValue([makeApproval()]),
    } as unknown as RepoAuthorizationRepositoryPort;
    const state = {
      getFindingById: jest
        .fn()
        .mockResolvedValue(
          makeFinding({ owner: 'someone-else', name: 'other-repo' }),
        ),
      recordTestResult: jest.fn(),
    } as unknown as StateRepositoryPort;
    const validator = {
      validateDetailed: jest.fn(),
    } as unknown as KeyValidatorPort;
    const useCase = new TestFindingUseCase(authorizations, state, validator);

    const result = await useCase.execute(1, 10);

    expect(result).toBeNull();
    expect(validator.validateDetailed).not.toHaveBeenCalled();
  });

  it('validates the finding and persists the result when it is in one of the approved repos', async () => {
    const finding = makeFinding();
    const authorizations = {
      listByUser: jest.fn().mockResolvedValue([makeApproval()]),
    } as unknown as RepoAuthorizationRepositoryPort;
    const state = {
      getFindingById: jest.fn().mockResolvedValue(finding),
      recordTestResult: jest.fn(),
    } as unknown as StateRepositoryPort;
    const validator = {
      validateDetailed: jest
        .fn()
        .mockResolvedValue({ status: EFindingStatus.VALID, reason: null }),
    } as unknown as KeyValidatorPort;
    const useCase = new TestFindingUseCase(authorizations, state, validator);

    const result = await useCase.execute(1, 10);

    expect(validator.validateDetailed).toHaveBeenCalledWith(
      ESecretType.TELEGRAM_BOT_TOKEN,
      'fake-token',
      undefined,
    );
    expect(state.recordTestResult).toHaveBeenCalledWith(
      10,
      EFindingStatus.VALID,
      null,
    );
    expect(result).toMatchObject({ id: 10, status: EFindingStatus.VALID });
    expect(result?.checkedAt).toBeInstanceOf(Date);
  });

  it('does not pair an orphan AWS ID with an unrelated repository secret', async () => {
    const finding = makeFinding({
      secretType: ESecretType.AWS_ACCESS_KEY_ID,
      secretValue: 'AKIAFAKE',
    });
    const authorizations = {
      listByUser: jest.fn().mockResolvedValue([makeApproval()]),
    } as unknown as RepoAuthorizationRepositoryPort;
    const state = {
      getFindingById: jest.fn().mockResolvedValue(finding),
      recordTestResult: jest.fn(),
      listFindings: jest
        .fn()
        .mockResolvedValue({
          items: [{ secretValue: 'b'.repeat(40) }],
          total: 1,
        }),
    } as unknown as StateRepositoryPort;
    const validator = {
      validateDetailed: jest
        .fn()
        .mockResolvedValue({ status: EFindingStatus.VALID, reason: null }),
    } as unknown as KeyValidatorPort;
    const useCase = new TestFindingUseCase(authorizations, state, validator);

    await useCase.execute(1, 10);

    expect(state.listFindings).not.toHaveBeenCalled();
    expect(validator.validateDetailed).toHaveBeenCalledWith(
      ESecretType.AWS_ACCESS_KEY_ID,
      'AKIAFAKE',
      undefined,
    );
  });
});
