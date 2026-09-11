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
});
