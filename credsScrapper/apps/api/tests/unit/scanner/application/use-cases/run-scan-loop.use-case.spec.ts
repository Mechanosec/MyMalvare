import { WorkdirJoinerPort } from '../../../../../src/modules/scanner/application/ports/workdir-joiner.port';
import { RunScanLoopUseCase } from '../../../../../src/modules/scanner/application/use-cases/run-scan-loop.use-case';
import { EScanStatus } from '../../../../../src/modules/scanner/domain/constant/scan-status.constant';
import { IRepoRef } from '../../../../../src/modules/scanner/domain/types/repo-ref.type';
import { FakeLogger } from '../../fakes/fake-logger';
import { FakeStateRepository } from '../../fakes/fake-state-repository';

class FakeWorkdirJoiner extends WorkdirJoinerPort {
  join(...segments: string[]): string {
    return segments.join('/');
  }
  async ensureDir(): Promise<void> {}
}

/** Stands in for ScanRepositoryUseCase - only the `execute` shape matters here. */
class RecordingScanner {
  readonly scanned: IRepoRef[] = [];
  constructor(private readonly state: FakeStateRepository) {}

  execute = async (ref: IRepoRef, _source: string, _workdir: string, onProgress?: (message: string) => void): Promise<void> => {
    onProgress?.(`scan: ${ref.owner}/${ref.name} - cloning`);
    this.scanned.push(ref);
    await this.state.markDone(ref.repoId);
    onProgress?.(`scan: ${ref.owner}/${ref.name} - done, 0 findings total`);
  };
}

describe('RunScanLoopUseCase', () => {
  it('processes every pending candidate exactly once with multiple workers', async () => {
    const state = new FakeStateRepository();
    for (let i = 1; i <= 10; i += 1) {
      await state.addCandidate(i, 'octocat', `repo${i}`);
    }
    const scanner = new RecordingScanner(state);
    const useCase = new RunScanLoopUseCase(
      state,
      scanner as never,
      new FakeLogger(),
      new FakeWorkdirJoiner(),
    );

    const processed = await useCase.execute({
      workdirRoot: 'workdir',
      sourceUrlFn: () => 'https://example.com/repo.git',
      workers: 4,
    });

    expect(processed).toBe(10);
    expect(scanner.scanned.map((r) => r.repoId).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 10 }, (_, i) => i + 1),
    );
    const doneCount = [...state.scanned.values()].filter(
      (r) => r.status === EScanStatus.DONE,
    ).length;
    expect(doneCount).toBe(10);
  });

  it('never scans more than maxRepos', async () => {
    const state = new FakeStateRepository();
    for (let i = 1; i <= 10; i += 1) {
      await state.addCandidate(i, 'octocat', `repo${i}`);
    }
    const scanner = new RecordingScanner(state);
    const useCase = new RunScanLoopUseCase(
      state,
      scanner as never,
      new FakeLogger(),
      new FakeWorkdirJoiner(),
    );

    const processed = await useCase.execute({
      workdirRoot: 'workdir',
      sourceUrlFn: () => 'https://example.com/repo.git',
      workers: 4,
      maxRepos: 3,
    });

    expect(processed).toBe(3);
  });

  it('does not rescan a repo already marked done', async () => {
    const state = new FakeStateRepository();
    await state.addCandidate(1, 'octocat', 'repo1');
    const scanner = new RecordingScanner(state);
    const useCase = new RunScanLoopUseCase(
      state,
      scanner as never,
      new FakeLogger(),
      new FakeWorkdirJoiner(),
    );

    await useCase.execute({ workdirRoot: 'w', sourceUrlFn: () => 'x' });
    const secondRun = await useCase.execute({ workdirRoot: 'w', sourceUrlFn: () => 'x' });

    expect(secondRun).toBe(0);
  });

  it('retries a failed repo on the next run, up to maxRetries', async () => {
    const state = new FakeStateRepository();
    await state.addCandidate(1, 'octocat', 'repo1');
    await state.claimNext();
    await state.markFailed(1, 'stdout maxBuffer length exceeded');
    const scanner = new RecordingScanner(state);
    const useCase = new RunScanLoopUseCase(
      state,
      scanner as never,
      new FakeLogger(),
      new FakeWorkdirJoiner(),
    );

    const processed = await useCase.execute({
      workdirRoot: 'w',
      sourceUrlFn: () => 'x',
      maxRetries: 3,
    });

    expect(processed).toBe(1);
    expect(scanner.scanned.map((r) => r.repoId)).toEqual([1]);
  });

  it('does not retry a failed repo once it has hit maxRetries', async () => {
    const state = new FakeStateRepository();
    await state.addCandidate(1, 'octocat', 'repo1');
    await state.claimNext();
    await state.markFailed(1, 'stdout maxBuffer length exceeded');
    await state.markFailed(1, 'stdout maxBuffer length exceeded');
    const scanner = new RecordingScanner(state);
    const useCase = new RunScanLoopUseCase(
      state,
      scanner as never,
      new FakeLogger(),
      new FakeWorkdirJoiner(),
    );

    const processed = await useCase.execute({
      workdirRoot: 'w',
      sourceUrlFn: () => 'x',
      maxRetries: 2,
    });

    expect(processed).toBe(0);
  });

  it('forwards per-repo progress messages from the scanner, not just a final count', async () => {
    const state = new FakeStateRepository();
    await state.addCandidate(1, 'octocat', 'repo1');
    const scanner = new RecordingScanner(state);
    const useCase = new RunScanLoopUseCase(
      state,
      scanner as never,
      new FakeLogger(),
      new FakeWorkdirJoiner(),
    );
    const messages: string[] = [];

    await useCase.execute({
      workdirRoot: 'w',
      sourceUrlFn: () => 'x',
      onProgress: (message) => messages.push(message),
    });

    expect(messages).toContain('scan: octocat/repo1 - cloning');
    expect(messages).toContain('scan: octocat/repo1 - done, 0 findings total');
    expect(messages).toContain('scan: loop finished, 1 repos processed this run');
  });
});
