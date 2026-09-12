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
  readonly secretTypes?: readonly ESecretType[];
  readonly repoIds?: readonly number[];
  /** Free-text, matched against owner/name (as "owner/name" too), filePath, and context. */
  readonly search?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export interface IFindingsPage {
  readonly items: readonly IFindingRecord[];
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
