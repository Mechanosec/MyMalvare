import { IFindingsFilter, IFindingsPage } from '../../domain/types/finding-record.type';
import { StateRepositoryPort } from '../ports/state-repository.port';

export class GetFindingsUseCase {
  constructor(private readonly state: StateRepositoryPort) {}

  async execute(filter: IFindingsFilter): Promise<IFindingsPage> {
    return this.state.listFindings(filter);
  }
}
