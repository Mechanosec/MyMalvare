import { fetchQueueStatus } from '../lib/api-client';
import { AuthProvider } from '../lib/auth-context';
import { Dashboard } from './dashboard';

export default async function Page() {
  // Findings and scanned-repos are no longer fetched here: those endpoints
  // are now admin-only or scoped to the caller's own repos (JWT-gated), and
  // SSR has no access to the browser's localStorage token. Dashboard fetches
  // the role-appropriate data itself, client-side, after login state is known.
  const queueStatus = await fetchQueueStatus().catch(() => null);

  return (
    <AuthProvider>
      <Dashboard initialQueueStatus={queueStatus} />
    </AuthProvider>
  );
}
