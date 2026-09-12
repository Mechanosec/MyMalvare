'use client';

import { useEffect, useState } from 'react';
import { AdminPanel } from '../components/admin-panel';
import { FindingsTable } from '../components/findings-table';
import { LandingPage } from '../components/landing-page';
import { MyReposPanel } from '../components/my-repos-panel';
import { ProgressPanel } from '../components/progress-panel';
import { ScannedReposTable } from '../components/scanned-repos-table';
import { ScanControls } from '../components/scan-controls';
import { StatTile } from '../components/stat-tile';
import { Tabs } from '../components/tabs';
import { TestingPanel } from '../components/testing-panel';
import { fetchMyScannedRepos, fetchQueueStatus, fetchScannedRepos } from '../lib/api-client';
import { useAuth } from '../lib/auth-context';
import { EScanStatus } from '../lib/constant/scan-status.constant';
import { IQueueStatus } from '../lib/types/queue-status.type';
import { IScannedRepo } from '../lib/types/scanned-repo.type';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'findings', label: 'Findings' },
  { id: 'repositories', label: 'Repositories' },
  { id: 'testing', label: 'Testing' },
] as const;

// A viewer's own convenience, not shared state (see the Artifact/browser-
// storage guidance this codebase follows elsewhere): remembers the last
// job id in this browser so a page reload can resume watching it instead
// of showing "No job running" while the scan keeps going server-side.
const LAST_JOB_ID_KEY = 'credsscrapper:lastJobId';

export function Dashboard() {
  const { user, loading: authLoading, login, register, logout } = useAuth();
  const [activeTab, setActiveTab] = useState<string>('overview');
  const [authError, setAuthError] = useState<string | null>(null);

  async function handleLogin(email: string, password: string) {
    try {
      setAuthError(null);
      await login(email, password);
    } catch {
      setAuthError('Invalid email or password.');
    }
  }

  async function handleRegister(email: string, password: string) {
    try {
      setAuthError(null);
      await register(email, password);
    } catch {
      setAuthError('Registration failed — email may already be taken.');
    }
  }

  const tabs = [
    ...TABS,
    ...(user ? [{ id: 'my-repos', label: 'My Repos' } as const] : []),
    ...(user?.role === 'admin' ? [{ id: 'admin', label: 'Admin' } as const] : []),
  ];
  // Starts null (matching the server-rendered HTML) and is populated from
  // localStorage in an effect - a lazy initializer would read localStorage
  // during the client's first render too, which happens before hydration
  // reconciles against the server markup and produces a mismatch (SSR
  // always sees null, since there's no localStorage server-side).
  const [jobId, setJobId] = useState<string | null>(null);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(LAST_JOB_ID_KEY);
      if (stored) setJobId(stored);
    } catch {
      /* localStorage unavailable (private mode, etc.) - fine, stay null */
    }
  }, []);
  // Bumped whenever a job starts, so the findings/repos tables re-fetch
  // without needing their own job-completion logic.
  const [refreshKey, setRefreshKey] = useState(0);

  function handleJobStarted(id: string) {
    setJobId(id);
    setRefreshKey((key) => key + 1);
    try {
      localStorage.setItem(LAST_JOB_ID_KEY, id);
    } catch {
      /* per-viewer convenience only - fine if it can't be saved */
    }
  }

  const [scannedRepos, setScannedRepos] = useState<IScannedRepo[]>([]);
  const [queueStatus, setQueueStatus] = useState<IQueueStatus | null>(null);

  useEffect(() => {
    if (!user) {
      setScannedRepos([]);
      setQueueStatus(null);
      return;
    }
    const fetchRepos = user.role === 'admin' ? fetchScannedRepos : fetchMyScannedRepos;
    fetchRepos().then(setScannedRepos).catch(() => setScannedRepos([]));
    if (user.role === 'admin') {
      fetchQueueStatus().then(setQueueStatus).catch(() => setQueueStatus(null));
    }
  }, [user, refreshKey]);

  const totalFindings = scannedRepos.reduce((sum, r) => sum + r.findingsCount, 0);

  // While the stored token is still being verified (getMe() in-flight),
  // render nothing rather than flashing the landing page for an
  // already-logged-in user whose session just hasn't resolved yet.
  if (authLoading) {
    return null;
  }

  if (!user) {
    return <LandingPage onLogin={handleLogin} onRegister={handleRegister} error={authError} />;
  }

  return (
    <main className="min-h-full">
      <header className="border-b border-line px-6 py-4">
        <div className="mx-auto flex max-w-6xl items-center gap-3">
          <span className="h-2 w-2 rounded-full bg-accent" />
          <h1 className="text-base font-semibold">credsScrapper</h1>
          <span className="text-sm text-text-dim">GitHub secret scanner</span>
          <div className="ml-auto flex items-center gap-2 text-sm text-text-dim">
            <span>{user.email}</span>
            <button
              type="button"
              onClick={logout}
              className="border border-line bg-surface-2 px-2 py-1 text-xs text-text hover:border-accent"
            >
              Log out
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-6 py-6">
        <Tabs tabs={tabs} activeId={activeTab} onChange={(id) => setActiveTab(id)} />

        <div className="mt-6 space-y-6">
          {activeTab === 'overview' && (
            <>
              {user.role === 'admin' ? (
                queueStatus ? (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                    <StatTile label="Pending" value={queueStatus.pendingCandidates} />
                    <StatTile
                      label="Scanning"
                      value={queueStatus.scannedByStatus[EScanStatus.IN_PROGRESS] ?? 0}
                      tone="warning"
                    />
                    <StatTile
                      label="Done"
                      value={queueStatus.scannedByStatus[EScanStatus.DONE] ?? 0}
                      tone="accent"
                    />
                    <StatTile
                      label="Failed"
                      value={queueStatus.scannedByStatus[EScanStatus.FAILED] ?? 0}
                      tone="critical"
                    />
                    <StatTile label="Findings" value={totalFindings} tone={totalFindings > 0 ? 'critical' : 'default'} />
                  </div>
                ) : (
                  <p className="border border-critical/50 bg-critical/10 px-4 py-3 text-sm text-critical">
                    Could not reach the API at {process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000'}.
                  </p>
                )
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <StatTile label="Your repos" value={scannedRepos.length} />
                  <StatTile
                    label="Your findings"
                    value={totalFindings}
                    tone={totalFindings > 0 ? 'critical' : 'default'}
                  />
                </div>
              )}

              {user.role === 'admin' ? (
                <>
                  <ScanControls onJobStarted={handleJobStarted} />
                  <ProgressPanel key={jobId} jobId={jobId} />
                </>
              ) : (
                <p className="border border-line bg-surface px-4 py-3 text-sm text-text-dim">
                  Discovery and scanning across all repositories is admin-only. To scan a specific
                  repository you control, submit it on the &quot;My Repos&quot; tab.
                </p>
              )}
            </>
          )}

          {activeTab === 'findings' && (
            <FindingsTable isAdmin={user.role === 'admin'} refreshKey={refreshKey} />
          )}

          {activeTab === 'repositories' && <ScannedReposTable repos={scannedRepos} />}

          {activeTab === 'testing' && <TestingPanel isAdmin={user.role === 'admin'} />}

          {activeTab === 'my-repos' && <MyReposPanel />}

          {activeTab === 'admin' && user.role === 'admin' && <AdminPanel />}
        </div>
      </div>
    </main>
  );
}
