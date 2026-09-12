import { StateRepositoryPort } from '../../../../src/modules/scanner/application/ports/state-repository.port';
import { ECandidateStatus } from '../../../../src/modules/scanner/domain/constant/candidate-status.constant';
import { EFindingStatus } from '../../../../src/modules/scanner/domain/constant/finding-status.constant';
import { EScanStatus } from '../../../../src/modules/scanner/domain/constant/scan-status.constant';
import { ESecretType } from '../../../../src/modules/scanner/domain/constant/secret-type.constant';
import {
  IFindingsFilter,
  IFindingsPage,
  IFindingsRepoOption,
  ISecretTypeCount,
} from '../../../../src/modules/scanner/domain/types/finding-record.type';
import { IQueueStatus } from '../../../../src/modules/scanner/domain/types/queue-status.type';
import { IRepoRef } from '../../../../src/modules/scanner/domain/types/repo-ref.type';
import { IScannedRepoRecord } from '../../../../src/modules/scanner/domain/types/scanned-repo-record.type';

interface CandidateRow extends IRepoRef {
  status: ECandidateStatus;
}

interface ScannedRow extends IRepoRef {
  status: EScanStatus;
  startedAt?: Date;
  scannedAt?: Date;
  lastCommitSha?: string;
  failReason?: string;
  retryCount?: number;
}

/** In-memory fake used by unit tests instead of a real database. */
export class FakeStateRepository extends StateRepositoryPort {
  readonly candidates = new Map<number, CandidateRow>();
  readonly scanned = new Map<number, ScannedRow>();
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
    leakCommits: string;
  }> = [];

  async addCandidate(repoId: number, owner: string, name: string): Promise<boolean> {
    if (await this.isKnown(repoId)) {
      return false;
    }
    this.candidates.set(repoId, { repoId, owner, name, status: ECandidateStatus.PENDING });
    return true;
  }

  async isKnown(repoId: number): Promise<boolean> {
    return this.candidates.has(repoId) || this.scanned.has(repoId);
  }

  async claimNext(): Promise<IRepoRef | null> {
    for (const candidate of this.candidates.values()) {
      if (candidate.status === ECandidateStatus.PENDING) {
        candidate.status = ECandidateStatus.CLAIMED;
        this.scanned.set(candidate.repoId, {
          repoId: candidate.repoId,
          owner: candidate.owner,
          name: candidate.name,
          status: EScanStatus.IN_PROGRESS,
          startedAt: new Date(),
        });
        return { repoId: candidate.repoId, owner: candidate.owner, name: candidate.name };
      }
    }
    for (const row of this.scanned.values()) {
      if (row.status === EScanStatus.PENDING) {
        row.status = EScanStatus.IN_PROGRESS;
        row.startedAt = new Date();
        return { repoId: row.repoId, owner: row.owner, name: row.name };
      }
    }
    return null;
  }

  async markDone(repoId: number): Promise<void> {
    const row = this.scanned.get(repoId);
    if (row) {
      row.status = EScanStatus.DONE;
    }
  }

  async markFailed(repoId: number): Promise<void> {
    const row = this.scanned.get(repoId);
    if (row) {
      row.status = EScanStatus.FAILED;
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
      leakCommits: '[]',
    });
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
      .filter((f) => !filter.secretTypes?.length || filter.secretTypes.includes(f.secretType))
      .filter((f) => !filter.repoIds?.length || filter.repoIds.includes(f.repoId))
      .filter((f) => !filter.statuses?.length || filter.statuses.includes(f.status))
      .filter(
        (f) =>
          !search ||
          `${f.owner}/${f.name}`.toLowerCase().includes(search) ||
          f.filePath.toLowerCase().includes(search) ||
          (f.context ?? '').toLowerCase().includes(search),
      )
      .map((f, i) => {
        const leakCommits = this.parseLeakCommits(f.leakCommits);
        return { id: i, foundAt: new Date(), ...f, leakCommits };
      });
    const offset = filter.offset ?? 0;
    const limit = filter.limit ?? 100;
    return { items: matching.slice(offset, offset + limit), total: matching.length };
  }

  private parseLeakCommits(raw: string): readonly string[] {
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
    } catch {
      return [];
    }
  }

  async listFindingsRepoOptions(limit: number): Promise<IFindingsRepoOption[]> {
    const counts = new Map<number, IFindingsRepoOption>();
    for (const f of this.findings) {
      const existing = counts.get(f.repoId);
      if (existing) {
        counts.set(f.repoId, { ...existing, count: existing.count + 1 });
      } else {
        counts.set(f.repoId, { repoId: f.repoId, owner: f.owner, name: f.name, count: 1 });
      }
    }
    return [...counts.values()].slice(0, limit);
  }

  async listFindingsSecretTypeCounts(): Promise<ISecretTypeCount[]> {
    const counts = new Map<ESecretType, number>();
    for (const f of this.findings) {
      counts.set(f.secretType, (counts.get(f.secretType) ?? 0) + 1);
    }
    return [...counts.entries()].map(([secretType, count]) => ({ secretType, count }));
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
      findingsCount: this.findings.filter((f) => f.repoId === row.repoId).length,
    }));
  }
}
