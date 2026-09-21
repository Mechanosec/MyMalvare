import { ScanWorkerPort } from '../../../../../src/modules/scanner/application/ports/scan-worker.port';
import { WorkdirCleanerPort } from '../../../../../src/modules/scanner/application/ports/workdir-cleaner.port';
import { ScanRepositoryUseCase } from '../../../../../src/modules/scanner/application/use-cases/scan-repository.use-case';
import {
  IScanJobEvent,
  TScanJobResult,
} from '../../../../../src/modules/scanner/application/use-cases/run-scan-job.use-case';
import { ESecretType } from '../../../../../src/modules/scanner/domain/constant/secret-type.constant';
import { EScanStatus } from '../../../../../src/modules/scanner/domain/constant/scan-status.constant';
import { FakeLogger } from '../../fakes/fake-logger';
import { FakeStateRepository } from '../../fakes/fake-state-repository';

class FakeScanWorker extends ScanWorkerPort {
  events: IScanJobEvent[] = [];
  result: TScanJobResult = { status: 'done', headSha: 'a'.repeat(40) };
  rejection?: Error;

  async run(
    _repoRef: unknown,
    _cloneSource: string,
    _workdir: string,
    onEvent: (event: IScanJobEvent) => void,
  ): Promise<TScanJobResult> {
    if (this.rejection) {
      throw this.rejection;
    }
    for (const event of this.events) {
      onEvent(event);
    }
    return this.result;
  }
}

class FakeWorkdirCleaner extends WorkdirCleanerPort {
  removed: string[] = [];
  async remove(path: string): Promise<void> {
    this.removed.push(path);
  }
}

