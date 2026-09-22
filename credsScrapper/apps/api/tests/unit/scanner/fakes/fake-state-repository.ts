import { StateRepositoryPort } from '../../../../src/modules/scanner/application/ports/state-repository.port';
import { ECandidateStatus } from '../../../../src/modules/scanner/domain/constant/candidate-status.constant';
import { EFindingStatus } from '../../../../src/modules/scanner/domain/constant/finding-status.constant';
import { EScanStatus } from '../../../../src/modules/scanner/domain/constant/scan-status.constant';
import {
  EScanPhase,
  EScanPhaseStatus,
} from '../../../../src/modules/scanner/domain/constant/scan-phase.constant';
import { ESecretType } from '../../../../src/modules/scanner/domain/constant/secret-type.constant';
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
} from '../../../../src/modules/scanner/domain/types/finding-record.type';
import { IQueueStatus } from '../../../../src/modules/scanner/domain/types/queue-status.type';
import { IRepoRef } from '../../../../src/modules/scanner/domain/types/repo-ref.type';
import { IScannedRepoRecord } from '../../../../src/modules/scanner/domain/types/scanned-repo-record.type';
import {
  ICompletedScanPhase,
  IInterruptedScanPhase,
  IScanPhaseRecord,
} from '../../../../src/modules/scanner/domain/types/scan-phase-record.type';
import { parseLeakCommits } from '../../../../src/modules/scanner/infrastructure/persistence/prisma-state.mapper';

interface CandidateRow extends IRepoRef {
  status: ECandidateStatus;
}

interface ScannedRow extends IRepoRef {
  status: EScanStatus;
  scanEpoch?: number;
  startedAt?: Date;
  scannedAt?: Date;
  lastCommitSha?: string;
  failReason?: string;
  retryCount?: number;
}

/** In-memory fake used by unit tests instead of a real database. */
export class FakeStateRepository extends StateRepositoryPort {
  async getScanCheckpoint() {
    return null;
  }
  readonly candidates = new Map<number, CandidateRow>();
  readonly scanned = new Map<number, ScannedRow>();
  readonly phases = new Map<string, IScanPhaseRecord>();
  readonly findings: Array<{
    repoId: number;
    owner: string;
    name: string;
    filePath: string;
    commitSha: string;
    secretType: ESecretType;
    secretValue: string;
    lineNumber: number;
    context: string | null;
    status: EFindingStatus;
    checkedAt: Date | null;
    testReason: string | null;
    leakCommits: string;
  }> = [];

  private phaseKey(repoId: number, phase: EScanPhase): string {
    return `${repoId}:${phase}`;
  }

  async schedulePhase(
    repoId: number,
    phase: EScanPhase,
    targetSha: string,
    scanEpoch = 0,
  ): Promise<void> {
    const previous = this.phases.get(this.phaseKey(repoId, phase));
    const repo = this.scanned.get(repoId);
    if (
      (repo?.scanEpoch ?? 0) > scanEpoch ||
      (repo?.scanEpoch === scanEpoch &&
        repo.status === EScanStatus.CANCELLED) ||
      (previous?.scanEpoch ?? 0) > scanEpoch ||
      (previous?.scanEpoch === scanEpoch &&
        previous.status === EScanPhaseStatus.CANCELLED &&
        (repo?.scanEpoch !== scanEpoch ||
          repo.status !== EScanStatus.IN_PROGRESS))
    )
      return;
    this.phases.set(this.phaseKey(repoId, phase), {
      repoId,
      phase,
      status: EScanPhaseStatus.PENDING,
      targetSha,
      completedSha: previous?.completedSha ?? null,
      scannerVersion: previous?.scannerVersion ?? null,
      startedAt: null,
      completedAt: null,
      reason: null,
      retryCount: previous?.retryCount ?? 0,
      scanEpoch,
    });
  }

  async claimPhase(
    repoId: number,
    phase: EScanPhase,
    targetSha: string,
    scanEpoch = 0,
  ): Promise<boolean> {
    const key = this.phaseKey(repoId, phase);
    const record = this.phases.get(key);
    const repo = this.scanned.get(repoId);
    if (
      !record ||
      !repo ||
      repo.scanEpoch !== scanEpoch ||
      repo.status === EScanStatus.CANCELLED ||
      record.status !== EScanPhaseStatus.PENDING ||
      record.targetSha !== targetSha ||
      record.scanEpoch !== scanEpoch
    )
      return false;
    this.phases.set(key, {
      ...record,
      status: EScanPhaseStatus.RUNNING,
      startedAt: new Date(),
    });
    return true;
  }

