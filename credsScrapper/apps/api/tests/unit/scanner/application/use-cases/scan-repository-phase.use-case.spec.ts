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
