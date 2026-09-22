'use client';

import { useState } from 'react';
import { startDiscover, startScan, startScanRepo } from '../lib/api-client';

interface IScanControlsProps {
  readonly onJobStarted: (jobId: string) => void;
  readonly scansStopping?: boolean;
}

export function ScanControls({ onJobStarted, scansStopping = false }: IScanControlsProps) {
  const [workers, setWorkers] = useState(1);
  const [maxRepos, setMaxRepos] = useState('');
  const [repoOwner, setRepoOwner] = useState('');
  const [repoName, setRepoName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function runDiscover() {
    setError(null);
    setPending(true);
    try {
      const { jobId } = await startDiscover();
      onJobStarted(jobId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Discover failed');
    } finally {
      setPending(false);
    }
  }

  async function runScan() {
    if (scansStopping) return;
    setError(null);
    setPending(true);
    try {
      const { jobId } = await startScan({
        workers,
        maxRepos: maxRepos ? Number(maxRepos) : undefined,
      });
      onJobStarted(jobId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Scan failed');
    } finally {
      setPending(false);
    }
  }

  async function runScanRepo() {
    if (scansStopping || !repoOwner.trim() || !repoName.trim()) return;
    setError(null);
    setPending(true);
    try {
      const { jobId } = await startScanRepo(repoOwner.trim(), repoName.trim());
      onJobStarted(jobId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Scan repo failed');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-wrap items-end gap-3 border border-line bg-surface p-4">
      <button
        type="button"
        onClick={runDiscover}
        disabled={pending}
        className="bg-accent px-4 py-2 text-sm font-medium text-ink transition-opacity hover:opacity-90 disabled:opacity-40"
      >
        Discover
      </button>

      <label className="flex flex-col gap-1 text-xs text-text-dim">
        Workers
        <input
          type="number"
          min={1}
          value={workers}
          onChange={(e) => setWorkers(Number(e.target.value))}
          className="w-20 border border-line bg-surface-2 px-2 py-1.5 font-mono text-sm text-text outline-none focus:border-accent"
        />
      </label>

      <label className="flex flex-col gap-1 text-xs text-text-dim">
        Max repos (optional)
        <input
          type="number"
          min={1}
          placeholder="no limit"
          value={maxRepos}
          onChange={(e) => setMaxRepos(e.target.value)}
          className="w-28 border border-line bg-surface-2 px-2 py-1.5 font-mono text-sm text-text outline-none placeholder:text-text-dim focus:border-accent"
        />
      </label>

      <button
        type="button"
        onClick={runScan}
        disabled={pending || scansStopping}
        className="border border-accent px-4 py-2 text-sm font-medium text-accent transition-colors hover:bg-accent/10 disabled:opacity-40"
      >
        Scan
      </button>

      <div className="flex items-end gap-2 border-l border-line pl-3">
        <label className="flex flex-col gap-1 text-xs text-text-dim">
          Owner
          <input
            type="text"
            placeholder="octocat"
            value={repoOwner}
            onChange={(e) => setRepoOwner(e.target.value)}
            className="w-28 border border-line bg-surface-2 px-2 py-1.5 font-mono text-sm text-text outline-none placeholder:text-text-dim focus:border-accent"
          />
        </label>

        <label className="flex flex-col gap-1 text-xs text-text-dim">
          Repo
          <input
            type="text"
            placeholder="hello-world"
            value={repoName}
            onChange={(e) => setRepoName(e.target.value)}
            className="w-32 border border-line bg-surface-2 px-2 py-1.5 font-mono text-sm text-text outline-none placeholder:text-text-dim focus:border-accent"
          />
        </label>

        <button
          type="button"
          onClick={runScanRepo}
          disabled={pending || scansStopping || !repoOwner.trim() || !repoName.trim()}
          className="border border-accent px-4 py-2 text-sm font-medium text-accent transition-colors hover:bg-accent/10 disabled:opacity-40"
        >
          Scan repo
        </button>
      </div>

      {error && <p className="text-sm text-critical">{error}</p>}
    </div>
  );
}
