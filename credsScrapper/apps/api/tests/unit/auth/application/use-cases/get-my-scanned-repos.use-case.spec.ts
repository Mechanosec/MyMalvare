import { GetMyScannedReposUseCase } from '../../../../../src/modules/auth/application/use-cases/get-my-scanned-repos.use-case';
import { RepoAuthorizationRepositoryPort } from '../../../../../src/modules/auth/application/ports/repo-authorization-repository.port';
import { ERepoAuthorizationStatus } from '../../../../../src/modules/auth/domain/constant/repo-authorization-status.constant';
import { StateRepositoryPort } from '../../../../../src/modules/scanner/application/ports/state-repository.port';
import { EScanStatus } from '../../../../../src/modules/scanner/domain/constant/scan-status.constant';

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

function makeScannedRepo(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    repoId: 42,
    owner: 'acme',
    name: 'widgets',
    status: EScanStatus.DONE,
    lastCommitSha: 'abc123',
    startedAt: new Date(),
    scannedAt: new Date(),
    failReason: null,
    retryCount: 0,
    findingsCount: 1,
    ...overrides,
  };
}

describe('GetMyScannedReposUseCase', () => {
  it('returns an empty list when the user has no approved repos', async () => {
    const authorizations = {
      listByUser: jest.fn().mockResolvedValue([makeApproval({ status: ERepoAuthorizationStatus.PENDING })]),
    } as unknown as RepoAuthorizationRepositoryPort;
    const state = { listScannedRepos: jest.fn() } as unknown as StateRepositoryPort;
    const useCase = new GetMyScannedReposUseCase(authorizations, state);

    const result = await useCase.execute(1);

    expect(result).toEqual([]);
    expect(state.listScannedRepos).not.toHaveBeenCalled();
  });

  it('filters the scanned-repos list down to the caller\'s own approved owner/name pairs, case-insensitively', async () => {
    const authorizations = {
      listByUser: jest.fn().mockResolvedValue([makeApproval({ owner: 'Acme', name: 'Widgets' })]),
    } as unknown as RepoAuthorizationRepositoryPort;
    const state = {
      listScannedRepos: jest.fn().mockResolvedValue([
        makeScannedRepo({ repoId: 42, owner: 'acme', name: 'widgets' }),
        makeScannedRepo({ repoId: 99, owner: 'someone-else', name: 'other-repo' }),
      ]),
    } as unknown as StateRepositoryPort;
    const useCase = new GetMyScannedReposUseCase(authorizations, state);

    const result = await useCase.execute(1);

    expect(result).toEqual([expect.objectContaining({ repoId: 42 })]);
  });
});
