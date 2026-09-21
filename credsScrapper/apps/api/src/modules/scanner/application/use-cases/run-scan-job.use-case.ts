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

export type IScanJobEvent =
  | { readonly type: 'progress'; readonly message: string }
  | {
      readonly type: 'finding';
      readonly filePath: string;
      readonly commitSha: string;
      /** All commits represented by a worker-compacted finding. */
      readonly commitShas?: readonly string[];
      readonly finding: IFinding;
    };

export type TScanJobResult =
  | { readonly status: 'done'; readonly headSha: string }
  | { readonly status: 'failed'; readonly failReason: string };

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
    resume?: IScanResumeOptions,
  ): Promise<TScanJobResult> {
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
}
