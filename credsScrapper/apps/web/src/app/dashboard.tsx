'use client';

import { useState } from 'react';
import { FindingsTable } from '../components/findings-table';
import { ProgressPanel } from '../components/progress-panel';
import { ScanControls } from '../components/scan-controls';
import { EScanStatus } from '../lib/constant/scan-status.constant';
import { IFinding } from '../lib/types/finding.type';
import { IQueueStatus } from '../lib/types/queue-status.type';

interface IDashboardProps {
  readonly initialQueueStatus: IQueueStatus | null;
  readonly initialFindings: IFinding[];
}

export function Dashboard({ initialQueueStatus, initialFindings }: IDashboardProps) {
  const [jobId, setJobId] = useState<string | null>(null);
  // Bumped whenever a job finishes, so the findings table re-fetches
  // without needing its own job-completion logic.
  const [refreshKey, setRefreshKey] = useState(0);

  function handleJobStarted(id: string) {
    setJobId(id);
    setRefreshKey((key) => key + 1);
  }

  return (
    <main className="mx-auto max-w-4xl space-y-8 p-8">
      <h1 className="text-2xl font-semibold">credsScrapper</h1>

      <section>
        <h2 className="mb-2 text-lg font-medium">Queue status</h2>
        {initialQueueStatus ? (
          <ul className="text-sm text-gray-700">
            <li>Pending candidates: {initialQueueStatus.pendingCandidates}</li>
            {Object.values(EScanStatus).map((status) => (
              <li key={status}>
                {status}: {initialQueueStatus.scannedByStatus[status] ?? 0}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-red-600">Could not reach the API.</p>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-lg font-medium">Controls</h2>
        <ScanControls onJobStarted={handleJobStarted} />
      </section>

      <section>
        <h2 className="mb-2 text-lg font-medium">Progress</h2>
        <ProgressPanel key={jobId} jobId={jobId} />
      </section>

      <section>
        <h2 className="mb-2 text-lg font-medium">Findings</h2>
        <FindingsTable initialFindings={initialFindings} refreshKey={refreshKey} />
      </section>
    </main>
  );
}
