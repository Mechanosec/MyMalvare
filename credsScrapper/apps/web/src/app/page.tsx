import { fetchFindings, fetchQueueStatus } from '../lib/api-client';
import { Dashboard } from './dashboard';

export default async function Page() {
  // Never fake data: if the API isn't reachable yet, the dashboard states
  // that plainly instead of inventing a queue status or an empty findings
  // list that looks like "nothing found" rather than "couldn't ask".
  const [queueStatus, findings] = await Promise.all([
    fetchQueueStatus().catch(() => null),
    fetchFindings().catch(() => []),
  ]);

  return <Dashboard initialQueueStatus={queueStatus} initialFindings={findings} />;
}
