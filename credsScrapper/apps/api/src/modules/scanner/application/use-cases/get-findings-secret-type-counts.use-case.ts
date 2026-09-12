import { ESecretType } from '../../domain/constant/secret-type.constant';
import { ISecretTypeCount } from '../../domain/types/finding-record.type';
import { StateRepositoryPort } from '../ports/state-repository.port';

/** Every ESecretType value, defaulting to 0 for types with no findings yet. */
export function fillZeroSecretTypeCounts(counts: readonly ISecretTypeCount[]): ISecretTypeCount[] {
  const bySecretType = new Map(counts.map((c) => [c.secretType, c.count]));
  return Object.values(ESecretType).map((secretType) => ({
    secretType,
    count: bySecretType.get(secretType) ?? 0,
  }));
}

export class GetFindingsSecretTypeCountsUseCase {
  constructor(private readonly state: StateRepositoryPort) {}

  async execute(repoId?: number): Promise<ISecretTypeCount[]> {
    return fillZeroSecretTypeCounts(await this.state.listFindingsSecretTypeCounts(repoId));
  }
}
