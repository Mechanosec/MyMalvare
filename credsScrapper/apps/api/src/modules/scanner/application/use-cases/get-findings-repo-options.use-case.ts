import { IFindingsRepoOption } from '../../domain/types/finding-record.type';
import { StateRepositoryPort } from '../ports/state-repository.port';

export class GetFindingsRepoOptionsUseCase {
  constructor(private readonly state: StateRepositoryPort) {}

  async execute(limit = 500): Promise<IFindingsRepoOption[]> {
    return this.state.listFindingsRepoOptions(limit);
  }
}
