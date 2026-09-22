import { ESecretType } from '../../../../../src/modules/scanner/domain/constant/secret-type.constant';
import { AdminScanRepoUseCase } from '../../../../../src/modules/scanner/application/use-cases/admin-scan-repo.use-case';
import { StateRepositoryPort } from '../../../../../src/modules/scanner/application/ports/state-repository.port';
import { GithubRepoLookupPort } from '../../../../../src/modules/scanner/application/ports/github-repo-lookup.port';
import { WorkdirJoinerPort } from '../../../../../src/modules/scanner/application/ports/workdir-joiner.port';
import { FakeScanJobQueue } from '../../fakes/fake-scan-job-queue';

describe('AdminScanRepoUseCase', () => {
  it("returns 'not-found' when GitHub has no such repo, without starting a scan", async () => {
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
    const useCase = new AdminScanRepoUseCase(
      state,
      githubLookup,
      jobQueue,
      workdirJoiner,
    );

    const result = await useCase.execute('acme', 'widgets');

    expect(result).toBe('not-found');
    expect(state.startRepoScan).not.toHaveBeenCalled();
  });

  it('enqueues a service rescan without resetting whole-repo scan state', async () => {
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
    const useCase = new AdminScanRepoUseCase(
      state,
      githubLookup,
      jobQueue,
      workdirJoiner,
    );
    await useCase.execute('acme', 'widgets', ESecretType.GITHUB_PAT);
    expect(state.startRepoScan).not.toHaveBeenCalled();
    expect(jobQueue.enqueued).toEqual([
      {
        type: 'rescan-service',
        payload: {
          repoRef: { repoId: 42, owner: 'acme', name: 'widgets' },
          cloneSource: 'https://github.com/acme/widgets.git',
          workdir: 'workdir/repo-42',
          secretType: ESecretType.GITHUB_PAT,
        },
      },
    ]);
  });

  it('enqueues a scan-repo job for the given owner/name with no authorization check', async () => {
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
    const useCase = new AdminScanRepoUseCase(
      state,
      githubLookup,
      jobQueue,
      workdirJoiner,
    );

    const result = await useCase.execute('acme', 'widgets');

    expect(state.startRepoScan).not.toHaveBeenCalled();
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
