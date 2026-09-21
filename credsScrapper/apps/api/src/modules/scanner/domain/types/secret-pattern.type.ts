import { ESecretType } from '../constant/secret-type.constant';

export interface ISecretPattern {
  readonly secretType: ESecretType;
  readonly pattern: RegExp;
  /** A cheap necessary condition used to skip a regex that cannot match. */
  readonly requiredMarker?: string | RegExp;
}
