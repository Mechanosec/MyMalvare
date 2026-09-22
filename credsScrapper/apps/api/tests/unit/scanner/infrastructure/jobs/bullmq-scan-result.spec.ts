import { BullmqJobWorker } from '../../../../../src/modules/scanner/infrastructure/jobs/bullmq-job-worker';
import { ScanRepositoryUseCase } from '../../../../../src/modules/scanner/application/use-cases/scan-repository.use-case';
import { TScanJobResult } from '../../../../../src/modules/scanner/application/use-cases/run-scan-job.use-case';
import { EJobStatus } from '../../../../../src/modules/scanner/domain/constant/job-status.constant';
import { FakeStateRepository } from '../../fakes/fake-state-repository';
import { FakeLogger } from '../../fakes/fake-logger';
import { FakeScanJobQueue } from '../../fakes/fake-scan-job-queue';
import { JobQueuePort } from '../../../../../src/modules/scanner/application/ports/job-queue.port';
import { EScanControlState } from '../../../../../src/modules/scanner/domain/constant/scan-control.constant';

describe('BullMQ result mapping with real scan orchestrator (no Redis)', () => {
  it.each(['done', 'failed'] as const)(
    'maps repository %s to the corresponding job outcome',
    async (status) => {
      const state = new FakeStateRepository();
      await state.startRepoScan(1, 'local', 'repo');
      const result: TScanJobResult =
        status === 'done'
          ? { status, headSha: 'a'.repeat(40) }
          : { status, failReason: 'synthetic failure' };
      const scanner = new ScanRepositoryUseCase(
        { run: async () => result },
        state,
        new FakeLogger(),
        { remove: async () => {} },
      );
      const events: Array<{ status: EJobStatus; processed?: number }> = [];
      const jobs = new FakeScanJobQueue();
      jest.spyOn(jobs as JobQueuePort, 'readScanControl').mockResolvedValue({
        epoch: 0,
        state: EScanControlState.READY,
        stopEpoch: null,
        requestedAt: null,
        finishedAt: null,
      });
      const worker = new BullmqJobWorker(
        {} as never,
        {} as never,
        scanner,
        {
          emit: (event) => {
            events.push(event);
          },
        },
        jobs,
        undefined,
        undefined,
        undefined,
        state,
      );
      const job = {
        id: 'unit',
        name: 'scan-repo',
        data: {
          repoRef: { repoId: 1, owner: 'local', name: 'repo' },
          cloneSource: 'unused',
          workdir: 'virtual',
        },
        updateProgress: async () => {},
      };
      // Exercise the real processor without starting a Redis-backed Worker.
      const process = (
        worker as unknown as { process(job: unknown): Promise<void> }
      ).process.bind(worker);
      if (status === 'failed') {
        await expect(process(job)).rejects.toThrow('synthetic failure');
        expect(events[events.length - 1].status).toBe(EJobStatus.FAILED);
      } else {
        await expect(process(job)).resolves.toBeUndefined();
        expect(events[events.length - 1]).toMatchObject({
          status: EJobStatus.DONE,
          processed: 1,
        });
      }
    },
  );
});
