import { ESecretType } from '../constant/secret-type.constant';

export interface IFindingRecord {
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
  readonly foundAt: Date;
}

export interface IFindingsFilter {
  readonly secretType?: ESecretType;
  readonly owner?: string;
  readonly name?: string;
  readonly limit?: number;
  readonly offset?: number;
}
