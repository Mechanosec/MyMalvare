import { ESecretType } from '../../domain/constant/secret-type.constant';
import { ISecretTypeCount } from '../../domain/types/finding-record.type';
import { StateRepositoryPort } from '../ports/state-repository.port';

export class GetFindingsSecretTypeCountsUseCase {
  constructor(private readonly state: StateRepositoryPort) {}

  /** Every ESecretType value, defaulting to 0 for types with no findings yet. */
  async execute(): Promise<ISecretTypeCount[]> {
    const counts = await this.state.listFindingsSecretTypeCounts();
    const bySecretType = new Map(counts.map((c) => [c.secretType, c.count]));
    return Object.values(ESecretType).map((secretType) => ({
      secretType,
      count: bySecretType.get(secretType) ?? 0,
    }));
  }
}
