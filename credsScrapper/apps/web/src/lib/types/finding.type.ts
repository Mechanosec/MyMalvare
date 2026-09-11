import { ESecretType } from '../constant/secret-type.constant';

// Mirrors apps/api's IFindingRecord.
export interface IFinding {
  readonly id: number;
  readonly repoId: number;
  readonly owner: string;
  readonly name: string;
  readonly filePath: string;
  readonly commitSha: string;
  readonly secretType: ESecretType;
  readonly secretValue: string;
  readonly lineNumber: number | null;
  readonly context: string | null;
  readonly foundAt: string;
}
