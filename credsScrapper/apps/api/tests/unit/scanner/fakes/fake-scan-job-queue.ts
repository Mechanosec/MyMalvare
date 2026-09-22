import { JobQueuePort } from '../../../../src/modules/scanner/application/ports/job-queue.port';

export class FakeScanJobQueue extends JobQueuePort {
  enqueued: Array<{ type: string; payload: unknown }> = [];

  async enqueue(type: string, payload: unknown): Promise<string> {
    this.enqueued.push({ type, payload });
    return 'fake-job-id';
  }

  async getJob(): Promise<null> {
    return null;
  }

  async requestStop(): Promise<void> {}

  async isStopRequested(): Promise<boolean> {
    return false;
  }

  async readScanControl(): Promise<never> {
    throw new Error('FakeScanJobQueue scan control not configured');
  }

  async requestStopAllScans(): Promise<never> {
    throw new Error('FakeScanJobQueue scan control not configured');
  }

  async getScanRuntime(): Promise<never> {
    throw new Error('FakeScanJobQueue scan control not configured');
  }

  async hasActiveScansBefore(): Promise<never> {
    throw new Error('FakeScanJobQueue scan control not configured');
  }

  async hasOtherActiveScanForRepo(
    _repoId: number,
    _currentJobId: string,
    _currentTimestamp: number,
  ): Promise<boolean> {
    return false;
  }

  async completeScanStop(): Promise<never> {
    throw new Error('FakeScanJobQueue scan control not configured');
  }
}
