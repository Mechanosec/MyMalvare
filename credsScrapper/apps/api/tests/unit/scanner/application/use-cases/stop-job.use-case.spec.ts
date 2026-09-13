import { JobQueuePort } from '../../../../../src/modules/scanner/application/ports/job-queue.port';
import { StopJobUseCase } from '../../../../../src/modules/scanner/application/use-cases/stop-job.use-case';

describe('StopJobUseCase', () => {
  it('requests a stop on the given job id via the job queue port', async () => {
    const jobQueue = { requestStop: jest.fn() } as unknown as JobQueuePort;
    const useCase = new StopJobUseCase(jobQueue);

    await useCase.execute('job-123');

    expect(jobQueue.requestStop).toHaveBeenCalledWith('job-123');
  });
});
