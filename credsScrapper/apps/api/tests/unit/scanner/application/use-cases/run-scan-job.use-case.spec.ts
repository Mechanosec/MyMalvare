import { GitOperationsPort } from '../../../../../src/modules/scanner/application/ports/git-operations.port';
import { RunScanJobUseCase } from '../../../../../src/modules/scanner/application/use-cases/run-scan-job.use-case';
import { EScanPhase } from '../../../../../src/modules/scanner/domain/constant/scan-phase.constant';

class FakeGit extends GitOperationsPort {
  preparedHead = 0;
  preparedHistory = 0;
  historyTarget?: string;
  async prepareHead(
    _source: string,
    _dest: string,
    _signal: AbortSignal,
  ): Promise<string> {
    this.preparedHead += 1;
    if (this.cloneShouldFail) throw new Error('clone failed');
    return this.headSha;
  }
  async prepareHistory(
    _source: string,
    _dest: string,
    targetSha: string,
  ): Promise<void> {
    this.preparedHistory += 1;
    this.historyTarget = targetSha;
  }
  async syncBare() {
    await this.cloneBare();
  }
  async isAncestor() {
    return true;
  }
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

  async readFileAtHead(
    _repoPath: string,
    filePath: string,
  ): Promise<string | null> {
    return this.files[filePath];
  }

  async *iterCommitDiffs(): AsyncIterable<{
    commitSha: string;
    diffText: string;
  }> {
    yield* this.diffs;
  }
}

