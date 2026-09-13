import { ScanMyRepoUseCase } from '../../../../../src/modules/auth/application/use-cases/scan-my-repo.use-case';
import { RepoAuthorizationRepositoryPort } from '../../../../../src/modules/auth/application/ports/repo-authorization-repository.port';
import { ERepoAuthorizationStatus } from '../../../../../src/modules/auth/domain/constant/repo-authorization-status.constant';
import { StateRepositoryPort } from '../../../../../src/modules/scanner/application/ports/state-repository.port';
import { GithubRepoLookupPort } from '../../../../../src/modules/scanner/application/ports/github-repo-lookup.port';
import { WorkdirJoinerPort } from '../../../../../src/modules/scanner/application/ports/workdir-joiner.port';
import { JobQueuePort } from '../../../../../src/modules/scanner/application/ports/job-queue.port';

class FakeJobQueue extends JobQueuePort {
  enqueued: Array<{ type: string; payload: unknown }> = [];
  async enqueue(type: string, payload: unknown): Promise<string> {
    this.enqueued.push({ type, payload });
    return 'fake-job-id';
  }
  async getJob(): Promise<null> {
    return null;
  }
  async requestStop(): Promise<void> {}
  async isStopRequested(): Promise<boolean> {
    return false;
  }
}

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
    const jobQueue = new FakeJobQueue();
    const workdirJoiner = { join: jest.fn(), ensureDir: jest.fn() } as unknown as WorkdirJoinerPort;
    const useCase = new ScanMyRepoUseCase(authorizations, state, githubLookup, jobQueue, workdirJoiner);

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
    const jobQueue = new FakeJobQueue();
    const workdirJoiner = { join: jest.fn(), ensureDir: jest.fn() } as unknown as WorkdirJoinerPort;
    const useCase = new ScanMyRepoUseCase(authorizations, state, githubLookup, jobQueue, workdirJoiner);

    const result = await useCase.execute(1, 'acme', 'widgets');

    expect(result).toBe('not-found');
    expect(state.startRepoScan).not.toHaveBeenCalled();
  });

  it('enqueues a scan-repo job and returns its jobId immediately, without awaiting the scan', async () => {
    const authorizations = {
      listByUser: jest.fn().mockResolvedValue([makeApproval({ owner: 'Acme', name: 'Widgets' })]),
    } as unknown as RepoAuthorizationRepositoryPort;
    const state = { startRepoScan: jest.fn() } as unknown as StateRepositoryPort;
    const githubLookup = { resolveRepoId: jest.fn().mockResolvedValue(42) } as unknown as GithubRepoLookupPort;
    const jobQueue = new FakeJobQueue();
    const workdirJoiner = {
      join: jest.fn().mockReturnValue('workdir/repo-42'),
      ensureDir: jest.fn(),
    } as unknown as WorkdirJoinerPort;
    const useCase = new ScanMyRepoUseCase(authorizations, state, githubLookup, jobQueue, workdirJoiner);

    const result = await useCase.execute(1, 'acme', 'widgets');

    expect(state.startRepoScan).toHaveBeenCalledWith(42, 'acme', 'widgets');
    expect(jobQueue.enqueued).toHaveLength(1);
    expect(jobQueue.enqueued[0].type).toBe('scan-repo');
    expect(jobQueue.enqueued[0].payload).toEqual({
      repoRef: { repoId: 42, owner: 'acme', name: 'widgets' },
      cloneSource: 'https://github.com/acme/widgets.git',
      workdir: 'workdir/repo-42',
    });
    expect(result).toEqual({ repoId: 42, jobId: 'fake-job-id' });
  });
});
