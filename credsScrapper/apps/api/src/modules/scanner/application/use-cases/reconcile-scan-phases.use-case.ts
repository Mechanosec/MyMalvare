import { EScanPhase } from '../../domain/constant/scan-phase.constant';
import { JobQueuePort } from '../ports/job-queue.port';
import { StateRepositoryPort } from '../ports/state-repository.port';
import { WorkdirJoinerPort } from '../ports/workdir-joiner.port';

export class ReconcileScanPhasesUseCase {
  constructor(
    private readonly state: StateRepositoryPort,
    private readonly jobs: JobQueuePort,
    private readonly joiner: WorkdirJoinerPort,
  ) {}

  async execute(workdirRoot: string): Promise<number> {
    const [pending, repos] = await Promise.all([
      this.state.listPendingPhases(EScanPhase.HISTORY),
      this.state.listScannedRepos(100_000),
    ]);
    const refs = new Map(repos.map((repo) => [repo.repoId, repo]));
    let enqueued = 0;
    for (const phase of pending) {
      const repo = refs.get(phase.repoId);
      if (!repo || !phase.targetSha) continue;
      const repoRef = {
        repoId: repo.repoId,
        owner: repo.owner,
        name: repo.name,
      };
      await this.jobs.enqueuePhase(
        EScanPhase.HISTORY,
        repoRef,
        phase.targetSha,
        {
          repoRef,
          cloneSource: `https://github.com/${repo.owner}/${repo.name}.git`,
          workdir: this.joiner.join(workdirRoot, `repo-${repo.repoId}`),
          targetSha: phase.targetSha,
        },
      );
      enqueued += 1;
    }
    return enqueued;
  }
}