  async getPhase(repoId: number, phase: EScanPhase) {
    return this.phases.get(this.phaseKey(repoId, phase)) ?? null;
  }

  async listPendingPhases(phase: EScanPhase) {
    return [...this.phases.values()].filter(
      (record) =>
        record.phase === phase && record.status === EScanPhaseStatus.PENDING,
    );
  }

  async markPhaseDone(
    repoId: number,
    phase: EScanPhase,
    result: ICompletedScanPhase,
  ): Promise<void> {
    const previous = this.phases.get(this.phaseKey(repoId, phase));
    if (
      !previous ||
      previous.status !== EScanPhaseStatus.RUNNING ||
      previous.scanEpoch !== (result.scanEpoch ?? 0) ||
      (previous.targetSha !== result.targetSha &&
        !(phase === EScanPhase.HEAD && previous.targetSha === 'latest'))
    )
      return;
    this.phases.set(this.phaseKey(repoId, phase), {
      repoId,
      phase,
      status: EScanPhaseStatus.DONE,
      targetSha: result.targetSha,
      completedSha: result.completedSha,
      scannerVersion: result.scannerVersion,
      startedAt: null,
      completedAt: new Date(),
      reason: null,
      retryCount: previous.retryCount,
      scanEpoch: previous.scanEpoch,
    });
    if (phase === EScanPhase.HEAD)
      await this.markDone(
        repoId,
        result.completedSha,
        result.scannerVersion,
        result.scanEpoch ?? 0,
      );
  }

  async markPhaseIncomplete(
    repoId: number,
    phase: EScanPhase,
    result: IInterruptedScanPhase,
  ): Promise<void> {
    this.markPhaseInterrupted(
      repoId,
      phase,
      result,
      EScanPhaseStatus.INCOMPLETE,
    );
  }

  async markPhaseFailed(
    repoId: number,
    phase: EScanPhase,
    result: IInterruptedScanPhase,
  ): Promise<void> {
    this.markPhaseInterrupted(repoId, phase, result, EScanPhaseStatus.FAILED);
  }

  async markPhaseCancelled(
    repoId: number,
    phase: EScanPhase,
    result: IInterruptedScanPhase,
  ): Promise<void> {
    this.markPhaseInterrupted(
      repoId,
      phase,
      result,
      EScanPhaseStatus.CANCELLED,
    );
  }

  private markPhaseInterrupted(
    repoId: number,
    phase: EScanPhase,
    result: IInterruptedScanPhase,
    status: EScanPhaseStatus,
  ): void {
    const previous = this.phases.get(this.phaseKey(repoId, phase));
    if (
      !previous ||
      previous.status !== EScanPhaseStatus.RUNNING ||
      previous.scanEpoch !== (result.scanEpoch ?? 0) ||
      (previous.targetSha !== result.targetSha &&
        !(phase === EScanPhase.HEAD && previous.targetSha === 'latest'))
    )
      return;
    this.phases.set(this.phaseKey(repoId, phase), {
      repoId,
      phase,
      status,
      targetSha: result.targetSha,
      completedSha: previous?.completedSha ?? null,
      scannerVersion: previous?.scannerVersion ?? null,
      startedAt: previous?.startedAt ?? null,
      completedAt: new Date(),
      reason: result.reason,
      retryCount:
        previous.retryCount + (status === EScanPhaseStatus.FAILED ? 1 : 0),
      scanEpoch: previous.scanEpoch,
    });
    if (phase === EScanPhase.HEAD) {
      const row = this.scanned.get(repoId);
      if (
        row &&
        (row.scanEpoch ?? 0) === previous.scanEpoch &&
        row.status !== EScanStatus.CANCELLED
      ) {
        row.status =
          status === EScanPhaseStatus.CANCELLED
            ? EScanStatus.CANCELLED
            : EScanStatus.FAILED;
        if (status !== EScanPhaseStatus.CANCELLED)
          row.failReason = result.reason;
        if (status === EScanPhaseStatus.FAILED)
          row.retryCount = (row.retryCount ?? 0) + 1;
      }
    }
  }

  async addCandidate(
    repoId: number,
    owner: string,
    name: string,
  ): Promise<boolean> {
    if (await this.isKnown(repoId)) {
      return false;
    }
    this.candidates.set(repoId, {
      repoId,
      owner,
      name,
      status: ECandidateStatus.PENDING,
    });
    return true;
  }

  async isKnown(repoId: number): Promise<boolean> {
    return this.candidates.has(repoId) || this.scanned.has(repoId);
  }

