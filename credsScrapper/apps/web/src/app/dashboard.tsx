'use client';

import { useState } from 'react';
import { FindingsTable } from '../components/findings-table';
import { LoginForm } from '../components/login-form';
import { ProgressPanel } from '../components/progress-panel';
import { ScannedReposTable } from '../components/scanned-repos-table';
import { ScanControls } from '../components/scan-controls';
import { StatTile } from '../components/stat-tile';
import { Tabs } from '../components/tabs';
import { TestingPanel } from '../components/testing-panel';
import { useAuth } from '../lib/auth-context';
import { EScanStatus } from '../lib/constant/scan-status.constant';
import { IFindingsPage } from '../lib/types/finding.type';
import { IQueueStatus } from '../lib/types/queue-status.type';
import { IScannedRepo } from '../lib/types/scanned-repo.type';

interface IDashboardProps {
  readonly initialQueueStatus: IQueueStatus | null;
  readonly initialFindingsPage: IFindingsPage;
  readonly initialScannedRepos: IScannedRepo[];
}

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

export function Dashboard({
  initialQueueStatus,
  initialFindingsPage,
  initialScannedRepos,
}: IDashboardProps) {
  const { user, login, register, logout } = useAuth();
  const [activeTab, setActiveTab] = useState<string>('overview');
  const tabs = [
    ...TABS,
    ...(user ? [{ id: 'my-repos', label: 'My Repos' } as const] : []),
    ...(user?.role === 'admin' ? [{ id: 'admin', label: 'Admin' } as const] : []),
  ];
  // Lazy initializer, not an effect: reading localStorage is a pure
  // (if side-effect-adjacent) computation of the initial value, not a
  // subscription to an external system, so it belongs in useState's
  // initializer rather than a setState-in-effect that would cause an
  // extra render. Guarded for SSR, where `window` doesn't exist yet.
  const [jobId, setJobId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      return localStorage.getItem(LAST_JOB_ID_KEY);
    } catch {
      return null; // localStorage unavailable (private mode, etc.)
    }
  });
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

  const totalFindings = initialScannedRepos.reduce((sum, r) => sum + r.findingsCount, 0);

  return (
    <main className="min-h-full">
      <header className="border-b border-line px-6 py-4">
        <div className="mx-auto flex max-w-6xl items-center gap-3">
          <span
            className={`h-2 w-2 rounded-full ${initialQueueStatus ? 'bg-accent' : 'bg-critical'}`}
          />
          <h1 className="text-base font-semibold">credsScrapper</h1>
          <span className="text-sm text-text-dim">GitHub secret scanner</span>
          <div className="ml-auto flex items-center gap-2 text-sm text-text-dim">
            {user ? (
              <>
                <span>{user.email}</span>
                <button
                  type="button"
                  onClick={logout}
                  className="border border-line bg-surface-2 px-2 py-1 text-xs text-text hover:border-accent"
                >
                  Log out
                </button>
              </>
            ) : (
              <span>Not logged in</span>
            )}
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-6 py-6">
        <Tabs tabs={tabs} activeId={activeTab} onChange={(id) => setActiveTab(id)} />

        <div className="mt-6 space-y-6">
          {activeTab === 'overview' && (
            <>
              {initialQueueStatus ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                  <StatTile label="Pending" value={initialQueueStatus.pendingCandidates} />
                  <StatTile
                    label="Scanning"
                    value={initialQueueStatus.scannedByStatus[EScanStatus.IN_PROGRESS] ?? 0}
                    tone="warning"
                  />
                  <StatTile
                    label="Done"
                    value={initialQueueStatus.scannedByStatus[EScanStatus.DONE] ?? 0}
                    tone="accent"
                  />
                  <StatTile
                    label="Failed"
                    value={initialQueueStatus.scannedByStatus[EScanStatus.FAILED] ?? 0}
                    tone="critical"
                  />
                  <StatTile label="Findings" value={totalFindings} tone={totalFindings > 0 ? 'critical' : 'default'} />
                </div>
              ) : (
                <p className="border border-critical/50 bg-critical/10 px-4 py-3 text-sm text-critical">
                  Could not reach the API at {process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000'}.
                </p>
              )}

              <ScanControls onJobStarted={handleJobStarted} />
              <ProgressPanel key={jobId} jobId={jobId} />
            </>
          )}

          {activeTab === 'findings' && (
            <FindingsTable initialPage={initialFindingsPage} refreshKey={refreshKey} />
          )}

          {activeTab === 'repositories' && (
            <ScannedReposTable initialRepos={initialScannedRepos} refreshKey={refreshKey} />
          )}

          {activeTab === 'testing' &&
            (user ? <TestingPanel /> : <LoginForm onLogin={login} onRegister={register} />)}
        </div>
      </div>
    </main>
  );
}
