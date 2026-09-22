import { ScanMyRepoUseCase } from '../../../../../src/modules/auth/application/use-cases/scan-my-repo.use-case';
import { RepoAuthorizationRepositoryPort } from '../../../../../src/modules/auth/application/ports/repo-authorization-repository.port';
import { ERepoAuthorizationStatus } from '../../../../../src/modules/auth/domain/constant/repo-authorization-status.constant';
import { StateRepositoryPort } from '../../../../../src/modules/scanner/application/ports/state-repository.port';
import { GithubRepoLookupPort } from '../../../../../src/modules/scanner/application/ports/github-repo-lookup.port';
import { WorkdirJoinerPort } from '../../../../../src/modules/scanner/application/ports/workdir-joiner.port';
import { FakeScanJobQueue } from '../../../scanner/fakes/fake-scan-job-queue';
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

describe('ScanMyRepoUseCase', () => {
  it('returns null when the user has no approved authorization for the repo', async () => {
    const authorizations = {
      listByUser: jest
        .fn()
        .mockResolvedValue([
          makeApproval({ status: ERepoAuthorizationStatus.PENDING }),
        ]),
    } as unknown as RepoAuthorizationRepositoryPort;
    const state = {
      startRepoScan: jest.fn(),
    } as unknown as StateRepositoryPort;
    const githubLookup = {
      resolveRepoId: jest.fn(),
    } as unknown as GithubRepoLookupPort;
    const jobQueue = new FakeScanJobQueue();
    const workdirJoiner = {
      join: jest.fn(),
      ensureDir: jest.fn(),
    } as unknown as WorkdirJoinerPort;
    const useCase = new ScanMyRepoUseCase(
      authorizations,
      state,
      githubLookup,
      jobQueue,
      workdirJoiner,
    );

    const result = await useCase.execute(1, 'acme', 'widgets');

    expect(result).toBeNull();
    expect(githubLookup.resolveRepoId).not.toHaveBeenCalled();
    expect(
      await useCase.execute(
        1,
        'acme',
        'widgets',
        ESecretType.GCP_SERVICE_ACCOUNT_KEY,
      ),
    ).toBeNull();
    expect(jobQueue.enqueued).toHaveLength(0);
  });

  it("returns 'not-found' when GitHub has no such repo", async () => {
    const authorizations = {
      listByUser: jest.fn().mockResolvedValue([makeApproval()]),
    } as unknown as RepoAuthorizationRepositoryPort;
    const state = {
      startRepoScan: jest.fn(),
    } as unknown as StateRepositoryPort;
    const githubLookup = {
      resolveRepoId: jest.fn().mockResolvedValue(null),
    } as unknown as GithubRepoLookupPort;
    const jobQueue = new FakeScanJobQueue();
    const workdirJoiner = {
      join: jest.fn(),
      ensureDir: jest.fn(),
    } as unknown as WorkdirJoinerPort;
    const useCase = new ScanMyRepoUseCase(
      authorizations,
      state,
      githubLookup,
      jobQueue,
      workdirJoiner,
    );

    const result = await useCase.execute(1, 'acme', 'widgets');

    expect(result).toBe('not-found');
    expect(state.startRepoScan).not.toHaveBeenCalled();
  });

  it('enqueues a scan-repo job and returns its jobId immediately, without awaiting the scan', async () => {
    const authorizations = {
      listByUser: jest
        .fn()
        .mockResolvedValue([makeApproval({ owner: 'Acme', name: 'Widgets' })]),
    } as unknown as RepoAuthorizationRepositoryPort;
    const state = {
      startRepoScan: jest.fn(),
    } as unknown as StateRepositoryPort;
    const githubLookup = {
      resolveRepoId: jest.fn().mockResolvedValue(42),
    } as unknown as GithubRepoLookupPort;
    const jobQueue = new FakeScanJobQueue();
    const workdirJoiner = {
      join: jest.fn().mockReturnValue('workdir/repo-42'),
      ensureDir: jest.fn(),
    } as unknown as WorkdirJoinerPort;
    const useCase = new ScanMyRepoUseCase(
      authorizations,
      state,
      githubLookup,
      jobQueue,
      workdirJoiner,
    );

    const result = await useCase.execute(1, 'acme', 'widgets');

    expect(state.startRepoScan).not.toHaveBeenCalled();
    expect(jobQueue.enqueued).toHaveLength(1);
    expect(jobQueue.enqueued[0].type).toBe('scan-repo');
    expect(jobQueue.enqueued[0].payload).toEqual({
      repoRef: { repoId: 42, owner: 'acme', name: 'widgets' },
      cloneSource: 'https://github.com/acme/widgets.git',
      workdir: 'workdir/repo-42',
    });
    expect(result).toEqual({ repoId: 42, jobId: 'fake-job-id' });
    (state.startRepoScan as jest.Mock).mockClear();
    await useCase.execute(
      1,
      'acme',
      'widgets',
      ESecretType.GCP_SERVICE_ACCOUNT_KEY,
    );
    expect(jobQueue.enqueued[1]).toMatchObject({
      type: 'rescan-service',
      payload: {
        secretType: ESecretType.GCP_SERVICE_ACCOUNT_KEY,
        repoRef: { repoId: 42 },
      },
    });
    expect(state.startRepoScan).not.toHaveBeenCalled();
  });
});
