import { WorkdirJoinerPort } from '../../../../../src/modules/scanner/application/ports/workdir-joiner.port';
import { RunScanLoopUseCase } from '../../../../../src/modules/scanner/application/use-cases/run-scan-loop.use-case';
import { EScanStatus } from '../../../../../src/modules/scanner/domain/constant/scan-status.constant';
import { IRepoRef } from '../../../../../src/modules/scanner/domain/types/repo-ref.type';
import { FakeLogger } from '../../fakes/fake-logger';
import { FakeStateRepository } from '../../fakes/fake-state-repository';
import { FakeScanJobQueue } from '../../fakes/fake-scan-job-queue';

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

  execute = async (
    ref: IRepoRef,
    _source: string,
    _workdir: string,
    onProgress?: (message: string) => void,
  ): Promise<void> => {
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
    const secondRun = await useCase.execute({
      workdirRoot: 'w',
      sourceUrlFn: () => 'x',
    });

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
    expect(messages).toContain(
      'scan: loop finished, 1 repos processed this run',
    );
  });

  it('stops before claiming the next repo once shouldStop reports true, leaving later candidates untouched', async () => {
    const state = new FakeStateRepository();
    for (let i = 1; i <= 5; i += 1) {
      await state.addCandidate(i, 'octocat', `repo${i}`);
    }
    const scanner = new RecordingScanner(state);
    const useCase = new RunScanLoopUseCase(
      state,
      scanner as never,
      new FakeLogger(),
      new FakeWorkdirJoiner(),
    );
    const messages: string[] = [];

    const processed = await useCase.execute({
      workdirRoot: 'w',
      sourceUrlFn: () => 'x',
      workers: 1,
      shouldStop: async () => scanner.scanned.length >= 2,
      onProgress: (message) => messages.push(message),
    });

    expect(processed).toBe(2);
    expect(scanner.scanned).toHaveLength(2);
    expect(messages).toContain(
      'scan: stopped by request, 2 repos processed this run',
    );
  });
  it('reserves maxRepos atomically even when the stop check yields', async () => {
    const state = new FakeStateRepository();
    for (let i = 1; i <= 10; i++)
      await state.addCandidate(i, 'local', `repo${i}`);
    const scanner = new RecordingScanner(state);
    const useCase = new RunScanLoopUseCase(
      state,
      scanner as never,
      new FakeLogger(),
      new FakeWorkdirJoiner(),
    );
    expect(
      await useCase.execute({
        workdirRoot: 'w',
        sourceUrlFn: () => 'unused',
        workers: 4,
        maxRepos: 1,
        shouldStop: async () => false,
      }),
    ).toBe(1);
    expect(scanner.scanned).toHaveLength(1);
  });
  it('finishes the batch but reports failure if any repository failed', async () => {
    const state = new FakeStateRepository();
    for (let i = 1; i <= 3; i++)
      await state.addCandidate(i, 'local', `repo${i}`);
    const scanned: number[] = [];
    const scanner = {
      execute: async (ref: IRepoRef) => {
        scanned.push(ref.repoId);
        if (ref.repoId === 2) {
          await state.markFailed(ref.repoId, 'synthetic failure');
          return { status: 'failed' as const, failReason: 'synthetic failure' };
        }
        await state.markDone(ref.repoId);
        return { status: 'done' as const, headSha: 'a'.repeat(40) };
      },
    };
    const useCase = new RunScanLoopUseCase(
      state,
      scanner as never,
      new FakeLogger(),
      new FakeWorkdirJoiner(),
    );
    await expect(
      useCase.execute({ workdirRoot: 'w', sourceUrlFn: () => 'unused' }),
    ).rejects.toThrow('1 of 3 repositories failed');
    expect(scanned).toEqual([1, 2, 3]);
  });

  it('stops after HEAD without enqueuing HISTORY or claiming the next candidate', async () => {
    const state = new FakeStateRepository();
    await state.addCandidate(1, 'local', 'first');
    await state.addCandidate(2, 'local', 'second');
    const jobs = new FakeScanJobQueue();
    let stopped = false;
    const phaseScanner = {
      execute: jest.fn().mockImplementation(async () => {
        stopped = true;
        return { status: 'done', headSha: 'a'.repeat(40) };
      }),
    };
    const useCase = new RunScanLoopUseCase(
      state,
      {} as never,
      new FakeLogger(),
      new FakeWorkdirJoiner(),
      phaseScanner as never,
      jobs,
    );

    expect(
      await useCase.execute({
        workdirRoot: 'workdir',
        sourceUrlFn: () => 'local',
        workers: 1,
        scanEpoch: 7,
        shouldStop: async () => stopped,
      }),
    ).toBe(1);
    expect(phaseScanner.execute).toHaveBeenCalledWith(
      expect.objectContaining({ scanEpoch: 7 }),
    );
    expect(jobs.enqueued).toHaveLength(0);
    expect(state.candidates.get(2)?.status).toBe('pending');
  });

  it('does not hide a control-read failure behind an aborted scan signal', async () => {
    const controller = new AbortController();
    controller.abort();
    const useCase = new RunScanLoopUseCase(
      new FakeStateRepository(),
      {} as never,
      new FakeLogger(),
      new FakeWorkdirJoiner(),
    );

    await expect(
      useCase.execute({
        workdirRoot: 'workdir',
        sourceUrlFn: () => 'local',
        signal: controller.signal,
        shouldStop: async () => {
          throw new Error('scan_control_unavailable');
        },
      }),
    ).rejects.toThrow('scan_control_unavailable');
  });

  it('waits for a sibling scan to finish before propagating a control failure', async () => {
    const state = new FakeStateRepository();
    for (let id = 1; id <= 3; id++)
      await state.addCandidate(id, 'local', `repo${id}`);
    let releaseSibling!: () => void;
    const siblingCleanup = new Promise<void>((resolve) => {
      releaseSibling = resolve;
    });
    let reportFailure!: () => void;
    const failureStarted = new Promise<void>((resolve) => {
      reportFailure = resolve;
    });
    const scanner = {
      execute: jest.fn(async (ref: IRepoRef) => {
        if (ref.repoId === 2) {
          reportFailure();
          throw new Error('scan_control_unavailable');
        }
        await siblingCleanup;
        await state.markDone(ref.repoId);
        return { status: 'done' as const, headSha: 'a'.repeat(40) };
      }),
    };
    const useCase = new RunScanLoopUseCase(
      state,
      scanner as never,
      new FakeLogger(),
      new FakeWorkdirJoiner(),
    );
    const outcome = useCase
      .execute({ workdirRoot: 'w', sourceUrlFn: () => 'unused', workers: 2 })
      .then(
        () => 'resolved',
        (error: Error) => error.message,
      );

    try {
      await failureStarted;
      expect(
        await Promise.race([
          outcome,
          new Promise((resolve) => setImmediate(() => resolve('pending'))),
        ]),
      ).toBe('pending');
    } finally {
      releaseSibling();
    }
    expect(await outcome).toBe('scan_control_unavailable');
    expect(scanner.execute).toHaveBeenCalledTimes(2);
    expect(state.candidates.get(3)?.status).toBe('pending');
  });

  it('reports Stop instead of failing the control job after an earlier repo failure', async () => {
    const state = new FakeStateRepository();
    await state.addCandidate(1, 'local', 'first');
    await state.addCandidate(2, 'local', 'second');
    let stopped = false;
    const scanner = {
      execute: async () => {
        stopped = true;
        return { status: 'failed' as const, failReason: 'synthetic failure' };
      },
    };
    const messages: string[] = [];
    const useCase = new RunScanLoopUseCase(
      state,
      scanner as never,
      new FakeLogger(),
      new FakeWorkdirJoiner(),
    );

    await expect(
      useCase.execute({
        workdirRoot: 'workdir',
        sourceUrlFn: () => 'local',
        workers: 1,
        shouldStop: async () => stopped,
        onProgress: (message) => messages.push(message),
      }),
    ).resolves.toBe(1);
    expect(messages).toContain(
      'scan: stopped by request, 1 repos processed this run, 1 failed',
    );
    expect(state.candidates.get(2)?.status).toBe('pending');
  });
});
