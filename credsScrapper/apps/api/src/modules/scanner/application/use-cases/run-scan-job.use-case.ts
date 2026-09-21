import { scanText } from '../../domain/detection/engine';
import { isExcludedPath } from '../../domain/detection/path-exclusion';
import {
  extractDiffFilePath,
  splitDiffByFile,
} from '../../domain/detection/split-commit-diff';
import { IFinding } from '../../domain/types/finding.type';
import { IRepoRef } from '../../domain/types/repo-ref.type';
import { GitOperationsPort } from '../ports/git-operations.port';
import { IScanResumeOptions } from '../types/scan-checkpoint.type';
import { EScanPhase } from '../../domain/constant/scan-phase.constant';
import { IScanExecutionOptions } from '../types/scan-budget.type';

export type IScanJobEvent =
  | {
      readonly type: 'progress';
      readonly message: string;
      readonly phase?: EScanPhase;
      readonly elapsedMs?: number;
      readonly acquiredBytes?: number;
      readonly processedFiles?: number;
      readonly processedCommits?: number;
      readonly findingsCount?: number;
    }
  | {
      readonly type: 'finding';
      readonly filePath: string;
      readonly commitSha: string;
      /** All commits represented by a worker-compacted finding. */
      readonly commitShas?: readonly string[];
      readonly finding: IFinding;
    };

export type TScanJobResult =
  | {
      readonly status: 'done';
      readonly headSha: string;
      readonly targetSha?: string;
    }
  | {
      readonly status: 'incomplete' | 'cancelled' | 'failed';
      readonly failReason: string;
      readonly targetSha?: string;
    };

// This is `ScanRepositoryUseCase`'s old body, unchanged in logic, moved
// here so it can run inside a worker thread (see infrastructure/workers/
// scan.worker.ts) with zero NestJS/Prisma dependency - it never throws,
// resolving `{ status: 'failed', failReason }` instead, so the worker
// boundary never needs to distinguish "expected failure" from "thrown
// error" on top of Piscina's own crash handling.
export class RunScanJobUseCase {
  constructor(private readonly git: GitOperationsPort) {}

  async execute(
    repoRef: IRepoRef,
    cloneSource: string,
    workdir: string,
    onEvent: (event: IScanJobEvent) => unknown,
    options?: IScanResumeOptions | IScanExecutionOptions,
  ): Promise<TScanJobResult> {
    if (options && 'phase' in options) {
      return this.executePhase(repoRef, cloneSource, workdir, onEvent, options);
    }
    const resume = options;
    // Await async consumers so worker transfer can apply backpressure.
    const report = (message: string) => onEvent({ type: 'progress', message });

    await report(
      `scan: ${repoRef.owner}/${repoRef.name} - ${resume?.reuseGit ? 'synchronizing Git cache' : 'cloning'}`,
    );
    try {
      if (resume?.reuseGit) await this.git.syncBare(cloneSource, workdir);
      else await this.git.cloneBare(cloneSource, workdir);
      const headSha = await this.git.getHeadCommit(workdir);
      const checkpoint = resume?.checkpoint;
      const base =
        checkpoint?.scannerVersion === resume?.scannerVersion &&
        checkpoint &&
        (await this.git.isAncestor(workdir, checkpoint.headSha))
          ? checkpoint.headSha
          : undefined;
      if (base === headSha) {
        await report(
          `scan: ${repoRef.owner}/${repoRef.name} - unchanged HEAD and scanner; no scan needed`,
        );
        return { status: 'done', headSha };
      }
      await report(
        `scan: ${repoRef.owner}/${repoRef.name} - head=${headSha}, scanning ${base ? 'new' : 'full'} commit history`,
      );

      let findingsCount = 0;
      for await (const { commitSha, diffText } of this.git.iterCommitDiffs(
        workdir,
        base,
      )) {
        for (const segment of splitDiffByFile(diffText)) {
          const realPath = extractDiffFilePath(segment.filePath);
          if (realPath !== null && isExcludedPath(realPath)) {
            continue;
          }
          for (const finding of scanText(segment.text)) {
            await onEvent({
              type: 'finding',
              filePath: segment.filePath,
              commitSha,
              finding,
            });
            findingsCount += 1;
          }
        }
      }

      await report(
        `scan: ${repoRef.owner}/${repoRef.name} - commit history done (${findingsCount} findings), scanning working tree`,
      );

      const paths = (await this.git.listFilesAtHead(workdir)).filter(
        (filePath) => !isExcludedPath(filePath),
      );
      for await (const { filePath, text } of this.git.readFilesAtHead(
        workdir,
        paths,
      )) {
        if (text === null) {
          continue;
        }
        for (const finding of scanText(text)) {
          await onEvent({
            type: 'finding',
            filePath,
            commitSha: headSha,
            finding,
          });
          findingsCount += 1;
        }
      }

      await report(
        `scan: ${repoRef.owner}/${repoRef.name} - done, ${findingsCount} findings total`,
      );
      return { status: 'done', headSha };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await report(
        `scan: ${repoRef.owner}/${repoRef.name} - failed: ${message}`,
      );
      return { status: 'failed', failReason: message };
    }
  }

