import { scanText } from '../../domain/detection/engine';
import { IRepoRef } from '../../domain/types/repo-ref.type';
import { GitOperationsPort } from '../ports/git-operations.port';
import { LoggerPort } from '../ports/logger.port';
import { StateRepositoryPort } from '../ports/state-repository.port';
import { WorkdirCleanerPort } from '../ports/workdir-cleaner.port';

// Ported from credsScrapper/app/scan/orchestrator.py's scan_repository:
// clone, scan HEAD tree, scan full commit history, record findings, mark
// done/failed. Binary files are skipped (readFileAtHead returns null)
// rather than aborting the whole repo scan.
export class ScanRepositoryUseCase {
  constructor(
    private readonly git: GitOperationsPort,
    private readonly state: StateRepositoryPort,
    private readonly logger: LoggerPort,
    private readonly workdirCleaner: WorkdirCleanerPort,
  ) {}

  async execute(repoRef: IRepoRef, cloneSource: string, workdir: string): Promise<void> {
    await this.workdirCleaner.remove(workdir);

    this.logger.log(`scan: ${repoRef.owner}/${repoRef.name} - cloning`);
    try {
      await this.git.cloneBare(cloneSource, workdir);
      const headSha = await this.git.getHeadCommit(workdir);
      this.logger.log(
        `scan: ${repoRef.owner}/${repoRef.name} - cloned, head=${headSha}, scanning working tree`,
      );

      let findingsCount = 0;
      for (const filePath of await this.git.listFilesAtHead(workdir)) {
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

      this.logger.log(
        `scan: ${repoRef.owner}/${repoRef.name} - working tree done (${findingsCount} findings), scanning commit history`,
      );

      for (const { commitSha, diffText } of await this.git.iterCommitDiffs(workdir)) {
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

      await this.state.markDone(repoRef.repoId, headSha);
      this.logger.log(
        `scan: ${repoRef.owner}/${repoRef.name} - done, ${findingsCount} findings total`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`scan: ${repoRef.owner}/${repoRef.name} - failed: ${message}`);
      await this.state.markFailed(repoRef.repoId, message);
    } finally {
      await this.workdirCleaner.remove(workdir);
    }
  }
}
