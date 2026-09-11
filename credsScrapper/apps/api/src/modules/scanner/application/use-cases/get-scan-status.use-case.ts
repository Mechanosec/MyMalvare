import { IQueueStatus } from '../../domain/types/queue-status.type';
import { StateRepositoryPort } from '../ports/state-repository.port';

export class GetScanStatusUseCase {
  constructor(private readonly state: StateRepositoryPort) {}

  async execute(): Promise<IQueueStatus> {
    return this.state.getQueueStatus();
  }
}
