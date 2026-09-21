import { StateRepositoryPort } from '../ports/state-repository.port';
import { KeyValidatorPort } from '../ports/key-validator.port';
import { ESecretType } from '../../domain/constant/secret-type.constant';
import { IFindingRecord } from '../../domain/types/finding-record.type';
import { findPairedAwsSecretKey } from './find-paired-aws-secret';

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

    const pairedValue =
      finding.secretType === ESecretType.AWS_ACCESS_KEY_ID
        ? await findPairedAwsSecretKey(this.state, finding.repoId)
        : undefined;
    const { status, reason } = await this.validator.validateDetailed(
      finding.secretType,
      finding.secretValue,
      pairedValue,
    );
    await this.state.recordTestResult(finding.id, status, reason);

    return { ...finding, status, testReason: reason, checkedAt: new Date() };
  }
}
