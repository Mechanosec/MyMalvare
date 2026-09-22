import { EScanControlState } from '../../domain/constant/scan-control.constant';
import { JobQueuePort } from '../ports/job-queue.port';
import { StateRepositoryPort } from '../ports/state-repository.port';

export class ReconcileScanStopUseCase {
  constructor(
    private readonly state: StateRepositoryPort,
    private readonly jobs: JobQueuePort,
  ) {}

  async execute(): Promise<void> {
    const control = await this.jobs.readScanControl();
    if (control.state !== EScanControlState.STOPPING) return;
    await this.state.cancelScansBefore(control.epoch);
    if (await this.jobs.hasActiveScansBefore(control.epoch)) return;
    await this.state.cancelScansBefore(control.epoch);
    if (await this.jobs.hasActiveScansBefore(control.epoch)) return;
    await this.jobs.completeScanStop(control.epoch);
  }
}
