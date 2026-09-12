import { GitOperationsPort } from '../../../../../src/modules/scanner/application/ports/git-operations.port';
import { RunScanJobUseCase } from '../../../../../src/modules/scanner/application/use-cases/run-scan-job.use-case';

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

describe('RunScanJobUseCase', () => {
  const ref = { repoId: 1, owner: 'octocat', name: 'hello-world' };

  it('emits a finding event for a secret in the working tree and resolves done', async () => {
    const git = new FakeGit();
    git.files = { 'config.py': "AWS_KEY = 'AKIAABCDEFGH12345678'\n" };
    const useCase = new RunScanJobUseCase(git);
    const events: unknown[] = [];

    const result = await useCase.execute(ref, 'https://example.com/repo.git', 'workdir/repo-1', (e) => events.push(e));

    expect(result).toEqual({ status: 'done', headSha: git.headSha });
    const findingEvents = events.filter((e: any) => e.type === 'finding');
    expect(findingEvents).toHaveLength(1);
    expect((findingEvents[0] as any).finding.secretValue).toBe('AKIAABCDEFGH12345678');
    expect((findingEvents[0] as any).filePath).toBe('config.py');
    expect((findingEvents[0] as any).commitSha).toBe(git.headSha);
  });

  it('skips a binary file (readFileAtHead returns null) without failing', async () => {
    const git = new FakeGit();
    git.files = { 'image.png': null };
    const useCase = new RunScanJobUseCase(git);
    const events: unknown[] = [];

    const result = await useCase.execute(ref, 'https://example.com/repo.git', 'workdir/repo-1', (e) => events.push(e));

    expect(result).toEqual({ status: 'done', headSha: git.headSha });
    expect(events.filter((e: any) => e.type === 'finding')).toHaveLength(0);
  });

  it('skips a test file even when it contains a real-looking secret pattern', async () => {
    const git = new FakeGit();
    git.files = {
      'tests/test_secrets.py': "AWS_KEY = 'AKIAABCDEFGH12345678'\n",
      'src/config.py': "AWS_KEY = 'AKIAABCDEFGH12345699'\n",
    };
    const useCase = new RunScanJobUseCase(git);
    const events: unknown[] = [];

    await useCase.execute(ref, 'https://example.com/repo.git', 'workdir/repo-1', (e) => events.push(e));

    const findingEvents = events.filter((e: any) => e.type === 'finding');
    expect(findingEvents).toHaveLength(1);
    expect((findingEvents[0] as any).filePath).toBe('src/config.py');
  });

  it('emits a finding event for a secret in commit history, tagged with the commit sha', async () => {
    const git = new FakeGit();
    git.diffs = [{ commitSha: 'deadbeef', diffText: "+AWS_KEY = 'AKIAABCDEFGH12345678'\n" }];
    const useCase = new RunScanJobUseCase(git);
    const events: unknown[] = [];

    await useCase.execute(ref, 'https://example.com/repo.git', 'workdir/repo-1', (e) => events.push(e));

    const findingEvents = events.filter((e: any) => e.type === 'finding');
    expect(findingEvents).toHaveLength(1);
    expect((findingEvents[0] as any).commitSha).toBe('deadbeef');
    expect((findingEvents[0] as any).filePath).toBe('<commit-diff>');
  });

  it('resolves failed (not a rejected promise) when cloning throws', async () => {
    const git = new FakeGit();
    git.cloneShouldFail = true;
    const useCase = new RunScanJobUseCase(git);
    const events: unknown[] = [];

    const result = await useCase.execute(ref, 'https://example.com/repo.git', 'workdir/repo-1', (e) => events.push(e));

    expect(result).toEqual({ status: 'failed', failReason: 'clone failed' });
  });

  it('emits progress events for each stage, matching today\'s exact message text', async () => {
    const git = new FakeGit();
    git.files = { 'config.py': "AWS_KEY = 'AKIAABCDEFGH12345678'\n" };
    const useCase = new RunScanJobUseCase(git);
    const messages: string[] = [];

    await useCase.execute(ref, 'https://example.com/repo.git', 'workdir/repo-1', (e: any) => {
      if (e.type === 'progress') messages.push(e.message);
    });

    expect(messages).toEqual([
      'scan: octocat/hello-world - cloning',
      `scan: octocat/hello-world - cloned, head=${git.headSha}, scanning commit history`,
      'scan: octocat/hello-world - commit history done (0 findings), scanning working tree',
      'scan: octocat/hello-world - done, 1 findings total',
    ]);
  });

  it('emits a failure progress message when cloning throws', async () => {
    const git = new FakeGit();
    git.cloneShouldFail = true;
    const useCase = new RunScanJobUseCase(git);
    const messages: string[] = [];

    await useCase.execute(ref, 'https://example.com/repo.git', 'workdir/repo-1', (e: any) => {
      if (e.type === 'progress') messages.push(e.message);
    });

    expect(messages).toEqual([
      'scan: octocat/hello-world - cloning',
      'scan: octocat/hello-world - failed: clone failed',
    ]);
  });
});
