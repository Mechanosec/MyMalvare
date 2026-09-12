import { scanText } from '../../domain/detection/engine';
import { isExcludedPath } from '../../domain/detection/path-exclusion';
import { IRepoRef } from '../../domain/types/repo-ref.type';
import { GitOperationsPort } from '../ports/git-operations.port';
import { LoggerPort } from '../ports/logger.port';
import { StateRepositoryPort } from '../ports/state-repository.port';
import { WorkdirCleanerPort } from '../ports/workdir-cleaner.port';

// Ported from credsScrapper/app/scan/orchestrator.py's scan_repository:
// clone, scan HEAD tree, scan full commit history, record findings, mark
// done/failed. Binary files are skipped (readFileAtHead returns null)
// rather than aborting the whole repo scan. Test/spec/e2e/fixture paths
// are skipped in the HEAD tree scan (see isExcludedPath) - the commit
// history scan can't apply the same filter since iterCommitDiffs returns
// a whole commit's diff as one blob with no per-file path.
export class ScanRepositoryUseCase {
  constructor(
    private readonly git: GitOperationsPort,
    private readonly state: StateRepositoryPort,
    private readonly logger: LoggerPort,
    private readonly workdirCleaner: WorkdirCleanerPort,
  ) {}

  async execute(
    repoRef: IRepoRef,
    cloneSource: string,
    workdir: string,
    onProgress?: (message: string) => void,
  ): Promise<void> {
    await this.workdirCleaner.remove(workdir);

    const report = (message: string) => {
      this.logger.log(message);
      onProgress?.(message);
    };

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
          await this.state.addFinding(
            repoRef.repoId,
            repoRef.owner,
            repoRef.name,
            '<commit-diff>',
            commitSha,
            finding.secretType,
            finding.secretValue,
            finding.lineNumber,
            finding.context,
          );
          findingsCount += 1;
        }
      }

      report(
        `scan: ${repoRef.owner}/${repoRef.name} - commit history done (${findingsCount} findings), scanning working tree`,
      );

      for (const filePath of await this.git.listFilesAtHead(workdir)) {
        if (isExcludedPath(filePath)) {
          continue; // test/spec/e2e/fixture files - noise, not live credentials
        }
        const text = await this.git.readFileAtHead(workdir, filePath);
        if (text === null) {
          continue; // binary file, not scannable as text
        }
        for (const finding of scanText(text)) {
          await this.state.addFinding(
            repoRef.repoId,
            repoRef.owner,
            repoRef.name,
            filePath,
            headSha,
            finding.secretType,
            finding.secretValue,
            finding.lineNumber,
            finding.context,
          );
          findingsCount += 1;
        }
      }

      await this.state.markDone(repoRef.repoId, headSha);
      report(
        `scan: ${repoRef.owner}/${repoRef.name} - done, ${findingsCount} findings total`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const failMessage = `scan: ${repoRef.owner}/${repoRef.name} - failed: ${message}`;
      this.logger.error(failMessage);
      onProgress?.(failMessage);
      await this.state.markFailed(repoRef.repoId, message);
    } finally {
      await this.workdirCleaner.remove(workdir);
    }
  }
}