describe('RunScanJobUseCase', () => {
  const ref = { repoId: 1, owner: 'octocat', name: 'hello-world' };
  const phaseOptions = (phase: EScanPhase) => ({
    phase,
    targetSha: phase === EScanPhase.HISTORY ? 'b'.repeat(40) : undefined,
    scannerVersion: 'v2',
    budget: { maxDurationMs: 60_000, maxCacheBytes: Number.MAX_SAFE_INTEGER },
    signal: new AbortController().signal,
  });

  it('scans only current files during the HEAD phase', async () => {
    const git = new FakeGit();
    git.files = { 'config.py': "AWS_KEY = 'AKIAABCDEFGH12345678'\n" };
    git.diffs = [
      {
        commitSha: 'old',
        diffText: "+TOKEN = 'ghp_abcdefghijklmnopqrstuvwxyz1234567890'",
      },
    ];
    const history = jest.spyOn(git, 'iterCommitDiffs');
    const events: unknown[] = [];

    const result = await new RunScanJobUseCase(git).execute(
      ref,
      'source',
      'workdir',
      (event) => events.push(event),
      phaseOptions(EScanPhase.HEAD),
    );

    expect(result).toMatchObject({ status: 'done', headSha: git.headSha });
    expect(git.preparedHead).toBe(1);
    expect(git.preparedHistory).toBe(0);
    expect(history).not.toHaveBeenCalled();
  });

  it('scans only commit diffs during the history phase', async () => {
    const git = new FakeGit();
    git.files = { 'config.py': "AWS_KEY = 'AKIAABCDEFGH12345678'\n" };
    git.diffs = [
      {
        commitSha: 'c'.repeat(40),
        diffText: "+AWS_KEY = 'AKIAABCDEFGH12345678'\n",
      },
    ];
    const listHead = jest.spyOn(git, 'listFilesAtHead');

    const result = await new RunScanJobUseCase(git).execute(
      ref,
      'source',
      'workdir',
      () => {},
      phaseOptions(EScanPhase.HISTORY),
    );

    expect(result).toMatchObject({
      status: 'done',
      targetSha: 'b'.repeat(40),
    });
    expect(git.preparedHistory).toBe(1);
    expect(git.preparedHead).toBe(0);
    expect(listHead).not.toHaveBeenCalled();
  });

  it('returns cancelled without claiming success when aborted', async () => {
    const git = new FakeGit();
    const controller = new AbortController();
    controller.abort();
    const result = await new RunScanJobUseCase(git).execute(
      ref,
      'source',
      'workdir',
      () => {},
      {
        ...phaseOptions(EScanPhase.HEAD),
        signal: controller.signal,
      },
    );
    expect(result.status).toBe('cancelled');
  });

  it('returns incomplete when acquisition exceeds its wall-time budget', async () => {
    const git = new FakeGit();
    git.prepareHead = async (
      _source: string,
      _dest: string,
      signal: AbortSignal,
    ) =>
      new Promise<string>((_resolve, reject) => {
        signal.addEventListener(
          'abort',
          () => reject(new Error('Git operation cancelled')),
          { once: true },
        );
      });
    const result = await new RunScanJobUseCase(git).execute(
      ref,
      'source',
      'workdir',
      () => {},
      {
        ...phaseOptions(EScanPhase.HEAD),
        budget: { maxDurationMs: 5, maxCacheBytes: Number.MAX_SAFE_INTEGER },
      },
    );
    expect(result.status).toBe('incomplete');
  });

  it('emits a finding event for a secret in the working tree and resolves done', async () => {
    const git = new FakeGit();
    git.files = { 'config.py': "AWS_KEY = 'AKIAABCDEFGH12345678'\n" };
    const useCase = new RunScanJobUseCase(git);
    const events: unknown[] = [];

    const result = await useCase.execute(
      ref,
      'https://example.com/repo.git',
      'workdir/repo-1',
      (e) => events.push(e),
    );

    expect(result).toEqual({ status: 'done', headSha: git.headSha });
    const findingEvents = events.filter((e: any) => e.type === 'finding');
    expect(findingEvents).toHaveLength(1);
    expect((findingEvents[0] as any).finding.secretValue).toBe(
      'AKIAABCDEFGH12345678',
    );
    expect((findingEvents[0] as any).filePath).toBe('config.py');
    expect((findingEvents[0] as any).commitSha).toBe(git.headSha);
  });

  it('skips a binary file (readFileAtHead returns null) without failing', async () => {
    const git = new FakeGit();
    git.files = { 'image.png': null };
    const useCase = new RunScanJobUseCase(git);
    const events: unknown[] = [];

    const result = await useCase.execute(
      ref,
      'https://example.com/repo.git',
      'workdir/repo-1',
      (e) => events.push(e),
    );

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

    await useCase.execute(
      ref,
      'https://example.com/repo.git',
      'workdir/repo-1',
      (e) => events.push(e),
    );

    const findingEvents = events.filter((e: any) => e.type === 'finding');
    expect(findingEvents).toHaveLength(1);
    expect((findingEvents[0] as any).filePath).toBe('src/config.py');
  });

  it('emits a finding event for a secret in commit history, tagged with the commit sha', async () => {
    const git = new FakeGit();
    git.diffs = [
      {
        commitSha: 'deadbeef',
        diffText: "+AWS_KEY = 'AKIAABCDEFGH12345678'\n",
      },
    ];
    const useCase = new RunScanJobUseCase(git);
    const events: unknown[] = [];

    await useCase.execute(
      ref,
      'https://example.com/repo.git',
      'workdir/repo-1',
      (e) => events.push(e),
    );

    const findingEvents = events.filter((e: any) => e.type === 'finding');
    expect(findingEvents).toHaveLength(1);
    expect((findingEvents[0] as any).commitSha).toBe('deadbeef');
    expect((findingEvents[0] as any).filePath).toBe('<commit-diff>');
  });

  it('attributes a commit-diff finding to its real file when the diff has a diff --git header', async () => {
    const git = new FakeGit();
    git.diffs = [
      {
        commitSha: 'deadbeef',
        diffText: [
          'diff --git a/src/config.py b/src/config.py',
          '--- a/src/config.py',
          '+++ b/src/config.py',
          '@@ -1,1 +1,2 @@',
          "+AWS_KEY = 'AKIAABCDEFGH12345678'",
          '',
        ].join('\n'),
      },
    ];
    const useCase = new RunScanJobUseCase(git);
    const events: unknown[] = [];

    await useCase.execute(
      ref,
      'https://example.com/repo.git',
      'workdir/repo-1',
      (e) => events.push(e),
    );

    const findingEvents = events.filter((e: any) => e.type === 'finding');
    expect(findingEvents).toHaveLength(1);
    expect((findingEvents[0] as any).filePath).toBe(
      '<commit-diff>:src/config.py',
    );
  });

  it('excludes a commit-diff finding whose real file is a lockfile', async () => {
    const git = new FakeGit();
    git.diffs = [
      {
        commitSha: 'deadbeef',
        diffText: [
          'diff --git a/package-lock.json b/package-lock.json',
          '--- a/package-lock.json',
          '+++ b/package-lock.json',
          '@@ -1,1 +1,2 @@',
          "+AWS_KEY = 'AKIAABCDEFGH12345678'",
          '',
        ].join('\n'),
      },
    ];
    const useCase = new RunScanJobUseCase(git);
    const events: unknown[] = [];

    await useCase.execute(
      ref,
      'https://example.com/repo.git',
      'workdir/repo-1',
      (e) => events.push(e),
    );

    expect(events.filter((e: any) => e.type === 'finding')).toHaveLength(0);
  });

  it('resolves failed (not a rejected promise) when cloning throws', async () => {
    const git = new FakeGit();
    git.cloneShouldFail = true;
    const useCase = new RunScanJobUseCase(git);
    const events: unknown[] = [];

    const result = await useCase.execute(
      ref,
      'https://example.com/repo.git',
      'workdir/repo-1',
      (e) => events.push(e),
    );

    expect(result).toEqual({ status: 'failed', failReason: 'clone failed' });
  });

  it("emits progress events for each stage, matching today's exact message text", async () => {
    const git = new FakeGit();
    git.files = { 'config.py': "AWS_KEY = 'AKIAABCDEFGH12345678'\n" };
    const useCase = new RunScanJobUseCase(git);
    const messages: string[] = [];

    await useCase.execute(
      ref,
      'https://example.com/repo.git',
      'workdir/repo-1',
      (e: any) => {
        if (e.type === 'progress') messages.push(e.message);
      },
    );

    expect(messages).toEqual([
      'scan: octocat/hello-world - cloning',
      `scan: octocat/hello-world - head=${git.headSha}, scanning full commit history`,
      'scan: octocat/hello-world - commit history done (0 findings), scanning working tree',
      'scan: octocat/hello-world - done, 1 findings total',
    ]);
  });

  it('emits a failure progress message when cloning throws', async () => {
    const git = new FakeGit();
    git.cloneShouldFail = true;
    const useCase = new RunScanJobUseCase(git);
    const messages: string[] = [];

    await useCase.execute(
      ref,
      'https://example.com/repo.git',
      'workdir/repo-1',
      (e: any) => {
        if (e.type === 'progress') messages.push(e.message);
      },
    );

    expect(messages).toEqual([
      'scan: octocat/hello-world - cloning',
      'scan: octocat/hello-world - failed: clone failed',
    ]);
  });
});
