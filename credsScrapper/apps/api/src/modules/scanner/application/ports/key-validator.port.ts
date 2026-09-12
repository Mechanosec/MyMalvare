import { EFindingStatus } from '../../domain/constant/finding-status.constant';
import { ESecretType } from '../../domain/constant/secret-type.constant';

// Only invoked for a finding whose repo has an admin-approved
// RepoAuthorization (see auth/application/use-cases/test-repo-findings.use-case.ts)
// - this is the one place in the codebase allowed to make a live network
// call using a discovered credential, and only because that gate exists.
export abstract class KeyValidatorPort {
  /**
   * Returns VALID/INVALID only on an unambiguous auth response from the
   * service (e.g. 401/403, or a provider's explicit "invalid credential"
   * body). Any other outcome - no validator registered for this type,
   * network error, timeout, unexpected response - returns UNKNOWN rather
   * than guessing, since a false INVALID would wrongly tell someone a
   * live key is dead.
   */
  abstract validate(secretType: ESecretType, secretValue: string): Promise<EFindingStatus>;
}
