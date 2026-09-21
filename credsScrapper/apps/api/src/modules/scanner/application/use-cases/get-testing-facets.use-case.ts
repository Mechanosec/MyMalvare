import { StateRepositoryPort } from '../ports/state-repository.port';
import {
  ITestingFacets,
  ITestingFacetsFilter,
} from '../../domain/types/finding-record.type';

export class GetTestingFacetsUseCase {
  constructor(private readonly state: StateRepositoryPort) {}

  execute(
    filter: Omit<ITestingFacetsFilter, 'scopeRepoIds'>,
  ): Promise<ITestingFacets> {
    return this.state.getTestingFacets(filter);
  }
}
