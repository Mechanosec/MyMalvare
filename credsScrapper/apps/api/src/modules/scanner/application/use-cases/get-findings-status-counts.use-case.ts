import { EFindingStatus } from '../../domain/constant/finding-status.constant';
import { ESecretType } from '../../domain/constant/secret-type.constant';
import { IStatusCount } from '../../domain/types/finding-record.type';
import { StateRepositoryPort } from '../ports/state-repository.port';

/** Every EFindingStatus value, defaulting to 0 for statuses with no findings yet. */
export function fillZeroStatusCounts(counts: readonly IStatusCount[]): IStatusCount[] {
  const byStatus = new Map(counts.map((c) => [c.status, c.count]));
  return Object.values(EFindingStatus).map((status) => ({
    status,
    count: byStatus.get(status) ?? 0,
  }));
}

export class GetFindingsStatusCountsUseCase {
  constructor(private readonly state: StateRepositoryPort) {}

  async execute(repoId?: number, secretTypes?: readonly ESecretType[]): Promise<IStatusCount[]> {
    return fillZeroStatusCounts(await this.state.listFindingsStatusCounts(repoId, secretTypes));
  }
}
