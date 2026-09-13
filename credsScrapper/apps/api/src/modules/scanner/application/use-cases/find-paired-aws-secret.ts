import { ESecretType } from '../../domain/constant/secret-type.constant';
import { StateRepositoryPort } from '../ports/state-repository.port';

/**
 * Best-effort pairing: an AWS access key ID is useless to test alone -
 * SigV4 signing needs the matching secret key too. There's no explicit
 * link between the two findings, so this just takes the first
 * AWS_SECRET_ACCESS_KEY finding in the same repo, on the assumption that
 * a repo with a leaked AWS credential pair has both halves committed
 * somewhere, and most repos won't have more than one live pair to
 * disambiguate between.
 */
export async function findPairedAwsSecretKey(
  state: StateRepositoryPort,
  repoId: number,
): Promise<string | undefined> {
  const { items } = await state.listFindings({
    repoIds: [repoId],
    secretTypes: [ESecretType.AWS_SECRET_ACCESS_KEY],
    limit: 1,
  });
  return items[0]?.secretValue;
}