  async claimNext(scanEpoch = 0): Promise<IRepoRef | null> {
    for (const candidate of this.candidates.values()) {
      if (candidate.status === ECandidateStatus.PENDING) {
        candidate.status = ECandidateStatus.CLAIMED;
        this.scanned.set(candidate.repoId, {
          repoId: candidate.repoId,
          owner: candidate.owner,
          name: candidate.name,
          status: EScanStatus.IN_PROGRESS,
          startedAt: new Date(),
          scanEpoch,
        });
        return {
          repoId: candidate.repoId,
          owner: candidate.owner,
          name: candidate.name,
        };
      }
    }
    for (const row of this.scanned.values()) {
      if (
        row.status === EScanStatus.PENDING &&
        (row.scanEpoch ?? 0) <= scanEpoch
      ) {
        row.status = EScanStatus.IN_PROGRESS;
        row.startedAt = new Date();
        row.scanEpoch = scanEpoch;
        return { repoId: row.repoId, owner: row.owner, name: row.name };
      }
    }
    return null;
  }

  async markDone(
    repoId: number,
    lastCommitSha?: string,
    scannerVersion?: string,
    scanEpoch = 0,
  ): Promise<void> {
    const row = this.scanned.get(repoId);
    if (
      row &&
      (row.scanEpoch ?? 0) === scanEpoch &&
      row.status !== EScanStatus.CANCELLED
    ) {
      row.status = EScanStatus.DONE;
      if (lastCommitSha !== undefined) row.lastCommitSha = lastCommitSha;
      row.scannedAt = new Date();
    }
  }

  async markFailed(
    repoId: number,
    reason: string,
    scanEpoch = 0,
  ): Promise<void> {
    const row = this.scanned.get(repoId);
    if (
      row &&
      (row.scanEpoch ?? 0) === scanEpoch &&
      row.status !== EScanStatus.CANCELLED
    ) {
      row.status = EScanStatus.FAILED;
      row.failReason = reason;
      row.retryCount = (row.retryCount ?? 0) + 1;
    }
  }

  async startRepoScan(
    repoId: number,
    owner: string,
    name: string,
    scanEpoch = 0,
    restartCancelled = false,
  ): Promise<void> {
    const existing = this.scanned.get(repoId);
    if (
      existing &&
      ((existing.scanEpoch ?? 0) > scanEpoch ||
        (existing.scanEpoch === scanEpoch &&
          existing.status === EScanStatus.CANCELLED &&
          !restartCancelled))
    )
      return;
    const candidate = this.candidates.get(repoId);
    if (candidate) candidate.status = ECandidateStatus.CLAIMED;
    this.scanned.set(repoId, {
      ...existing,
      repoId,
      owner,
      name,
      status: EScanStatus.IN_PROGRESS,
      startedAt: new Date(),
      scanEpoch,
    });
  }

  async cancelScansBefore(epoch: number): Promise<void> {
    for (const [key, phase] of this.phases) {
      if (
        phase.scanEpoch < epoch &&
        [EScanPhaseStatus.PENDING, EScanPhaseStatus.RUNNING].includes(
          phase.status,
        )
      ) {
        this.phases.set(key, {
          ...phase,
          status: EScanPhaseStatus.CANCELLED,
          completedAt: new Date(),
          reason: 'scan_cancelled',
        });
      }
    }
    for (const row of this.scanned.values()) {
      if (
        (row.scanEpoch ?? 0) < epoch &&
        [EScanStatus.PENDING, EScanStatus.IN_PROGRESS].includes(row.status)
      )
        row.status = EScanStatus.CANCELLED;
    }
  }

  async requeueStale(): Promise<number> {
    let count = 0;
    for (const row of this.scanned.values()) {
      if (row.status === EScanStatus.IN_PROGRESS) {
        row.status = EScanStatus.PENDING;
        count += 1;
      }
    }
    return count;
  }

  async requeueFailed(maxRetries: number): Promise<number> {
    let count = 0;
    for (const row of this.scanned.values()) {
      if (
        row.status === EScanStatus.FAILED &&
        (row.retryCount ?? 0) < maxRetries
      ) {
        row.status = EScanStatus.PENDING;
        count += 1;
      }
    }
    return count;
  }

  async addFinding(
    repoId: number,
    owner: string,
    name: string,
    filePath: string,
    commitSha: string,
    secretType: ESecretType,
    secretValue: string,
    lineNumber: number,
    context: string | null,
  ): Promise<void> {
    this.findings.push({
      repoId,
      owner,
      name,
      filePath,
      commitSha,
      secretType,
      secretValue,
      lineNumber,
      context,
      status: EFindingStatus.UNKNOWN,
      checkedAt: null,
      testReason: null,
      leakCommits: '[]',
    });
  }

