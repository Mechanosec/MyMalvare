'use client';

import { useEffect, useMemo, useState } from 'react';
import { fetchFindings } from '../lib/api-client';
import { ESecretType } from '../lib/constant/secret-type.constant';
import { IFinding } from '../lib/types/finding.type';
import { SecretTypeBadge } from './secret-type-badge';
import { SecretValue } from './secret-value';
import { SortableHeader } from './sortable-header';

interface IFindingsTableProps {
  readonly initialFindings: IFinding[];
  readonly refreshKey: number;
}

type TSortKey = 'repo' | 'file' | 'type' | 'line';

function sortValue(finding: IFinding, key: TSortKey): string | number {
  switch (key) {
    case 'repo':
      return `${finding.owner}/${finding.name}`.toLowerCase();
    case 'file':
      return finding.filePath.toLowerCase();
    case 'type':
      return finding.secretType;
    case 'line':
      return finding.lineNumber ?? -1;
  }
}

function matchesSearch(finding: IFinding, query: string): boolean {
  const haystack = [
    finding.owner,
    finding.name,
    finding.filePath,
    finding.secretType,
    finding.context ?? '',
  ]
    .join(' ')
    .toLowerCase();
  return haystack.includes(query.toLowerCase());
}

export function FindingsTable({ initialFindings, refreshKey }: IFindingsTableProps) {
  const [secretType, setSecretType] = useState<ESecretType | ''>('');
  const [findings, setFindings] = useState(initialFindings);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<TSortKey | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  useEffect(() => {
    fetchFindings({ secretType: secretType || undefined })
      .then(setFindings)
      .catch(() => setFindings([]));
  }, [secretType, refreshKey]);

  function toggleSort(key: TSortKey) {
    if (key === sortKey) {
      setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  const visible = useMemo(() => {
    const filtered = search ? findings.filter((f) => matchesSearch(f, search)) : findings;
    if (!sortKey) return filtered;
    const sorted = [...filtered].sort((a, b) => {
      const va = sortValue(a, sortKey);
      const vb = sortValue(b, sortKey);
      if (va < vb) return -1;
      if (va > vb) return 1;
      return 0;
    });
    return sortDir === 'asc' ? sorted : sorted.reverse();
  }, [findings, search, sortKey, sortDir]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-sm text-text-dim">
          Secret type
          <select
            value={secretType}
            onChange={(e) => setSecretType(e.target.value as ESecretType | '')}
            className="border border-line bg-surface-2 px-2 py-1.5 text-sm text-text outline-none focus:border-accent"
          >
            <option value="">All</option>
            {Object.values(ESecretType).map((value) => (
              <option key={value} value={value}>
                {value.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </label>

        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search repo, file, context…"
          aria-label="Search findings"
          className="w-64 border border-line bg-surface-2 px-2 py-1.5 text-sm text-text outline-none placeholder:text-text-dim focus:border-accent"
        />

        <span className="ml-auto font-mono text-xs text-text-dim">
          {visible.length} of {findings.length} rows
        </span>
      </div>

      {visible.length === 0 ? (
        <p className="border border-line bg-surface px-4 py-6 text-center text-sm text-text-dim">
          No findings match this filter.
        </p>
      ) : (
        <div className="overflow-x-auto border border-line">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-2 text-left text-xs text-text-dim">
                <SortableHeader label="Repository" sortKey="repo" activeKey={sortKey} direction={sortDir} onSort={toggleSort} />
                <SortableHeader label="File" sortKey="file" activeKey={sortKey} direction={sortDir} onSort={toggleSort} />
                <SortableHeader label="Type" sortKey="type" activeKey={sortKey} direction={sortDir} onSort={toggleSort} />
                <th className="px-3 py-2 font-medium">Secret</th>
                <th className="px-3 py-2 font-medium">Context</th>
                <SortableHeader label="Line" sortKey="line" activeKey={sortKey} direction={sortDir} onSort={toggleSort} />
              </tr>
            </thead>
            <tbody>
              {visible.map((finding) => (
                <tr key={finding.id} className="border-b border-line bg-surface last:border-0">
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-text">
                    {finding.owner}/{finding.name}
                  </td>
                  <td className="max-w-64 truncate px-3 py-2 font-mono text-text-dim" title={finding.filePath}>
                    {finding.filePath}
                  </td>
                  <td className="px-3 py-2">
                    <SecretTypeBadge secretType={finding.secretType} />
                  </td>
                  <td className="px-3 py-2">
                    <SecretValue value={finding.secretValue} />
                  </td>
                  <td className="px-3 py-2 font-mono text-text-dim">{finding.context ?? '—'}</td>
                  <td className="px-3 py-2 font-mono text-text-dim">{finding.lineNumber ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
