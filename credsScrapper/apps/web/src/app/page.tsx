import { AuthProvider } from '../lib/auth-context';
import { Dashboard } from './dashboard';

// Nothing is fetched server-side anymore: every data endpoint is now
// either admin-only or scoped to the caller's own repos (JWT-gated), and
// an unauthenticated visitor sees only the landing page - no queue status,
// no findings, nothing - until they log in.
export default function Page() {
  return (
    <AuthProvider>
      <Dashboard />
    </AuthProvider>
  );
}
