'use client';

import { useMemo, useState } from 'react';
import { EScanStatus } from '../lib/constant/scan-status.constant';
import { IScannedRepo } from '../lib/types/scanned-repo.type';
import { SortableHeader } from './sortable-header';
import { StatusBadge } from './status-badge';

interface IScannedReposTableProps {
  readonly repos: IScannedRepo[];
}

type TSortKey = 'repo' | 'status' | 'findings' | 'scannedAt';

function sortValue(repo: IScannedRepo, key: TSortKey): string | number {
  switch (key) {
    case 'repo':
      return `${repo.owner}/${repo.name}`.toLowerCase();
    case 'status':
      return repo.status;
    case 'findings':
      return repo.findingsCount;
    case 'scannedAt':
      return repo.scannedAt ?? '';
  }
}

function formatTime(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString();
}

export function ScannedReposTable({ repos }: IScannedReposTableProps) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<EScanStatus | ''>('');
  const [sortKey, setSortKey] = useState<TSortKey | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  function toggleSort(key: TSortKey) {
    if (key === sortKey) {
      setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  const visible = useMemo(() => {
    let filtered = repos;
    if (statusFilter) filtered = filtered.filter((r) => r.status === statusFilter);
    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter((r) => `${r.owner}/${r.name}`.toLowerCase().includes(q));
    }
    if (!sortKey) return filtered;
    const sorted = [...filtered].sort((a, b) => {
      const va = sortValue(a, sortKey);
      const vb = sortValue(b, sortKey);
      if (va < vb) return -1;
      if (va > vb) return 1;
      return 0;
    });
    return sortDir === 'asc' ? sorted : sorted.reverse();
  }, [repos, search, statusFilter, sortKey, sortDir]);

  if (repos.length === 0) {
    return (
      <p className="border border-line bg-surface px-4 py-6 text-center text-sm text-text-dim">
        Nothing scanned yet — run Discover, then Scan.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-sm text-text-dim">
          Status
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as EScanStatus | '')}
            className="border border-line bg-surface-2 px-2 py-1.5 text-sm text-text outline-none focus:border-accent"
          >
            <option value="">All</option>
            {Object.values(EScanStatus).map((value) => (
              <option key={value} value={value}>
                {value.replace('_', ' ')}
              </option>
            ))}
          </select>
        </label>

        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search repository…"
          aria-label="Search repositories"
          className="w-64 border border-line bg-surface-2 px-2 py-1.5 text-sm text-text outline-none placeholder:text-text-dim focus:border-accent"
        />

        <span className="ml-auto font-mono text-xs text-text-dim">
          {visible.length} of {repos.length} rows
        </span>
      </div>

      {visible.length === 0 ? (
        <p className="border border-line bg-surface px-4 py-6 text-center text-sm text-text-dim">
          No repositories match this filter.
        </p>
      ) : (
        <div className="overflow-x-auto border border-line">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-2 text-left text-xs text-text-dim">
                <SortableHeader label="Repository" sortKey="repo" activeKey={sortKey} direction={sortDir} onSort={toggleSort} />
                <SortableHeader label="Status" sortKey="status" activeKey={sortKey} direction={sortDir} onSort={toggleSort} />
                <SortableHeader label="Findings" sortKey="findings" activeKey={sortKey} direction={sortDir} onSort={toggleSort} />
                <th className="px-3 py-2 font-medium">Last commit</th>
                <SortableHeader label="Scanned at" sortKey="scannedAt" activeKey={sortKey} direction={sortDir} onSort={toggleSort} />
              </tr>
            </thead>
            <tbody>
              {visible.map((repo) => (
                <tr key={repo.repoId} className="border-b border-line bg-surface last:border-0">
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-text">
                    {repo.owner}/{repo.name}
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={repo.status} />
                  </td>
                  <td className={`px-3 py-2 font-mono ${repo.findingsCount > 0 ? 'text-critical' : 'text-text-dim'}`}>
                    {repo.findingsCount}
                  </td>
                  <td className="px-3 py-2 font-mono text-text-dim">
                    {repo.lastCommitSha ? repo.lastCommitSha.slice(0, 10) : '—'}
                  </td>
                  <td className="px-3 py-2 text-text-dim">{formatTime(repo.scannedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
