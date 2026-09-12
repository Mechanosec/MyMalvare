import { RepoAuthorizationRepositoryPort } from '../ports/repo-authorization-repository.port';
import { ERepoAuthorizationStatus } from '../../domain/constant/repo-authorization-status.constant';
import { StateRepositoryPort } from '../../../scanner/application/ports/state-repository.port';
import { IFindingRecord } from '../../../scanner/domain/types/finding-record.type';

/** Returns the finding only if it belongs to one of the caller's own admin-approved repos, else null. */
export async function findOwnedFinding(
  authorizations: RepoAuthorizationRepositoryPort,
  state: StateRepositoryPort,
  userId: number,
  findingId: number,
): Promise<IFindingRecord | null> {
  const finding = await state.getFindingById(findingId);
  if (!finding) {
    return null;
  }
  const approved = (await authorizations.listByUser(userId)).filter(
    (a) => a.status === ERepoAuthorizationStatus.APPROVED,
  );
  const owns = approved.some(
    (a) => a.owner.toLowerCase() === finding.owner.toLowerCase() && a.name.toLowerCase() === finding.name.toLowerCase(),
  );
  return owns ? finding : null;
}
