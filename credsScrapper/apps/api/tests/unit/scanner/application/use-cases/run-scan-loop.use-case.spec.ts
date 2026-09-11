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

  execute = async (ref: IRepoRef): Promise<void> => {
    this.scanned.push(ref);
    await this.state.markDone(ref.repoId);
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
});
