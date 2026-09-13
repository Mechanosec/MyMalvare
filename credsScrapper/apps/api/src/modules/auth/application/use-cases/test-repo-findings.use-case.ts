import { RepoAuthorizationRepositoryPort } from '../ports/repo-authorization-repository.port';
import { ERepoAuthorizationStatus } from '../../domain/constant/repo-authorization-status.constant';
import { StateRepositoryPort } from '../../../scanner/application/ports/state-repository.port';
import { KeyValidatorPort } from '../../../scanner/application/ports/key-validator.port';
import { ESecretType } from '../../../scanner/domain/constant/secret-type.constant';
import { IFindingRecord } from '../../../scanner/domain/types/finding-record.type';

export class TestRepoFindingsUseCase {
  constructor(
    private readonly authorizations: RepoAuthorizationRepositoryPort,
    private readonly state: StateRepositoryPort,
    private readonly validator: KeyValidatorPort,
  ) {}

  /**
   * Returns null if the user has no APPROVED authorization matching this
   * repo's owner/name - the caller (controller) maps that to a 403.
   */
  async execute(userId: number, repoId: number): Promise<readonly IFindingRecord[] | null> {
    const { items } = await this.state.listFindings({ repoIds: [repoId], limit: 1000 });
    if (items.length === 0) {
      return [];
    }

    const { owner, name } = items[0];
    const approved = await this.authorizations.listByUser(userId);
    const isApproved = approved.some(
      (a) =>
        a.status === ERepoAuthorizationStatus.APPROVED &&
        a.owner.toLowerCase() === owner.toLowerCase() &&
        a.name.toLowerCase() === name.toLowerCase(),
    );
    if (!isApproved) {
      return null;
    }

    const pairedAwsSecret = items.find((f) => f.secretType === ESecretType.AWS_SECRET_ACCESS_KEY)?.secretValue;
    for (const finding of items) {
      const pairedValue = finding.secretType === ESecretType.AWS_ACCESS_KEY_ID ? pairedAwsSecret : undefined;
      const status = await this.validator.validate(finding.secretType, finding.secretValue, pairedValue);
      await this.state.recordTestResult(finding.id, status);
    }

    return (await this.state.listFindings({ repoIds: [repoId], limit: 1000 })).items;
  }
}
