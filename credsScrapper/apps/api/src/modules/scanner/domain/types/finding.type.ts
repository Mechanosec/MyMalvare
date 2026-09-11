import { ESecretType } from '../constant/secret-type.constant';

export interface IFinding {
  readonly secretType: ESecretType;
  readonly secretValue: string;
  readonly lineNumber: number;
  readonly context: string | null;
}
