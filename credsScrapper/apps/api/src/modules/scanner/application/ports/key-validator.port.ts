import { EFindingStatus } from '../../domain/constant/finding-status.constant';
import { ESecretType } from '../../domain/constant/secret-type.constant';

// Only invoked for a finding whose repo has an admin-approved
// RepoAuthorization (see auth/application/use-cases/test-repo-findings.use-case.ts)
// - this is the one place in the codebase allowed to make a live network
// call using a discovered credential, and only because that gate exists.
export interface IValidationResult {
  readonly status: EFindingStatus;
  readonly reason: string | null;
}

export abstract class KeyValidatorPort {
  async validateDetailed(
    secretType: ESecretType,
    secretValue: string,
    pairedValue?: string,
  ): Promise<IValidationResult> {
    return {
      status: await this.validate(secretType, secretValue, pairedValue),
      reason: null,
    };
  }

  /**
   * Returns VALID/INVALID only on an unambiguous auth response from the
   * service (e.g. 401/403, or a provider's explicit "invalid credential"
   * body). Any other outcome - no validator registered for this type,
   * network error, timeout, unexpected response - returns FAILED rather
   * than guessing, since a false INVALID would wrongly tell someone a
   * live key is dead. UNKNOWN is reserved for findings never tested.
   */
  /**
   * pairedValue is for the rare secret type whose live check needs a
   * second value alongside secretValue - today only AWS_ACCESS_KEY_ID,
   * supplied explicitly by a caller that already knows the pair. New AWS
   * findings carry JSON { access, private } in secretValue; never infer a
   * pair by selecting another finding from the same repository.
   * Every other type ignores it.
   */
  abstract validate(
    secretType: ESecretType,
    secretValue: string,
    pairedValue?: string,
  ): Promise<EFindingStatus>;
}
