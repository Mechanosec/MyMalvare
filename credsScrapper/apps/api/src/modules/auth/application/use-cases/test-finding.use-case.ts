import { RepoAuthorizationRepositoryPort } from '../ports/repo-authorization-repository.port';
import { StateRepositoryPort } from '../../../scanner/application/ports/state-repository.port';
import { KeyValidatorPort } from '../../../scanner/application/ports/key-validator.port';
import { ESecretType } from '../../../scanner/domain/constant/secret-type.constant';
import { IFindingRecord } from '../../../scanner/domain/types/finding-record.type';
import { findPairedAwsSecretKey } from '../../../scanner/application/use-cases/find-paired-aws-secret';
import { findOwnedFinding } from './find-owned-finding';

export class TestFindingUseCase {
  constructor(
    private readonly authorizations: RepoAuthorizationRepositoryPort,
    private readonly state: StateRepositoryPort,
    private readonly validator: KeyValidatorPort,
  ) {}

  /** Returns null if the finding doesn't exist or isn't in one of the caller's own approved repos. */
  async execute(userId: number, findingId: number): Promise<IFindingRecord | null> {
    const finding = await findOwnedFinding(this.authorizations, this.state, userId, findingId);
    if (!finding) {
      return null;
    }

    const pairedValue =
      finding.secretType === ESecretType.AWS_ACCESS_KEY_ID
        ? await findPairedAwsSecretKey(this.state, finding.repoId)
        : undefined;
    const status = await this.validator.validate(finding.secretType, finding.secretValue, pairedValue);
    await this.state.recordTestResult(finding.id, status);

    return { ...finding, status, checkedAt: new Date() };
  }
}
