import { ScanRepositoryPhaseUseCase } from '../../../../../src/modules/scanner/application/use-cases/scan-repository-phase.use-case';
import {
  EScanPhase,
  EScanPhaseStatus,
} from '../../../../../src/modules/scanner/domain/constant/scan-phase.constant';
import { HeadScanWorkerPort } from '../../../../../src/modules/scanner/application/ports/head-scan-worker.port';
import { HistoryScanWorkerPort } from '../../../../../src/modules/scanner/application/ports/history-scan-worker.port';
import { ESecretType } from '../../../../../src/modules/scanner/domain/constant/secret-type.constant';
import { FakeStateRepository } from '../../fakes/fake-state-repository';
import { FakeLogger } from '../../fakes/fake-logger';

const sha = 'a'.repeat(40);

function worker(result = { status: 'done' as const, headSha: sha }) {
  return {
    run: async (
      _repo: unknown,
      _source: string,
      _workdir: string,
      onEvent: (event: unknown) => void,
    ) => {
      onEvent({
        type: 'finding',
        filePath: 'config.txt',
        commitSha: sha,
        finding: {
          secretType: ESecretType.AWS_ACCESS_KEY_ID,
          secretValue: 'synthetic-value',
          lineNumber: 1,
          context: null,
        },
      });
      return result;
    },
  };
}

describe('ScanRepositoryPhaseUseCase', () => {
  const ref = { repoId: 1, owner: 'local', name: 'fixture' };

  it('returns cancelled before phase scheduling, cache acquisition or worker for a pre-aborted signal', async () => {
    const state = new FakeStateRepository();
    await state.startRepoScan(ref.repoId, ref.owner, ref.name, 7);
    const acquire = jest.fn();
    const run = jest.fn();
    const scanner = new ScanRepositoryPhaseUseCase(
      { run } as unknown as HeadScanWorkerPort,
      { run } as unknown as HistoryScanWorkerPort,
      state,
      new FakeLogger(),
      { remove: async () => {} },
      { acquire } as never,
    );
    const controller = new AbortController();
    controller.abort();

    await expect(
      scanner.execute({
        repoRef: ref,
        phase: EScanPhase.HEAD,
        cloneSource: 'local',
        workdir: '/work/repo-1',
        scanEpoch: 7,
        signal: controller.signal,
      }),
    ).resolves.toMatchObject({
      status: 'cancelled',
      failReason: 'scan_cancelled',
    });
    expect(await state.getPhase(1, EScanPhase.HEAD)).toBeNull();
    expect(acquire).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it('propagates a control-read failure even when the phase signal is aborted', async () => {
    const state = new FakeStateRepository();
    const controller = new AbortController();
    controller.abort();
    const scanner = new ScanRepositoryPhaseUseCase(
      worker() as unknown as HeadScanWorkerPort,
      worker() as unknown as HistoryScanWorkerPort,
      state,
      new FakeLogger(),
      { remove: async () => {} },
      { acquire: jest.fn() } as never,
    );

    await expect(
      scanner.execute({
        repoRef: ref,
        phase: EScanPhase.HEAD,
        cloneSource: 'local',
        workdir: '/work/repo-1',
        signal: controller.signal,
        shouldStop: async () => {
          throw new Error('scan_control_unavailable');
        },
      }),
    ).rejects.toThrow('scan_control_unavailable');
    expect(await state.getPhase(1, EScanPhase.HEAD)).toBeNull();
  });

  it('keeps the admitted epoch on HEAD and skips HISTORY scheduling after Stop', async () => {
    const state = new FakeStateRepository();
    await state.startRepoScan(ref.repoId, ref.owner, ref.name, 7);
    let stopped = false;
    const head = {
      run: async () => {
        stopped = true;
        return { status: 'done' as const, headSha: sha };
      },
    };
    const scanner = new ScanRepositoryPhaseUseCase(
      head as unknown as HeadScanWorkerPort,
      worker() as unknown as HistoryScanWorkerPort,
      state,
      new FakeLogger(),
      { remove: async () => {} },
      {
        acquire: async () => ({
          repoPath: '/cache/head',
          scannerVersion: 'v2',
          release: async () => {},
        }),
      },
    );

    await expect(
      scanner.execute({
        repoRef: ref,
        phase: EScanPhase.HEAD,
        cloneSource: 'local',
        workdir: '/work/repo-1',
        scanEpoch: 7,
        shouldStop: async () => stopped,
      }),
    ).resolves.toMatchObject({ status: 'done', headSha: sha });
    expect(await state.getPhase(1, EScanPhase.HEAD)).toMatchObject({
      status: EScanPhaseStatus.DONE,
      scanEpoch: 7,
    });
    expect(await state.getPhase(1, EScanPhase.HISTORY)).toBeNull();
  });

  it('persists HEAD findings and coverage before scheduling history', async () => {
    const state = new FakeStateRepository();
    await state.startRepoScan(ref.repoId, ref.owner, ref.name);
    const release = jest.fn(async () => {});
    const scanner = new ScanRepositoryPhaseUseCase(
      worker() as unknown as HeadScanWorkerPort,
      worker() as unknown as HistoryScanWorkerPort,
      state,
      new FakeLogger(),
      { remove: async () => {} },
      {
        acquire: async () => ({
          repoPath: '/cache/head',
          scannerVersion: 'v2',
          release,
        }),
      },
    );

    await expect(
      scanner.execute({
        repoRef: ref,
        phase: EScanPhase.HEAD,
        cloneSource: 'local',
        workdir: '/work/repo-1',
      }),
    ).resolves.toMatchObject({ status: 'done', headSha: sha });

    expect(state.findings).toHaveLength(1);
    expect(await state.getPhase(1, EScanPhase.HEAD)).toMatchObject({
      status: EScanPhaseStatus.DONE,
      completedSha: sha,
    });
    expect(await state.getPhase(1, EScanPhase.HISTORY)).toMatchObject({
      status: EScanPhaseStatus.PENDING,
      targetSha: sha,
    });
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('does not advance HEAD or schedule history when findings persistence fails', async () => {
    const state = new FakeStateRepository();
    await state.startRepoScan(ref.repoId, ref.owner, ref.name);
    jest
      .spyOn(state, 'addFindings')
      .mockRejectedValue(new Error('write failed'));
    const scanner = new ScanRepositoryPhaseUseCase(
      worker() as unknown as HeadScanWorkerPort,
      worker() as unknown as HistoryScanWorkerPort,
      state,
      new FakeLogger(),
      { remove: async () => {} },
      {
        acquire: async () => ({
          repoPath: '/cache/head',
          scannerVersion: 'v2',
          release: async () => {},
        }),
      },
    );

    await expect(
      scanner.execute({
        repoRef: ref,
        phase: EScanPhase.HEAD,
        cloneSource: 'local',
        workdir: '/work/repo-1',
      }),
    ).resolves.toMatchObject({ status: 'failed' });
    expect(await state.getPhase(1, EScanPhase.HEAD)).toMatchObject({
      status: EScanPhaseStatus.FAILED,
      completedSha: null,
    });
    expect(await state.getPhase(1, EScanPhase.HISTORY)).toBeNull();
  });
});
