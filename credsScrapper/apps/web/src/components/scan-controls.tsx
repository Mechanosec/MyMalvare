'use client';

import { useState } from 'react';
import { startDiscover, startScan } from '../lib/api-client';

interface IScanControlsProps {
  readonly onJobStarted: (jobId: string) => void;
}

export function ScanControls({ onJobStarted }: IScanControlsProps) {
  const [workers, setWorkers] = useState(1);
  const [maxRepos, setMaxRepos] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function runDiscover() {
    setError(null);
    setPending(true);
    try {
      const { jobId } = await startDiscover();
      onJobStarted(jobId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'discover failed');
    } finally {
      setPending(false);
    }
  }

  async function runScan() {
    setError(null);
    setPending(true);
    try {
      const { jobId } = await startScan({
        workers,
        maxRepos: maxRepos ? Number(maxRepos) : undefined,
      });
      onJobStarted(jobId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'scan failed');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-wrap items-end gap-4">
      <button
        type="button"
        onClick={runDiscover}
        disabled={pending}
        className="rounded bg-black px-4 py-2 text-white disabled:opacity-50"
      >
        Discover
      </button>

      <label className="flex flex-col text-sm">
        Workers
        <input
          type="number"
          min={1}
          value={workers}
          onChange={(e) => setWorkers(Number(e.target.value))}
          className="w-20 rounded border px-2 py-1"
        />
      </label>

      <label className="flex flex-col text-sm">
        Max repos (optional)
        <input
          type="number"
          min={1}
          value={maxRepos}
          onChange={(e) => setMaxRepos(e.target.value)}
          className="w-28 rounded border px-2 py-1"
        />
      </label>

      <button
        type="button"
        onClick={runScan}
        disabled={pending}
        className="rounded bg-black px-4 py-2 text-white disabled:opacity-50"
      >
        Scan
      </button>

      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
