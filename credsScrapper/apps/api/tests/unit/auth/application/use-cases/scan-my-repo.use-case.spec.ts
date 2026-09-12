import { ScanMyRepoUseCase } from '../../../../../src/modules/auth/application/use-cases/scan-my-repo.use-case';
import { RepoAuthorizationRepositoryPort } from '../../../../../src/modules/auth/application/ports/repo-authorization-repository.port';
import { ERepoAuthorizationStatus } from '../../../../../src/modules/auth/domain/constant/repo-authorization-status.constant';
import { StateRepositoryPort } from '../../../../../src/modules/scanner/application/ports/state-repository.port';
import { GithubRepoLookupPort } from '../../../../../src/modules/scanner/application/ports/github-repo-lookup.port';
import { WorkdirJoinerPort } from '../../../../../src/modules/scanner/application/ports/workdir-joiner.port';
import { ScanRepositoryUseCase } from '../../../../../src/modules/scanner/application/use-cases/scan-repository.use-case';

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

describe('ScanMyRepoUseCase', () => {
  it('returns null when the user has no approved authorization for the repo', async () => {
    const authorizations = {
      listByUser: jest.fn().mockResolvedValue([makeApproval({ status: ERepoAuthorizationStatus.PENDING })]),
    } as unknown as RepoAuthorizationRepositoryPort;
    const state = { startRepoScan: jest.fn() } as unknown as StateRepositoryPort;
    const githubLookup = { resolveRepoId: jest.fn() } as unknown as GithubRepoLookupPort;
    const scanRepository = { execute: jest.fn() } as unknown as ScanRepositoryUseCase;
    const workdirJoiner = { join: jest.fn(), ensureDir: jest.fn() } as unknown as WorkdirJoinerPort;
    const useCase = new ScanMyRepoUseCase(authorizations, state, githubLookup, scanRepository, workdirJoiner);

    const result = await useCase.execute(1, 'acme', 'widgets');

    expect(result).toBeNull();
    expect(githubLookup.resolveRepoId).not.toHaveBeenCalled();
  });

  it("returns 'not-found' when GitHub has no such repo", async () => {
    const authorizations = {
      listByUser: jest.fn().mockResolvedValue([makeApproval()]),
    } as unknown as RepoAuthorizationRepositoryPort;
    const state = { startRepoScan: jest.fn() } as unknown as StateRepositoryPort;
    const githubLookup = { resolveRepoId: jest.fn().mockResolvedValue(null) } as unknown as GithubRepoLookupPort;
    const scanRepository = { execute: jest.fn() } as unknown as ScanRepositoryUseCase;
    const workdirJoiner = { join: jest.fn(), ensureDir: jest.fn() } as unknown as WorkdirJoinerPort;
    const useCase = new ScanMyRepoUseCase(authorizations, state, githubLookup, scanRepository, workdirJoiner);

    const result = await useCase.execute(1, 'acme', 'widgets');

    expect(result).toBe('not-found');
    expect(state.startRepoScan).not.toHaveBeenCalled();
  });

  it('starts the scan for exactly the resolved repo when approved and found', async () => {
    const authorizations = {
      listByUser: jest.fn().mockResolvedValue([makeApproval({ owner: 'Acme', name: 'Widgets' })]),
    } as unknown as RepoAuthorizationRepositoryPort;
    const state = { startRepoScan: jest.fn() } as unknown as StateRepositoryPort;
    const githubLookup = { resolveRepoId: jest.fn().mockResolvedValue(42) } as unknown as GithubRepoLookupPort;
    const scanRepository = { execute: jest.fn() } as unknown as ScanRepositoryUseCase;
    const workdirJoiner = {
      join: jest.fn().mockReturnValue('workdir/repo-42'),
      ensureDir: jest.fn(),
    } as unknown as WorkdirJoinerPort;
    const useCase = new ScanMyRepoUseCase(authorizations, state, githubLookup, scanRepository, workdirJoiner);

    const result = await useCase.execute(1, 'acme', 'widgets');

    expect(state.startRepoScan).toHaveBeenCalledWith(42, 'acme', 'widgets');
    expect(scanRepository.execute).toHaveBeenCalledWith(
      { repoId: 42, owner: 'acme', name: 'widgets' },
      'https://github.com/acme/widgets.git',
      'workdir/repo-42',
    );
    expect(result).toEqual({ repoId: 42 });
  });
});
