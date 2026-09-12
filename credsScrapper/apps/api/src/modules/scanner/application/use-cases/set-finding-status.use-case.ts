import { EFindingStatus } from '../../domain/constant/finding-status.constant';
import { StateRepositoryPort } from '../ports/state-repository.port';

export class SetFindingStatusUseCase {
  constructor(private readonly state: StateRepositoryPort) {}

  async execute(id: number, status: EFindingStatus): Promise<void> {
    await this.state.updateFindingStatus(id, status);
  }
}
