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

export interface IFindingsPage {
  readonly items: readonly IFinding[];
  readonly total: number;
}

export interface IFindingsRepoOption {
  readonly repoId: number;
  readonly owner: string;
  readonly name: string;
  readonly count: number;
}

export interface ISecretTypeCount {
  readonly secretType: ESecretType;
  readonly count: number;
}
