import { ProgressPort } from '../../../../../src/modules/scanner/application/ports/progress.port';
import { EJobStatus, EJobType } from '../../../../../src/modules/scanner/domain/constant/job-status.constant';
import { IJobProgressEvent } from '../../../../../src/modules/scanner/domain/types/job-progress-event.type';
import { InMemoryJobRunner } from '../../../../../src/modules/scanner/infrastructure/jobs/in-memory-job-runner';

class RecordingProgress extends ProgressPort {
  readonly emitted: IJobProgressEvent[] = [];
  emit(event: IJobProgressEvent): void {
    this.emitted.push(event);
  }
}

describe('InMemoryJobRunner', () => {
  it('retains every emitted event in the job log, not just the latest', async () => {
    const progress = new RecordingProgress();
    const runner = new InMemoryJobRunner(progress);

    const jobId = runner.start(EJobType.SCAN, async (onProgress) => {
      onProgress('scan: repo1 - cloning');
      onProgress('scan: repo1 - done, 0 findings total', 1);
      return 1;
    });
    await new Promise((resolve) => setImmediate(resolve));

    const job = runner.get(jobId);
    const messages = job?.log.map((e) => e.message) ?? [];
    expect(messages).toEqual([
      'scan started',
      'scan: repo1 - cloning',
      'scan: repo1 - done, 0 findings total',
      'scan finished: 1 processed',
    ]);
    expect(job?.status).toBe(EJobStatus.DONE);
  });

  it('a fresh GET (job.log) can replay history for a client that connects late', async () => {
    const progress = new RecordingProgress();
    const runner = new InMemoryJobRunner(progress);

    const jobId = runner.start(EJobType.DISCOVER, async (onProgress) => {
      onProgress('discovery: starting to read events');
      return 5;
    });
    await new Promise((resolve) => setImmediate(resolve));

    // Simulates a page reload: nothing was listening on the WebSocket for
    // the events above, but they're still readable from job state.
    const job = runner.get(jobId);
    expect(job?.log.length).toBeGreaterThanOrEqual(2);
    expect(job?.log[0].message).toBe('discover started');
  });
});
