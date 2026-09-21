import { RepoAuthorizationRepositoryPort } from '../ports/repo-authorization-repository.port';
import { StateRepositoryPort } from '../../../scanner/application/ports/state-repository.port';
import { KeyValidatorPort } from '../../../scanner/application/ports/key-validator.port';
import { IFindingRecord } from '../../../scanner/domain/types/finding-record.type';
import { findOwnedFinding } from './find-owned-finding';

export class TestFindingUseCase {
  constructor(
    private readonly authorizations: RepoAuthorizationRepositoryPort,
    private readonly state: StateRepositoryPort,
    private readonly validator: KeyValidatorPort,
  ) {}

  /** Returns null if the finding doesn't exist or isn't in one of the caller's own approved repos. */
  async execute(
    userId: number,
    findingId: number,
  ): Promise<IFindingRecord | null> {
    const finding = await findOwnedFinding(
      this.authorizations,
      this.state,
      userId,
      findingId,
    );
    if (!finding) {
      return null;
    }

    const { status, reason } = await this.validator.validateDetailed(
      finding.secretType,
      finding.secretValue,
      undefined,
    );
    await this.state.recordTestResult(finding.id, status, reason);

    return { ...finding, status, testReason: reason, checkedAt: new Date() };
  }
}