  private async executePhase(
    repoRef: IRepoRef,
    cloneSource: string,
    workdir: string,
    onEvent: (event: IScanJobEvent) => unknown,
    options: IScanExecutionOptions,
  ): Promise<TScanJobResult> {
    const started = Date.now();
    let targetSha = options.targetSha;
    let processedFiles = 0;
    let processedCommits = 0;
    let findingsCount = 0;
    let acquiredBytes = 0;
    let lastSizeCheck = 0;
    let lastProgress = 0;
    let timeBudgetExpired = false;
    const budgetAbort = new AbortController();
    const budgetTimer = setTimeout(() => {
      timeBudgetExpired = true;
      budgetAbort.abort();
    }, options.budget.maxDurationMs);
    budgetTimer.unref();
    const signal = AbortSignal.any([options.signal, budgetAbort.signal]);
    const report = async (message: string, force = false) => {
      const now = Date.now();
      if (!force && now - lastProgress < 1000) return;
      lastProgress = now;
      await onEvent({
        type: 'progress',
        message,
        phase: options.phase,
        elapsedMs: now - started,
        acquiredBytes,
        processedFiles,
        processedCommits,
        findingsCount,
      });
    };
    const checkBudget = async () => {
      if (options.signal.aborted) throw new Error('scan_cancelled');
      if (timeBudgetExpired) throw new Error('scan_time_budget_exceeded');
      if (Date.now() - started > options.budget.maxDurationMs)
        throw new Error('scan_time_budget_exceeded');
      if (Date.now() - lastSizeCheck >= 5000 || acquiredBytes === 0) {
        acquiredBytes = await this.git.getStorageBytes(workdir);
        lastSizeCheck = Date.now();
        if (acquiredBytes > options.budget.maxCacheBytes)
          throw new Error('scan_cache_budget_exceeded');
      }
    };

    try {
      if (options.phase === EScanPhase.HEAD) {
        targetSha = await this.git.prepareHead(cloneSource, workdir, signal);
        await checkBudget();
        const paths = (await this.git.listFilesAtHead(workdir)).filter(
          (filePath) => !isExcludedPath(filePath),
        );
        for await (const { filePath, text } of this.git.readFilesAtHead(
          workdir,
          paths,
        )) {
          await checkBudget();
          processedFiles += 1;
          if (text !== null) {
            for (const finding of scanText(text, options.secretTypes)) {
              await onEvent({
                type: 'finding',
                filePath,
                commitSha: targetSha,
                finding,
              });
              findingsCount += 1;
            }
          }
          await report(
            `scan: ${repoRef.owner}/${repoRef.name} - HEAD ${processedFiles}/${paths.length} files`,
          );
        }
      } else {
        if (!targetSha) throw new Error('History target is required');
        await this.git.prepareHistory(cloneSource, workdir, targetSha, signal);
        await checkBudget();
        const checkpoint =
          options.checkpoint?.scannerVersion === options.scannerVersion &&
          (await this.git.isAncestor(workdir, options.checkpoint.headSha))
            ? options.checkpoint.headSha
            : undefined;
        for await (const { commitSha, diffText } of this.git.iterCommitDiffs(
          workdir,
          checkpoint,
          signal,
        )) {
          await checkBudget();
          processedCommits += 1;
          for (const segment of splitDiffByFile(diffText)) {
            const realPath = extractDiffFilePath(segment.filePath);
            if (realPath !== null && isExcludedPath(realPath)) continue;
            for (const finding of scanText(segment.text, options.secretTypes)) {
              await onEvent({
                type: 'finding',
                filePath: segment.filePath,
                commitSha,
                finding,
              });
              findingsCount += 1;
            }
          }
          await report(
            `scan: ${repoRef.owner}/${repoRef.name} - history ${processedCommits} commits`,
          );
        }
      }
      await report(
        `scan: ${repoRef.owner}/${repoRef.name} - ${options.phase} done`,
        true,
      );
      return { status: 'done', headSha: targetSha, targetSha };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const status =
        options.signal.aborted || reason === 'scan_cancelled'
          ? 'cancelled'
          : timeBudgetExpired ||
              reason.includes('budget') ||
              reason.includes('exceeds')
            ? 'incomplete'
            : 'failed';
      await report(
        `scan: ${repoRef.owner}/${repoRef.name} - ${options.phase} ${status}: ${reason}`,
        true,
      );
      return { status, failReason: reason, targetSha };
    } finally {
      clearTimeout(budgetTimer);
    }
  }
}