  async addFindings(
    repoId: number,
    owner: string,
    name: string,
    findings: readonly IFindingInput[],
  ): Promise<void> {
    for (const finding of findings) {
      await this.addFinding(
        repoId,
        owner,
        name,
        finding.filePath,
        finding.commitSha,
        finding.secretType,
        finding.secretValue,
        finding.lineNumber,
        finding.context,
      );
    }
  }

  async resetTestResults(
    repoId: number,
    secretTypes: readonly ESecretType[],
  ): Promise<void> {
    for (const row of this.findings) {
      if (row.repoId === repoId && secretTypes.includes(row.secretType)) {
        row.status = EFindingStatus.UNKNOWN;
        row.checkedAt = null;
        row.testReason = null;
      }
    }
  }

  async updateFindingStatus(id: number, status: EFindingStatus): Promise<void> {
    const row = this.findings[id];
    if (row) {
      row.status = status;
      if (status === EFindingStatus.UNKNOWN) {
        row.checkedAt = null;
        row.testReason = null;
      }
    }
  }

  async recordTestResult(
    id: number,
    status: EFindingStatus,
    testReason?: string | null,
  ): Promise<void> {
    const row = this.findings[id];
    if (row) {
      row.status = status;
      row.checkedAt = new Date();
      row.testReason = testReason ?? null;
    }
  }

  async countFindings(repoId: number): Promise<number> {
    return this.findings.filter((f) => f.repoId === repoId).length;
  }

  async getQueueStatus(): Promise<IQueueStatus> {
    const scannedByStatus: Partial<Record<EScanStatus, number>> = {};
    for (const row of this.scanned.values()) {
      scannedByStatus[row.status] = (scannedByStatus[row.status] ?? 0) + 1;
    }
    const pendingCandidates = [...this.candidates.values()].filter(
      (c) => c.status === ECandidateStatus.PENDING,
    ).length;
    return { pendingCandidates, scannedByStatus };
  }

  async listFindings(filter: IFindingsFilter): Promise<IFindingsPage> {
    const search = filter.search?.toLowerCase();
    const matching = this.findings
      .map((f, id) => ({ f, id }))
      .filter(
        ({ f }) =>
          !filter.secretTypes?.length ||
          filter.secretTypes.includes(f.secretType),
      )
      .filter(
        ({ f }) => !filter.repoIds?.length || filter.repoIds.includes(f.repoId),
      )
      .filter(
        ({ f }) =>
          !filter.statuses?.length || filter.statuses.includes(f.status),
      )
      .filter(
        ({ f }) =>
          !search ||
          `${f.owner}/${f.name}`.toLowerCase().includes(search) ||
          f.filePath.toLowerCase().includes(search) ||
          (f.context ?? '').toLowerCase().includes(search),
      )
      .map(({ f, id }) => {
        const leakCommits = parseLeakCommits(f.leakCommits);
        return { id, foundAt: new Date(), ...f, leakCommits };
      });
    const offset = filter.offset ?? 0;
    const limit = filter.limit ?? 100;
    return {
      items: matching.slice(offset, offset + limit),
      total: matching.length,
    };
  }

  async getFindingById(id: number): Promise<IFindingRecord | null> {
    const row = this.findings[id];
    if (!row) return null;
    return {
      id,
      foundAt: new Date(),
      ...row,
      leakCommits: parseLeakCommits(row.leakCommits),
    };
  }

  private bumpRepoOption(
    counts: Map<number, IFindingsRepoOption>,
    f: { repoId: number; owner: string; name: string; status: EFindingStatus },
  ): void {
    const existing = counts.get(f.repoId) ?? {
      repoId: f.repoId,
      owner: f.owner,
      name: f.name,
      count: 0,
      validCount: 0,
      invalidCount: 0,
      failedCount: 0,
      unknownCount: 0,
    };
    counts.set(f.repoId, {
      ...existing,
      count: existing.count + 1,
      validCount:
        existing.validCount + (f.status === EFindingStatus.VALID ? 1 : 0),
      invalidCount:
        existing.invalidCount + (f.status === EFindingStatus.INVALID ? 1 : 0),
      failedCount:
        existing.failedCount + (f.status === EFindingStatus.FAILED ? 1 : 0),
      unknownCount:
        existing.unknownCount + (f.status === EFindingStatus.UNKNOWN ? 1 : 0),
    });
  }

