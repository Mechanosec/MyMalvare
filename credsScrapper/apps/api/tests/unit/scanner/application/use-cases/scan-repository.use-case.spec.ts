import { ScanWorkerPort } from '../../../../../src/modules/scanner/application/ports/scan-worker.port';
import { WorkdirCleanerPort } from '../../../../../src/modules/scanner/application/ports/workdir-cleaner.port';
import { ScanRepositoryUseCase } from '../../../../../src/modules/scanner/application/use-cases/scan-repository.use-case';
import { IScanJobEvent, TScanJobResult } from '../../../../../src/modules/scanner/application/use-cases/run-scan-job.use-case';
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

  it('persists each finding event from the worker and marks the repo done', async () => {
    const worker = new FakeScanWorker();
    worker.events = [
      {
        type: 'finding',
        filePath: 'config.py',
        commitSha: 'a'.repeat(40),
        finding: { secretType: ESecretType.AWS_ACCESS_KEY_ID, secretValue: 'AKIAABCDEFGH12345678', lineNumber: 1, context: null },
      },
    ];
    const state = new FakeStateRepository();
    const useCase = new ScanRepositoryUseCase(worker, state, new FakeLogger(), new FakeWorkdirCleaner());
    await state.addCandidate(1, 'octocat', 'hello-world');
    await state.claimNext();

    await useCase.execute(ref, 'https://example.com/repo.git', 'workdir/repo-1');

    expect(state.scanned.get(1)?.status).toBe(EScanStatus.DONE);
    expect(state.findings).toHaveLength(1);
    expect(state.findings[0].secretValue).toBe('AKIAABCDEFGH12345678');
  });

  it('forwards progress events through onProgress', async () => {
    const worker = new FakeScanWorker();
    worker.events = [{ type: 'progress', message: 'scan: octocat/hello-world - cloning' }];
    const state = new FakeStateRepository();
    const useCase = new ScanRepositoryUseCase(worker, state, new FakeLogger(), new FakeWorkdirCleaner());
    await state.addCandidate(1, 'octocat', 'hello-world');
    await state.claimNext();
    const messages: string[] = [];

    await useCase.execute(ref, 'https://example.com/repo.git', 'workdir/repo-1', (m) => messages.push(m));

    expect(messages).toContain('scan: octocat/hello-world - cloning');
  });

  it('marks the repo failed when the worker resolves a failed result', async () => {
    const worker = new FakeScanWorker();
    worker.result = { status: 'failed', failReason: 'clone failed' };
    const state = new FakeStateRepository();
    const useCase = new ScanRepositoryUseCase(worker, state, new FakeLogger(), new FakeWorkdirCleaner());
    await state.addCandidate(1, 'octocat', 'hello-world');
    await state.claimNext();

    await useCase.execute(ref, 'https://example.com/repo.git', 'workdir/repo-1');

    expect(state.scanned.get(1)?.status).toBe(EScanStatus.FAILED);
  });

  it('marks the repo failed and resolves without throwing when the worker rejects', async () => {
    const worker = new FakeScanWorker();
    worker.rejection = new Error('worker thread crashed');
    const state = new FakeStateRepository();
    const cleaner = new FakeWorkdirCleaner();
    const useCase = new ScanRepositoryUseCase(worker, state, new FakeLogger(), cleaner);
    await state.addCandidate(1, 'octocat', 'hello-world');
    await state.claimNext();

    await expect(
      useCase.execute(ref, 'https://example.com/repo.git', 'workdir/repo-1'),
    ).resolves.toBeUndefined();

    expect(state.scanned.get(1)?.status).toBe(EScanStatus.FAILED);
    expect(state.scanned.get(1)?.failReason).toBe('worker thread crashed');
    expect(cleaner.removed).toEqual(['workdir/repo-1', 'workdir/repo-1']);
  });

  it('cleans the workdir before dispatching and again after', async () => {
    const worker = new FakeScanWorker();
    const state = new FakeStateRepository();
    const cleaner = new FakeWorkdirCleaner();
    const useCase = new ScanRepositoryUseCase(worker, state, new FakeLogger(), cleaner);
    await state.addCandidate(1, 'octocat', 'hello-world');
    await state.claimNext();

    await useCase.execute(ref, 'https://example.com/repo.git', 'workdir/repo-1');

    expect(cleaner.removed).toEqual(['workdir/repo-1', 'workdir/repo-1']);
  });
});
