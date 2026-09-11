import { IScannedRepoRecord } from '../../domain/types/scanned-repo-record.type';
import { StateRepositoryPort } from '../ports/state-repository.port';

export class GetScannedReposUseCase {
  constructor(private readonly state: StateRepositoryPort) {}

  async execute(limit = 100): Promise<IScannedRepoRecord[]> {
    return this.state.listScannedRepos(limit);
  }
}
