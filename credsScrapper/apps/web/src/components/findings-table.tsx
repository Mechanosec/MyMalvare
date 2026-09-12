'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  fetchFindings,
  fetchFindingsRepoOptions,
  fetchFindingsSecretTypeCounts,
  FINDINGS_PAGE_SIZE,
} from '../lib/api-client';
import { EFindingStatus } from '../lib/constant/finding-status.constant';
import { ESecretType } from '../lib/constant/secret-type.constant';
import { IFinding, IFindingsPage, IFindingsRepoOption, ISecretTypeCount } from '../lib/types/finding.type';
import { FindingStatusBadge } from './finding-status-badge';
import { MultiSelect } from './multi-select';
import { Pagination } from './pagination';
import { SecretTypeBadge } from './secret-type-badge';
import { SecretValue } from './secret-value';
import { SortableHeader } from './sortable-header';

interface IFindingsTableProps {
  readonly initialPage: IFindingsPage;
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

const FILTER_DEBOUNCE_MS = 300;

interface ICommittedFilters {
  readonly secretTypes: ESecretType[];
  readonly repoIds: number[];
  readonly statuses: EFindingStatus[];
  readonly search: string;
}

const NO_FILTERS: ICommittedFilters = { secretTypes: [], repoIds: [], statuses: [], search: '' };

export function FindingsTable({ initialPage, refreshKey }: IFindingsTableProps) {
  const [secretTypes, setSecretTypes] = useState<ESecretType[]>([]);
  const [repoIds, setRepoIds] = useState<number[]>([]);
  const [statuses, setStatuses] = useState<EFindingStatus[]>([]);
  const [repoOptions, setRepoOptions] = useState<IFindingsRepoOption[]>([]);
  const [secretTypeCounts, setSecretTypeCounts] = useState<ISecretTypeCount[]>([]);
  const [search, setSearch] = useState('');
  // Only this debounced snapshot drives fetches, so rapid checkbox clicks
  // or keystrokes coalesce into one request instead of firing (and racing)
  // one per click/keystroke.
  const [committed, setCommitted] = useState<ICommittedFilters>(NO_FILTERS);
  const [page, setPage] = useState(0);
  const [findingsPage, setFindingsPage] = useState(initialPage);
  const [sortKey, setSortKey] = useState<TSortKey | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  useEffect(() => {
    fetchFindingsRepoOptions().then(setRepoOptions).catch(() => setRepoOptions([]));
    fetchFindingsSecretTypeCounts().then(setSecretTypeCounts).catch(() => setSecretTypeCounts([]));
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      setCommitted({ secretTypes, repoIds, statuses, search });
      setPage(0);
    }, FILTER_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [secretTypes, repoIds, statuses, search]);

  useEffect(() => {
    fetchFindings({
      secretTypes: committed.secretTypes.length ? committed.secretTypes : undefined,
      repoIds: committed.repoIds.length ? committed.repoIds : undefined,
      statuses: committed.statuses.length ? committed.statuses : undefined,
      search: committed.search || undefined,
      offset: page * FINDINGS_PAGE_SIZE,
    })
      .then(setFindingsPage)
      .catch(() => setFindingsPage({ items: [], total: 0 }));
  }, [committed, page, refreshKey]);

  function toggleSort(key: TSortKey) {
    if (key === sortKey) {
      setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  const visible = useMemo(() => {
    if (!sortKey) return findingsPage.items;
    const sorted = [...findingsPage.items].sort((a, b) => {
      const va = sortValue(a, sortKey);
      const vb = sortValue(b, sortKey);
      if (va < vb) return -1;
      if (va > vb) return 1;
      return 0;
    });
    return sortDir === 'asc' ? sorted : sorted.reverse();
  }, [findingsPage, sortKey, sortDir]);

  const pageCount = Math.max(1, Math.ceil(findingsPage.total / FINDINGS_PAGE_SIZE));
  const firstRow = findingsPage.total === 0 ? 0 : page * FINDINGS_PAGE_SIZE + 1;
  const lastRow = Math.min(findingsPage.total, (page + 1) * FINDINGS_PAGE_SIZE);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <MultiSelect
          label="Secret type"
          options={Object.values(ESecretType).map((value) => ({
            value,
            label: value.replace(/_/g, ' '),
            count: secretTypeCounts.find((c) => c.secretType === value)?.count,
          }))}
          selected={secretTypes}
          onChange={setSecretTypes}
        />

        <MultiSelect
          label="Repository"
          options={repoOptions.map((repo) => ({
            value: repo.repoId,
            label: `${repo.owner}/${repo.name}`,
            count: repo.count,
          }))}
          selected={repoIds}
          onChange={setRepoIds}
        />

        <MultiSelect
          label="Status"
          options={Object.values(EFindingStatus).map((value) => ({ value, label: value }))}
          selected={statuses}
          onChange={setStatuses}
        />

        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search all findings…"
          aria-label="Search findings"
          className="w-64 border border-line bg-surface-2 px-2 py-1.5 text-sm text-text outline-none placeholder:text-text-dim focus:border-accent"
        />

        <span className="ml-auto font-mono text-xs text-text-dim">
          {firstRow}-{lastRow} of {findingsPage.total} rows
        </span>
      </div>

      <Pagination page={page} pageCount={pageCount} onChange={setPage} />

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
                <th className="px-3 py-2 font-medium">Status</th>
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
                  <td className="px-3 py-2">
                    <FindingStatusBadge status={finding.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Pagination page={page} pageCount={pageCount} onChange={setPage} />
    </div>
  );
}
