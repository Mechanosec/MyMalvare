import { GitOperationsPort } from '../../../../../src/modules/scanner/application/ports/git-operations.port';
import { WorkdirCleanerPort } from '../../../../../src/modules/scanner/application/ports/workdir-cleaner.port';
import { ScanRepositoryUseCase } from '../../../../../src/modules/scanner/application/use-cases/scan-repository.use-case';
import { EScanStatus } from '../../../../../src/modules/scanner/domain/constant/scan-status.constant';
import { FakeLogger } from '../../fakes/fake-logger';
import { FakeStateRepository } from '../../fakes/fake-state-repository';

class FakeGit extends GitOperationsPort {
  headSha = 'a'.repeat(40);
  files: Record<string, string | null> = {};
  diffs: Array<{ commitSha: string; diffText: string }> = [];
  cloneShouldFail = false;

  async cloneBare(): Promise<void> {
    if (this.cloneShouldFail) {
      throw new Error('clone failed');
    }
  }

  async getHeadCommit(): Promise<string> {
    return this.headSha;
  }

  async listFilesAtHead(): Promise<string[]> {
    return Object.keys(this.files);
  }

  async readFileAtHead(_repoPath: string, filePath: string): Promise<string | null> {
    return this.files[filePath];
  }

  async iterCommitDiffs(): Promise<Array<{ commitSha: string; diffText: string }>> {
    return this.diffs;
  }
}

class FakeWorkdirCleaner extends WorkdirCleanerPort {
  removed: string[] = [];
  async remove(path: string): Promise<void> {
    this.removed.push(path);
  }
}

describe('ScanRepositoryUseCase', () => {
  it('records findings from the working tree and marks the repo done', async () => {
    const git = new FakeGit();
    git.files = { 'config.py': "AWS_KEY = 'AKIAABCDEFGH12345678'\n" };
    const state = new FakeStateRepository();
    const useCase = new ScanRepositoryUseCase(git, state, new FakeLogger(), new FakeWorkdirCleaner());
    const ref = { repoId: 1, owner: 'octocat', name: 'hello-world' };
    await state.addCandidate(1, 'octocat', 'hello-world');
    await state.claimNext();

    await useCase.execute(ref, 'https://example.com/repo.git', 'workdir/repo-1');

    expect(state.scanned.get(1)?.status).toBe(EScanStatus.DONE);
    expect(state.findings).toHaveLength(1);
    expect(state.findings[0].secretValue).toBe('AKIAABCDEFGH12345678');
  });

  it('skips a binary file (readFileAtHead returns null) without failing', async () => {
    const git = new FakeGit();
    git.files = { 'image.png': null };
    const state = new FakeStateRepository();
    const useCase = new ScanRepositoryUseCase(git, state, new FakeLogger(), new FakeWorkdirCleaner());
    const ref = { repoId: 1, owner: 'octocat', name: 'hello-world' };
    await state.addCandidate(1, 'octocat', 'hello-world');
    await state.claimNext();

    await useCase.execute(ref, 'https://example.com/repo.git', 'workdir/repo-1');

    expect(state.scanned.get(1)?.status).toBe(EScanStatus.DONE);
    expect(state.findings).toHaveLength(0);
  });

  it('skips a test file even when it contains a real-looking secret pattern', async () => {
    const git = new FakeGit();
    git.files = {
      'tests/test_secrets.py': "AWS_KEY = 'AKIAABCDEFGH12345678'\n",
      'src/config.py': "AWS_KEY = 'AKIAABCDEFGH12345699'\n",
    };
    const state = new FakeStateRepository();
    const useCase = new ScanRepositoryUseCase(git, state, new FakeLogger(), new FakeWorkdirCleaner());
    const ref = { repoId: 1, owner: 'octocat', name: 'hello-world' };
    await state.addCandidate(1, 'octocat', 'hello-world');
    await state.claimNext();

    await useCase.execute(ref, 'https://example.com/repo.git', 'workdir/repo-1');

    expect(state.findings).toHaveLength(1);
    expect(state.findings[0].filePath).toBe('src/config.py');
  });

  it('marks the repo failed when cloning throws', async () => {
    const git = new FakeGit();
    git.cloneShouldFail = true;
    const state = new FakeStateRepository();
    const useCase = new ScanRepositoryUseCase(git, state, new FakeLogger(), new FakeWorkdirCleaner());
    const ref = { repoId: 1, owner: 'octocat', name: 'hello-world' };
    await state.addCandidate(1, 'octocat', 'hello-world');
    await state.claimNext();

    await useCase.execute(ref, 'https://example.com/repo.git', 'workdir/repo-1');

    expect(state.scanned.get(1)?.status).toBe(EScanStatus.FAILED);
  });

  it('reports each stage of the scan through onProgress, not just the final result', async () => {
    const git = new FakeGit();
    git.files = { 'config.py': "AWS_KEY = 'AKIAABCDEFGH12345678'\n" };
    const state = new FakeStateRepository();
    const useCase = new ScanRepositoryUseCase(git, state, new FakeLogger(), new FakeWorkdirCleaner());
    const ref = { repoId: 1, owner: 'octocat', name: 'hello-world' };
    await state.addCandidate(1, 'octocat', 'hello-world');
    await state.claimNext();
    const messages: string[] = [];

    await useCase.execute(ref, 'https://example.com/repo.git', 'workdir/repo-1', (message) =>
      messages.push(message),
    );

    expect(messages).toEqual([
      'scan: octocat/hello-world - cloning',
      `scan: octocat/hello-world - cloned, head=${git.headSha}, scanning working tree`,
      'scan: octocat/hello-world - working tree done (1 findings), scanning commit history',
      'scan: octocat/hello-world - done, 1 findings total',
    ]);
  });

  it('reports a failure message through onProgress when cloning throws', async () => {
    const git = new FakeGit();
    git.cloneShouldFail = true;
    const state = new FakeStateRepository();
    const useCase = new ScanRepositoryUseCase(git, state, new FakeLogger(), new FakeWorkdirCleaner());
    const ref = { repoId: 1, owner: 'octocat', name: 'hello-world' };
    await state.addCandidate(1, 'octocat', 'hello-world');
    await state.claimNext();
    const messages: string[] = [];

    await useCase.execute(ref, 'https://example.com/repo.git', 'workdir/repo-1', (message) =>
      messages.push(message),
    );

    expect(messages).toEqual([
      'scan: octocat/hello-world - cloning',
      'scan: octocat/hello-world - failed: clone failed',
    ]);
  });
});
