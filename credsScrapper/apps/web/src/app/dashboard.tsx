'use client';

import { useEffect, useRef, useState } from 'react';
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
import { fetchMyScannedRepos, fetchQueueStatus, fetchScannedRepos, stopAllScans } from '../lib/api-client';
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
  const [statusError, setStatusError] = useState(false);
  const [statusLoading, setStatusLoading] = useState(true);
  const [stopPending, setStopPending] = useState(false);
  const [stopError, setStopError] = useState<string | null>(null);
  const statusRevision = useRef(0);

  useEffect(() => {
    if (!user) {
      setScannedRepos([]);
      setQueueStatus(null);
      return;
    }
    const fetchRepos = user.role === 'admin' ? fetchScannedRepos : fetchMyScannedRepos;
    fetchRepos().then(setScannedRepos).catch(() => setScannedRepos([]));
  }, [user, refreshKey]);

  useEffect(() => {
    if (user?.role !== 'admin') {
      statusRevision.current += 1;
      return;
    }
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    queueMicrotask(() => {
      if (!active) return;
      setStatusLoading(true);
      setStatusError(false);
      setQueueStatus(null);
    });
    async function pollStatus() {
      const revision = statusRevision.current;
      try {
        const status = await fetchQueueStatus();
        if (active && revision === statusRevision.current) {
          setQueueStatus(status);
          setStatusError(false);
          setStatusLoading(false);
        }
      } catch {
        if (active && revision === statusRevision.current) {
          setQueueStatus(null);
          setStatusError(true);
          setStatusLoading(false);
        }
      } finally {
        if (active) timer = setTimeout(pollStatus, 2000);
      }
    }
    void pollStatus();
    return () => {
      active = false;
      statusRevision.current += 1;
      clearTimeout(timer);
    };
  }, [user]);

  async function handleStopAll() {
    statusRevision.current += 1;
    setStopPending(true);
    setStopError(null);
    try {
      const control = await stopAllScans();
      statusRevision.current += 1;
      setQueueStatus((previous) => previous ? {
        ...previous,
        runtime: { ...previous.runtime, ...control },
      } : previous);
    } catch (error) {
      setStopError(error instanceof Error ? error.message : 'Stop request failed.');
    } finally {
      setStopPending(false);
    }
  }

  const totalFindings = scannedRepos.reduce((sum, r) => sum + r.findingsCount, 0);
  const runtime = user?.role === 'admin' ? queueStatus?.runtime : undefined;
  const scansStopping = runtime?.state === 'stopping';
  const activeScanJobs = runtime ? Object.values(runtime.queues).reduce((total, queue) => total + queue.active + queue.queued, 0) : 0;

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

        {user.role === 'admin' && (
          <section className="mt-4 space-y-3 border border-line bg-surface p-4" aria-label="Scan runtime">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-sm font-semibold">Global scan control</h2>
              {statusLoading && <span className="text-sm text-text-dim">Loading scan status…</span>}
              {statusError && <span role="alert" className="text-sm text-critical">Scan status unavailable. Check the API.</span>}
              {runtime?.state === 'stopping' && <span role="status" className="text-sm text-warning">Stopping…</span>}
              {runtime?.state === 'stopped' && <span role="status" className="text-sm text-text-dim">Stopped</span>}
              {runtime?.state === 'ready' && activeScanJobs === 0 && <span className="text-sm text-text-dim">No scan jobs active.</span>}
              {runtime?.state === 'ready' && activeScanJobs > 0 && (
                <button
                  type="button"
                  onClick={handleStopAll}
                  disabled={stopPending}
                  className="border border-critical/50 px-3 py-1.5 text-sm font-medium text-critical hover:bg-critical/10 disabled:opacity-40"
                >
                  {stopPending ? 'Requesting stop…' : 'Stop all scans'}
                </button>
              )}
            </div>
            {stopError && <p role="alert" className="text-sm text-critical">Stop request failed: {stopError}</p>}
            {runtime && (
              <div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
                {(['control', 'head', 'history'] as const).map((queue) => (
                  <p key={queue} className="border border-line bg-surface-2 px-3 py-2">
                    <span className="font-medium">{queue === 'control' ? 'Control' : queue.toUpperCase()} jobs</span>
                    <span className="ml-2 font-mono text-text-dim">{runtime.queues[queue].active} active · {runtime.queues[queue].queued} queued</span>
                  </p>
                ))}
              </div>
            )}
          </section>
        )}

        <div className="mt-6 space-y-6">
          {activeTab === 'overview' && (
            <>
              {user.role === 'admin' ? (
                queueStatus ? (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                    <StatTile label="Pending" value={queueStatus.pendingCandidates} />
                    <StatTile
                      label="Repo HEAD in progress"
                      value={queueStatus.scannedByStatus[EScanStatus.IN_PROGRESS] ?? 0}
                      tone="warning"
                    />
                    <StatTile
                      label="HEAD done"
                      value={queueStatus.scannedByStatus[EScanStatus.DONE] ?? 0}
                      tone="accent"
                    />
                    <StatTile
                      label="Failed"
                      value={queueStatus.scannedByStatus[EScanStatus.FAILED] ?? 0}
                      tone="critical"
                    />
                    <StatTile label="Cancelled" value={queueStatus.scannedByStatus[EScanStatus.CANCELLED] ?? 0} />
                    <StatTile label="Findings" value={totalFindings} tone={totalFindings > 0 ? 'critical' : 'default'} />
                  </div>
                ) : statusError ? (
                  <p className="border border-critical/50 bg-critical/10 px-4 py-3 text-sm text-critical">
                    Could not reach the API at {process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000'}.
                  </p>
                ) : (
                  <p className="border border-line bg-surface px-4 py-3 text-sm text-text-dim">Loading scan status…</p>
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
                  <ScanControls onJobStarted={handleJobStarted} scansStopping={scansStopping} />
                  <ProgressPanel key={jobId} jobId={jobId} showStopButton onDone={() => setRefreshKey((key) => key + 1)} />
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

          {activeTab === 'testing' && <TestingPanel isAdmin={user.role === 'admin'} scansStopping={scansStopping} />}

          {activeTab === 'my-repos' && <MyReposPanel scansStopping={scansStopping} />}

          {activeTab === 'admin' && user.role === 'admin' && <AdminPanel />}
        </div>
      </div>
    </main>
  );
}
