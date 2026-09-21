import { EFindingStatus } from '../constant/finding-status.constant';
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
  readonly status: EFindingStatus;
  readonly testReason?: string | null;
  readonly checkedAt: Date | null;
  readonly leakCommits: readonly string[];
}

export interface IFindingsFilter {
  readonly secretTypes?: readonly ESecretType[];
  readonly repoIds?: readonly number[];
  readonly statuses?: readonly EFindingStatus[];
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
  readonly validCount: number;
  readonly invalidCount: number;
  readonly failedCount: number;
  readonly unknownCount: number;
}

export interface ISecretTypeCount {
  readonly secretType: ESecretType;
  readonly count: number;
}

export interface IStatusCount {
  readonly status: EFindingStatus;
  readonly count: number;
}

export interface ITestingFacetsFilter {
  readonly repoId?: number;
  readonly status?: EFindingStatus;
  readonly secretTypes: readonly ESecretType[];
  readonly testableTypes: readonly ESecretType[];
  /** Restricts regular users to approved repositories; absent for administrators. */
  readonly scopeRepoIds?: readonly number[];
}

export interface ITestingFacets {
  readonly repositories: readonly IFindingsRepoOption[];
  readonly statuses: readonly IStatusCount[];
  readonly secretTypes: readonly ISecretTypeCount[];
}

/** One finding to persist via addFindings - everything except the repo/owner/name it belongs to (those are shared across a whole scan's batch). */
export interface IFindingInput {
  readonly filePath: string;
  readonly commitSha: string;
  /** All commits where this secret was seen when worker events were compacted. */
  readonly commitShas?: readonly string[];
  readonly secretType: ESecretType;
  readonly secretValue: string;
  readonly lineNumber: number;
  readonly context: string | null;
}
