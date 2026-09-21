import { StateRepositoryPort } from '../ports/state-repository.port';
import { GithubRepoLookupPort } from '../ports/github-repo-lookup.port';
import { JobQueuePort } from '../ports/job-queue.port';
import { WorkdirJoinerPort } from '../ports/workdir-joiner.port';
import { ESecretType } from '../../domain/constant/secret-type.constant';

const SCAN_WORKDIR = process.env.SCAN_WORKDIR ?? 'workdir';

// Shared by ScanMyRepoUseCase (after its RepoAuthorization check passes)
// and AdminScanRepoUseCase (no ownership to check, already behind
// AdminGuard): resolve owner/name to a GitHub repoId, then enqueue the
// same 'scan-repo' BullMQ job the worker already knows how to run.
export async function enqueueRepoScan(
  state: StateRepositoryPort,
  githubLookup: GithubRepoLookupPort,
  jobQueue: JobQueuePort,
  workdirJoiner: WorkdirJoinerPort,
  owner: string,
  name: string,
  secretType?: ESecretType,
): Promise<{ repoId: number; jobId: string } | 'not-found'> {
  const repoId = await githubLookup.resolveRepoId(owner, name);
  if (repoId === null) {
    return 'not-found';
  }

  if (!secretType) await state.startRepoScan(repoId, owner, name);
  await workdirJoiner.ensureDir(SCAN_WORKDIR);
  const workdir = workdirJoiner.join(SCAN_WORKDIR, `repo-${repoId}`);
  const jobId = await jobQueue.enqueue(
    secretType ? 'rescan-service' : 'scan-repo',
    {
      repoRef: { repoId, owner, name },
      cloneSource: `https://github.com/${owner}/${name}.git`,
      workdir,
      ...(secretType ? { secretType } : {}),
    },
  );

  return { repoId, jobId };
}
