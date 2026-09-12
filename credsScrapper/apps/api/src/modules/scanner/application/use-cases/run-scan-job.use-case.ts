import { scanText } from '../../domain/detection/engine';
import { isExcludedPath } from '../../domain/detection/path-exclusion';
import { IFinding } from '../../domain/types/finding.type';
import { IRepoRef } from '../../domain/types/repo-ref.type';
import { GitOperationsPort } from '../ports/git-operations.port';

export type IScanJobEvent =
  | { readonly type: 'progress'; readonly message: string }
  | {
      readonly type: 'finding';
      readonly filePath: string;
      readonly commitSha: string;
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
    onEvent: (event: IScanJobEvent) => void,
  ): Promise<TScanJobResult> {
    const report = (message: string) => onEvent({ type: 'progress', message });

    report(`scan: ${repoRef.owner}/${repoRef.name} - cloning`);
    try {
      await this.git.cloneBare(cloneSource, workdir);
      const headSha = await this.git.getHeadCommit(workdir);
      report(
        `scan: ${repoRef.owner}/${repoRef.name} - cloned, head=${headSha}, scanning commit history`,
      );

      let findingsCount = 0;
      for (const { commitSha, diffText } of await this.git.iterCommitDiffs(
        workdir,
      )) {
        for (const finding of scanText(diffText)) {
          onEvent({
            type: 'finding',
            filePath: '<commit-diff>',
            commitSha,
            finding,
          });
          findingsCount += 1;
        }
      }

      report(
        `scan: ${repoRef.owner}/${repoRef.name} - commit history done (${findingsCount} findings), scanning working tree`,
      );

      for (const filePath of await this.git.listFilesAtHead(workdir)) {
        if (isExcludedPath(filePath)) {
          continue;
        }
        const text = await this.git.readFileAtHead(workdir, filePath);
        if (text === null) {
          continue;
        }
        for (const finding of scanText(text)) {
          onEvent({ type: 'finding', filePath, commitSha: headSha, finding });
          findingsCount += 1;
        }
      }

      report(
        `scan: ${repoRef.owner}/${repoRef.name} - done, ${findingsCount} findings total`,
      );
      return { status: 'done', headSha };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      report(`scan: ${repoRef.owner}/${repoRef.name} - failed: ${message}`);
      return { status: 'failed', failReason: message };
    }
  }
}