describe('ScanRepositoryUseCase', () => {
  const ref = { repoId: 1, owner: 'octocat', name: 'hello-world' };

  it('holds the cache lease through persistence and never advances checkpoint on a failed write', async () => {
    const worker = new FakeScanWorker();
    const state = new FakeStateRepository();
    await state.startRepoScan(1, ref.owner, ref.name);
    const cleaner = new FakeWorkdirCleaner();
    const released = jest.fn(async () => {});
    const cache = {
      acquire: jest.fn(async () => ({
        repoPath: '/cache/repo',
        scannerVersion: 'v1',
        release: released,
      })),
    };
    const done = jest.spyOn(state, 'markDone');
    const persist = jest
      .spyOn(state, 'addFindings')
      .mockImplementation(async () => {
        expect(released).not.toHaveBeenCalled();
        throw new Error('synthetic write failure');
      });
    const useCase = new ScanRepositoryUseCase(
      worker,
      state,
      new FakeLogger(),
      cleaner,
      cache,
    );
    expect((await useCase.execute(ref, 'source', '/work/repo')).status).toBe(
      'failed',
    );
    expect(done).not.toHaveBeenCalled();
    expect(released).toHaveBeenCalledTimes(1);
    expect(cleaner.removed).toEqual([]);
    persist.mockResolvedValue(undefined);
    expect((await useCase.execute(ref, 'source', '/work/repo')).status).toBe(
      'done',
    );
    expect(done).toHaveBeenCalledWith(1, 'a'.repeat(40), 'v1');
    expect(released).toHaveBeenCalledTimes(2);
  });

  it('does not overwrite another process scan status on a cache lock conflict', async () => {
    const state = new FakeStateRepository();
    const failed = jest.spyOn(state, 'markFailed');
    const cache = {
      acquire: jest.fn().mockRejectedValue(new Error('cache locked')),
    };
    const useCase = new ScanRepositoryUseCase(
      new FakeScanWorker(),
      state,
      new FakeLogger(),
      new FakeWorkdirCleaner(),
      cache,
    );
    expect((await useCase.execute(ref, 'source', '/work/repo')).status).toBe(
      'failed',
    );
    expect(failed).not.toHaveBeenCalled();
  });

  it('persists each finding event from the worker and marks the repo done', async () => {
    const worker = new FakeScanWorker();
    worker.events = [
      {
        type: 'finding',
        filePath: 'config.py',
        commitSha: 'a'.repeat(40),
        commitShas: ['b'.repeat(40), 'a'.repeat(40)],
        finding: {
          secretType: ESecretType.AWS_ACCESS_KEY_ID,
          secretValue: 'AKIAABCDEFGH12345678',
          lineNumber: 1,
          context: null,
        },
      },
    ];
    const state = new FakeStateRepository();
    const persist = jest.spyOn(state, 'addFindings');
    const useCase = new ScanRepositoryUseCase(
      worker,
      state,
      new FakeLogger(),
      new FakeWorkdirCleaner(),
    );
    await state.addCandidate(1, 'octocat', 'hello-world');
    await state.claimNext();

    await useCase.execute(
      ref,
      'https://example.com/repo.git',
      'workdir/repo-1',
    );

    expect(state.scanned.get(1)?.status).toBe(EScanStatus.DONE);
    expect(state.findings).toHaveLength(1);
    expect(state.findings[0].secretValue).toBe('AKIAABCDEFGH12345678');
    expect(persist).toHaveBeenCalledWith(
      1,
      'octocat',
      'hello-world',
      expect.arrayContaining([
        expect.objectContaining({
          commitShas: ['b'.repeat(40), 'a'.repeat(40)],
        }),
      ]),
    );
  });

  it('forwards progress events through onProgress', async () => {
    const worker = new FakeScanWorker();
    worker.events = [
      { type: 'progress', message: 'scan: octocat/hello-world - cloning' },
    ];
    const state = new FakeStateRepository();
    const useCase = new ScanRepositoryUseCase(
      worker,
      state,
      new FakeLogger(),
      new FakeWorkdirCleaner(),
    );
    await state.addCandidate(1, 'octocat', 'hello-world');
    await state.claimNext();
    const messages: string[] = [];

    await useCase.execute(
      ref,
      'https://example.com/repo.git',
      'workdir/repo-1',
      (m) => messages.push(m),
    );

    expect(messages).toContain('scan: octocat/hello-world - cloning');
  });

  it('marks the repo failed when the worker resolves a failed result', async () => {
    const worker = new FakeScanWorker();
    worker.result = { status: 'failed', failReason: 'clone failed' };
    const state = new FakeStateRepository();
    const useCase = new ScanRepositoryUseCase(
      worker,
      state,
      new FakeLogger(),
      new FakeWorkdirCleaner(),
    );
    await state.addCandidate(1, 'octocat', 'hello-world');
    await state.claimNext();

    await useCase.execute(
      ref,
      'https://example.com/repo.git',
      'workdir/repo-1',
    );

    expect(state.scanned.get(1)?.status).toBe(EScanStatus.FAILED);
  });

  it('marks the repo failed and resolves without throwing when the worker rejects', async () => {
    const worker = new FakeScanWorker();
    worker.rejection = new Error('worker thread crashed');
    const state = new FakeStateRepository();
    const cleaner = new FakeWorkdirCleaner();
    const useCase = new ScanRepositoryUseCase(
      worker,
      state,
      new FakeLogger(),
      cleaner,
    );
    await state.addCandidate(1, 'octocat', 'hello-world');
    await state.claimNext();

    await expect(
      useCase.execute(ref, 'https://example.com/repo.git', 'workdir/repo-1'),
    ).resolves.toEqual({
      status: 'failed',
      failReason: 'worker thread crashed',
    });

    expect(state.scanned.get(1)?.status).toBe(EScanStatus.FAILED);
    expect(state.scanned.get(1)?.failReason).toBe('worker thread crashed');
    expect(cleaner.removed).toEqual(['workdir/repo-1', 'workdir/repo-1']);
  });

  it('cleans the workdir before dispatching and again after', async () => {
    const worker = new FakeScanWorker();
    const state = new FakeStateRepository();
    const cleaner = new FakeWorkdirCleaner();
    const useCase = new ScanRepositoryUseCase(
      worker,
      state,
      new FakeLogger(),
      cleaner,
    );
    await state.addCandidate(1, 'octocat', 'hello-world');
    await state.claimNext();

    await useCase.execute(
      ref,
      'https://example.com/repo.git',
      'workdir/repo-1',
    );

    expect(cleaner.removed).toEqual(['workdir/repo-1', 'workdir/repo-1']);
  });
  it('joins concurrent scans of the same repo before either can clean its workdir', async () => {
    const worker = new FakeScanWorker();
    let finish!: (result: TScanJobResult) => void;
    worker.run = jest.fn(
      () =>
        new Promise<TScanJobResult>((resolve) => {
          finish = resolve;
        }),
    );
    const state = new FakeStateRepository();
    await state.startRepoScan(ref.repoId, ref.owner, ref.name);
    const cleaner = new FakeWorkdirCleaner();
    const useCase = new ScanRepositoryUseCase(
      worker,
      state,
      new FakeLogger(),
      cleaner,
    );
    const first = useCase.execute(ref, 'local', 'workdir/repo-1');
    const second = useCase.execute(ref, 'local', 'workdir/repo-1');
    await Promise.resolve();
    expect(worker.run).toHaveBeenCalledTimes(1);
    expect(cleaner.removed).toEqual(['workdir/repo-1']);
    finish({ status: 'done', headSha: 'a'.repeat(40) });
    expect(await first).toEqual(await second);
    expect(cleaner.removed).toEqual(['workdir/repo-1', 'workdir/repo-1']);
    worker.run = jest.fn(async () => ({
      status: 'done' as const,
      headSha: 'b'.repeat(40),
    }));
    await useCase.execute(ref, 'local', 'workdir/repo-1');
    expect(worker.run).toHaveBeenCalledTimes(1); // a later explicit rescan is allowed
  });
});
