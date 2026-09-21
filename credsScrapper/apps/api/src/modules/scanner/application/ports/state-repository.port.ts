import { EFindingStatus } from '../../domain/constant/finding-status.constant';
import { ESecretType } from '../../domain/constant/secret-type.constant';
import {
  IFindingInput,
  IFindingRecord,
  IFindingsFilter,
  IFindingsPage,
  IFindingsRepoOption,
  ISecretTypeCount,
  IStatusCount,
  ITestingFacets,
  ITestingFacetsFilter,
} from '../../domain/types/finding-record.type';
import { IQueueStatus } from '../../domain/types/queue-status.type';
import { IRepoRef } from '../../domain/types/repo-ref.type';
import { IScannedRepoRecord } from '../../domain/types/scanned-repo-record.type';
import { EScanPhase } from '../../domain/constant/scan-phase.constant';
import {
  ICompletedScanPhase,
  IInterruptedScanPhase,
  IScanPhaseRecord,
} from '../../domain/types/scan-phase-record.type';
import { IScanCheckpoint } from '../types/scan-checkpoint.type';

// Abstract class rather than an interface: the class itself doubles as
// the NestJS DI token (`{ provide: StateRepositoryPort, useClass: ... }`),
// no companion Symbol/string token needed.
export abstract class StateRepositoryPort {
  /** Returns true if a new candidate row was inserted, false if repoId is already known. */
  abstract addCandidate(
    repoId: number,
    owner: string,
    name: string,
  ): Promise<boolean>;

  abstract isKnown(repoId: number): Promise<boolean>;

  /**
   * Atomically claims one pending unit of work (a candidate, or a
   * requeued stale scanned_repos row) and marks it in_progress.
   * Returns null if nothing is pending.
   */
  abstract claimNext(): Promise<IRepoRef | null>;

  abstract markDone(
    repoId: number,
    lastCommitSha: string,
    scannerVersion?: string,
  ): Promise<void>;

  abstract getScanCheckpoint(repoId: number): Promise<IScanCheckpoint | null>;

  abstract schedulePhase(
    repoId: number,
    phase: EScanPhase,
    targetSha: string,
  ): Promise<void>;

  abstract claimPhase(
    repoId: number,
    phase: EScanPhase,
    targetSha: string,
  ): Promise<boolean>;

  abstract getPhase(
    repoId: number,
    phase: EScanPhase,
  ): Promise<IScanPhaseRecord | null>;

  abstract listPendingPhases(phase: EScanPhase): Promise<IScanPhaseRecord[]>;

  abstract markPhaseDone(
    repoId: number,
    phase: EScanPhase,
    result: ICompletedScanPhase,
  ): Promise<void>;

  abstract markPhaseIncomplete(
    repoId: number,
    phase: EScanPhase,
    result: IInterruptedScanPhase,
  ): Promise<void>;

  abstract markPhaseFailed(
    repoId: number,
    phase: EScanPhase,
    result: IInterruptedScanPhase,
  ): Promise<void>;

  abstract markPhaseCancelled(
    repoId: number,
    phase: EScanPhase,
    result: IInterruptedScanPhase,
  ): Promise<void>;

  abstract markFailed(repoId: number, reason: string): Promise<void>;

  /**
   * Directly (re)starts a scan for a specific repo, bypassing the shared
   * candidate queue - creates or resets its ScannedRepo row to
   * in_progress. Used for a user-triggered scan of their own approved
   * repo, which must never grab an unrelated queued repo via claimNext().
   */
  abstract startRepoScan(
    repoId: number,
    owner: string,
    name: string,
  ): Promise<void>;

  /** Resets in_progress rows older than timeoutSeconds back to pending. Returns count changed. */
  abstract requeueStale(timeoutSeconds: number): Promise<number>;

  /** Resets failed rows with retryCount < maxRetries back to pending. Returns count changed. */
  abstract requeueFailed(maxRetries: number): Promise<number>;

  abstract addFinding(
    repoId: number,
    owner: string,
    name: string,
    filePath: string,
    commitSha: string,
    secretType: ESecretType,
    secretValue: string,
    lineNumber: number,
    context: string | null,
  ): Promise<void>;

  /**
   * Batch insert for a whole scan's worth of findings at once, skipping
   * any (secretType, secretValue) pair already recorded for this repo -
   * one existing-rows lookup plus a few chunked createMany calls, instead
   * of a per-finding findFirst+create round-trip. A single noisy repo can
   * produce hundreds of thousands of findings; addFinding one at a time
   * made persisting those take minutes after the scan itself had already
   * finished. addFinding (singular) is unchanged and still used directly
   * by tests that only need to seed one fixture row.
   */
  abstract addFindings(
    repoId: number,
    owner: string,
    name: string,
    findings: readonly IFindingInput[],
  ): Promise<void>;

  /** Clear prior live-test results only for the successfully rescanned repo/service. */
  abstract resetTestResults(
    repoId: number,
    secretTypes: readonly ESecretType[],
  ): Promise<void>;

  abstract updateFindingStatus(
    id: number,
    status: EFindingStatus,
  ): Promise<void>;

  /** Same as updateFindingStatus, but also stamps checkedAt - use for a live key-validation result, never a manual mark. */
  abstract recordTestResult(
    id: number,
    status: EFindingStatus,
    testReason?: string | null,
  ): Promise<void>;

  abstract countFindings(repoId: number): Promise<number>;

  abstract getQueueStatus(): Promise<IQueueStatus>;

  /** total counts every row matching the filter, ignoring limit/offset - what pagination needs. */
  abstract listFindings(filter: IFindingsFilter): Promise<IFindingsPage>;

  /** A single finding by its id, or null if it doesn't exist - an O(1) lookup, unlike paging through listFindings to find one row by id. */
  abstract getFindingById(id: number): Promise<IFindingRecord | null>;

  /**
   * Distinct repos that have at least one finding, with their finding
   * count - options for the repo filter dropdown. When secretTypes is
   * given, both the count and which repos even appear are scoped to
   * findings of those types only (e.g. the Testing tab only cares about
   * repos with at least one live-testable finding).
   */
  abstract listFindingsRepoOptions(
    limit: number,
    secretTypes?: readonly ESecretType[],
  ): Promise<IFindingsRepoOption[]>;

  /** Repo options (with finding counts) for exactly the given owner/name pairs, case-insensitive match. Returns only pairs that have at least one finding (matching secretTypes, if given). */
  abstract findFindingsRepoOptionsByOwnerName(
    pairs: ReadonlyArray<{ owner: string; name: string }>,
    secretTypes?: readonly ESecretType[],
  ): Promise<IFindingsRepoOption[]>;

  /** Finding count per secret type, only for types with at least one finding. */
  abstract listFindingsSecretTypeCounts(
    repoId?: number,
  ): Promise<ISecretTypeCount[]>;

  /** Finding count per status (valid/invalid/unknown), optionally restricted to a repo and/or a set of secret types. */
  abstract listFindingsStatusCounts(
    repoId?: number,
    secretTypes?: readonly ESecretType[],
  ): Promise<IStatusCount[]>;

  /** Counts for each Testing filter, applying the other two filters but not its own. */
  abstract getTestingFacets(
    filter: ITestingFacetsFilter,
  ): Promise<ITestingFacets>;

  /** Most recently scanned repos first, newest attempt (started/scanned) on top. */
  abstract listScannedRepos(limit: number): Promise<IScannedRepoRecord[]>;
}
