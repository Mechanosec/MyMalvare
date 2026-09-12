import { StateRepositoryPort } from '../ports/state-repository.port';
import { KeyValidatorPort } from '../ports/key-validator.port';
import { IFindingRecord } from '../../domain/types/finding-record.type';

// Admin-only, unscoped by RepoAuthorization - the caller (FindingsController)
// is already gated by AdminGuard. MVP stand-in for the future automated
// scan-and-alert flow: for now an admin manually triggers a live check on
// any repo's findings instead of the system doing it on a schedule.
export class AdminTestRepoFindingsUseCase {
  constructor(
    private readonly state: StateRepositoryPort,
    private readonly validator: KeyValidatorPort,
  ) {}

  async execute(repoId: number): Promise<readonly IFindingRecord[]> {
    const { items } = await this.state.listFindings({ repoIds: [repoId], limit: 1000 });
    for (const finding of items) {
      const status = await this.validator.validate(finding.secretType, finding.secretValue);
      await this.state.recordTestResult(finding.id, status);
    }
    return (await this.state.listFindings({ repoIds: [repoId], limit: 1000 })).items;
  }
}