  async listFindingsRepoOptions(
    limit: number,
    secretTypes?: readonly ESecretType[],
  ): Promise<IFindingsRepoOption[]> {
    const counts = new Map<number, IFindingsRepoOption>();
    for (const f of this.findings) {
      if (secretTypes?.length && !secretTypes.includes(f.secretType)) continue;
      this.bumpRepoOption(counts, f);
    }
    return [...counts.values()].slice(0, limit);
  }

  async findFindingsRepoOptionsByOwnerName(
    pairs: ReadonlyArray<{ owner: string; name: string }>,
    secretTypes?: readonly ESecretType[],
  ): Promise<IFindingsRepoOption[]> {
    const wanted = new Set(
      pairs.map((p) => `${p.owner.toLowerCase()}/${p.name.toLowerCase()}`),
    );
    const counts = new Map<number, IFindingsRepoOption>();
    for (const f of this.findings) {
      if (!wanted.has(`${f.owner.toLowerCase()}/${f.name.toLowerCase()}`))
        continue;
      if (secretTypes?.length && !secretTypes.includes(f.secretType)) continue;
      this.bumpRepoOption(counts, f);
    }
    return [...counts.values()];
  }

  async listFindingsSecretTypeCounts(
    repoId?: number,
  ): Promise<ISecretTypeCount[]> {
    const counts = new Map<ESecretType, number>();
    for (const f of this.findings) {
      if (repoId !== undefined && f.repoId !== repoId) continue;
      counts.set(f.secretType, (counts.get(f.secretType) ?? 0) + 1);
    }
    return [...counts.entries()].map(([secretType, count]) => ({
      secretType,
      count,
    }));
  }

  async listFindingsStatusCounts(
    repoId?: number,
    secretTypes?: readonly ESecretType[],
  ): Promise<IStatusCount[]> {
    const counts = new Map<EFindingStatus, number>();
    for (const f of this.findings) {
      if (repoId !== undefined && f.repoId !== repoId) continue;
      if (secretTypes?.length && !secretTypes.includes(f.secretType)) continue;
      counts.set(f.status, (counts.get(f.status) ?? 0) + 1);
    }
    return [...counts.entries()].map(([status, count]) => ({ status, count }));
  }

  async getTestingFacets(
    filter: ITestingFacetsFilter,
  ): Promise<ITestingFacets> {
    const scoped = this.findings.filter(
      (finding) =>
        (!filter.scopeRepoIds ||
          filter.scopeRepoIds.includes(finding.repoId)) &&
        filter.testableTypes.includes(finding.secretType),
    );
    const selectedTypes = filter.secretTypes.length
      ? filter.secretTypes
      : filter.testableTypes;
    const repositories = new Map<number, IFindingsRepoOption>();
    const statusCounts = new Map<EFindingStatus, number>();
    const typeCounts = new Map<ESecretType, number>();
    for (const finding of scoped) {
      if (selectedTypes.includes(finding.secretType)) {
        if (filter.repoId === undefined || finding.repoId === filter.repoId) {
          statusCounts.set(
            finding.status,
            (statusCounts.get(finding.status) ?? 0) + 1,
          );
        }
        if (filter.status === undefined || finding.status === filter.status) {
          this.bumpRepoOption(repositories, finding);
        }
      }
      if (
        (filter.repoId === undefined || finding.repoId === filter.repoId) &&
        (filter.status === undefined || finding.status === filter.status)
      ) {
        typeCounts.set(
          finding.secretType,
          (typeCounts.get(finding.secretType) ?? 0) + 1,
        );
      }
    }
    return {
      repositories: [...repositories.values()],
      statuses: Object.values(EFindingStatus).map((status) => ({
        status,
        count: statusCounts.get(status) ?? 0,
      })),
      secretTypes: [...typeCounts.entries()].map(([secretType, count]) => ({
        secretType,
        count,
      })),
    };
  }

  async listScannedRepos(limit: number): Promise<IScannedRepoRecord[]> {
    return [...this.scanned.values()].slice(0, limit).map((row) => ({
      repoId: row.repoId,
      owner: row.owner,
      name: row.name,
      status: row.status,
      lastCommitSha: row.lastCommitSha ?? null,
      startedAt: row.startedAt ?? null,
      scannedAt: row.scannedAt ?? null,
      failReason: row.failReason ?? null,
      retryCount: row.retryCount ?? 0,
      scanEpoch: row.scanEpoch ?? 0,
      findingsCount: this.findings.filter((f) => f.repoId === row.repoId)
        .length,
      headPhase:
        this.phases.get(this.phaseKey(row.repoId, EScanPhase.HEAD)) ?? null,
      historyPhase:
        this.phases.get(this.phaseKey(row.repoId, EScanPhase.HISTORY)) ?? null,
    }));
  }
}
