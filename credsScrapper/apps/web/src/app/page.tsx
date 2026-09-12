import { fetchFindings, fetchQueueStatus, fetchScannedRepos } from '../lib/api-client';
import { Dashboard } from './dashboard';

export default async function Page() {
  // Never fake data: if the API isn't reachable yet, the dashboard states
  // that plainly instead of inventing a queue status or an empty findings
  // list that looks like "nothing found" rather than "couldn't ask".
  const [queueStatus, findingsPage, scannedRepos] = await Promise.all([
    fetchQueueStatus().catch(() => null),
    fetchFindings().catch(() => ({ items: [], total: 0 })),
    fetchScannedRepos().catch(() => []),
  ]);

  return (
    <Dashboard
      initialQueueStatus={queueStatus}
      initialFindingsPage={findingsPage}
      initialScannedRepos={scannedRepos}
    />
  );
}
