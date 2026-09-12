import { StateRepositoryPort } from '../ports/state-repository.port';
import { KeyValidatorPort } from '../ports/key-validator.port';
import { IFindingRecord } from '../../domain/types/finding-record.type';

// Admin-only, unscoped counterpart to AdminTestRepoFindingsUseCase - tests
// one finding regardless of which repo it belongs to.
export class AdminTestFindingUseCase {
  constructor(
    private readonly state: StateRepositoryPort,
    private readonly validator: KeyValidatorPort,
  ) {}

  async execute(findingId: number): Promise<IFindingRecord | null> {
    const finding = await this.state.getFindingById(findingId);
    if (!finding) {
      return null;
    }

    const status = await this.validator.validate(finding.secretType, finding.secretValue);
    await this.state.recordTestResult(finding.id, status);

    return { ...finding, status, checkedAt: new Date() };
  }
}
