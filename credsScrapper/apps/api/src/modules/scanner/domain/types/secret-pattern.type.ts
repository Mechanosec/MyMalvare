import { ESecretType } from '../constant/secret-type.constant';

export interface ISecretPattern {
  readonly secretType: ESecretType;
  readonly pattern: RegExp;
}
