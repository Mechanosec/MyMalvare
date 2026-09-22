import { RescanRepositoryServiceUseCase } from '../../../../../src/modules/scanner/application/use-cases/rescan-repository-service.use-case';
import { ESecretType } from '../../../../../src/modules/scanner/domain/constant/secret-type.constant';

describe('authorized service rescan', () => {
  function setup() {
    const sha = 'a'.repeat(40);
    const head = {
      run: jest.fn().mockResolvedValue({ status: 'done', headSha: sha }),
    };
    const history = {
      run: jest.fn().mockResolvedValue({ status: 'done', headSha: sha }),
    };
    const release = jest.fn();
    const cache = {
      acquire: jest.fn().mockResolvedValue({
        repoPath: '/synthetic/cache',
        scannerVersion: 'new',
        release,
      }),
    };
    const state = {
      addFindings: jest.fn(),
      markPhaseDone: jest.fn(),
      resetTestResults: jest.fn(),
    };
    const useCase = new RescanRepositoryServiceUseCase(
      head as never,
      history as never,
      cache as never,
      state as never,
    );
    const options = {
      repoRef: { repoId: 1, owner: 'test', name: 'fixture' },
      cloneSource: '/synthetic/source',
      workdir: '/synthetic/work',
      secretType: ESecretType.GCP_SERVICE_ACCOUNT_KEY,
    };
    return { useCase, head, history, state, release, options, sha };
  }

  it('revisits unchanged history using current rules without claiming whole-repo coverage', async () => {
    const s = setup();
    await s.useCase.execute(s.options);
    await s.useCase.execute(s.options);
    expect(s.history.run).toHaveBeenCalledTimes(2);
    const execution = s.history.run.mock.calls[0][4];
    expect(execution).toMatchObject({
      targetSha: s.sha,
      scannerVersion: 'new',
      secretTypes: [ESecretType.GCP_SERVICE_ACCOUNT_KEY],
    });
    expect(execution.checkpoint).toBeUndefined();
    expect(s.state.markPhaseDone).not.toHaveBeenCalled();
    expect(s.release).toHaveBeenCalledTimes(4);
  });

  it('resets only the requested service after both phases complete', async () => {
    const s = setup();
    await s.useCase.execute(s.options);
    expect(s.state.resetTestResults).toHaveBeenCalledWith(1, [
      s.options.secretType,
    ]);
    expect(s.state.resetTestResults).toHaveBeenCalledTimes(1);
    expect(
      s.state.resetTestResults.mock.invocationCallOrder[0],
    ).toBeGreaterThan(s.history.run.mock.invocationCallOrder[0]);
  });

  it('includes both AWS credential parts in scanning and resetting', async () => {
    const s = setup();
    await s.useCase.execute({
      ...s.options,
      secretType: ESecretType.AWS_ACCESS_KEY_ID,
    });
    const types = [
      ESecretType.AWS_ACCESS_KEY_ID,
      ESecretType.AWS_SECRET_ACCESS_KEY,
    ];
    expect(s.head.run.mock.calls[0][4].secretTypes).toEqual(types);
    expect(s.history.run.mock.calls[0][4].secretTypes).toEqual(types);
    expect(s.state.resetTestResults).toHaveBeenCalledWith(1, types);
  });

  it('preserves previous test results if history fails', async () => {
    const s = setup();
    s.history.run.mockRejectedValue(new Error('synthetic failure'));
    await expect(s.useCase.execute(s.options)).rejects.toThrow(
      'synthetic failure',
    );
    expect(s.state.resetTestResults).not.toHaveBeenCalled();
    expect(s.release).toHaveBeenCalledTimes(2);
  });

  it('persists delivered findings and releases the cache on an incomplete attempt', async () => {
    const s = setup();
    s.head.run.mockResolvedValue({
      status: 'incomplete',
      failReason: 'scan_time_budget_exceeded',
    });
    expect(await s.useCase.execute(s.options)).toMatchObject({
      status: 'incomplete',
    });
    expect(s.state.addFindings).toHaveBeenCalledTimes(1);
    expect(s.history.run).not.toHaveBeenCalled();
    expect(s.state.resetTestResults).not.toHaveBeenCalled();
    expect(s.release).toHaveBeenCalledTimes(1);
  });

  it('stops between HEAD and HISTORY without resetting test results', async () => {
    const s = setup();
    let stopped = false;
    s.head.run.mockImplementation(async () => {
      stopped = true;
      return { status: 'done', headSha: s.sha };
    });

    expect(
      await s.useCase.execute({
        ...s.options,
        scanEpoch: 7,
        shouldStop: async () => stopped,
      }),
    ).toMatchObject({ status: 'cancelled', failReason: 'scan_cancelled' });
    expect(s.history.run).not.toHaveBeenCalled();
    expect(s.state.resetTestResults).not.toHaveBeenCalled();
    expect(s.release).toHaveBeenCalledTimes(1);
  });

  it('does not hide a control-read failure behind an aborted service signal', async () => {
    const s = setup();
    const controller = new AbortController();
    controller.abort();
    await expect(
      s.useCase.execute({
        ...s.options,
        signal: controller.signal,
        shouldStop: async () => {
          throw new Error('scan_control_unavailable');
        },
      }),
    ).rejects.toThrow('scan_control_unavailable');
    expect(s.head.run).not.toHaveBeenCalled();
    expect(s.history.run).not.toHaveBeenCalled();
  });
});
