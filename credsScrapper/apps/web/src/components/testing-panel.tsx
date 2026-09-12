'use client';

import { useEffect, useState } from 'react';
import {
  adminTestFinding,
  adminTestRepoFindings,
  fetchFindings,
  fetchFindingsRepoOptions,
  fetchFindingsSecretTypeCounts,
  fetchMyFindings,
  fetchMySecretTypeCounts,
  fetchMyTestableRepos,
  FINDINGS_PAGE_SIZE,
  testMyFinding,
  testMyRepoFindings,
} from '../lib/api-client';
import { EFindingStatus } from '../lib/constant/finding-status.constant';
import { ESecretType, TESTABLE_SECRET_TYPES } from '../lib/constant/secret-type.constant';
import { IFinding, IFindingsRepoOption, ISecretTypeCount } from '../lib/types/finding.type';
import { FindingStatusBadge } from './finding-status-badge';
import { MultiSelect } from './multi-select';
import { Pagination } from './pagination';
import { SecretTypeBadge } from './secret-type-badge';
import { SecretValue } from './secret-value';

function formatCheckedAt(checkedAt: string | null): string {
  return checkedAt ? `checked ${new Date(checkedAt).toLocaleString()}` : 'never checked';
}

interface ITestingPanelProps {
  readonly isAdmin: boolean;
}

// "Test" runs a live, read-only check against the third-party service the
// key belongs to (see KeyValidatorPort). A regular user runs this on their
// own admin-approved repo to find out which leaked keys are still active
// and need rotating. An admin can pick any repository, unscoped - an MVP
// stand-in for the future automated scan-and-alert flow. The live check is
// authoritative, so there's no separate manual status override here.
export function TestingPanel({ isAdmin }: ITestingPanelProps) {
  const [repoOptions, setRepoOptions] = useState<IFindingsRepoOption[]>([]);
  const [repoId, setRepoId] = useState<number | null>(null);
  const [secretTypes, setSecretTypes] = useState<ESecretType[]>([]);
  const [statuses, setStatuses] = useState<EFindingStatus[]>([]);
  const [secretTypeCounts, setSecretTypeCounts] = useState<ISecretTypeCount[]>([]);
  const [findings, setFindings] = useState<readonly IFinding[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<number>>(new Set());
  const [log, setLog] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [testingId, setTestingId] = useState<number | null>(null);
  const [testingAll, setTestingAll] = useState(false);
  const [testingSelected, setTestingSelected] = useState(false);

  useEffect(() => {
    // Only repos with at least one live-testable finding are worth
    // offering here - the count shown is scoped the same way.
    const fetchOptions = isAdmin
      ? () => fetchFindingsRepoOptions(undefined, [...TESTABLE_SECRET_TYPES])
      : () => fetchMyTestableRepos([...TESTABLE_SECRET_TYPES]);
    fetchOptions().then(setRepoOptions).catch(() => setRepoOptions([]));
  }, [isAdmin]);

  useEffect(() => {
    setSecretTypes([]);
    setStatuses([]);
    if (repoId === null) {
      setSecretTypeCounts([]);
      return;
    }
    const fetchCounts = isAdmin ? () => fetchFindingsSecretTypeCounts(repoId) : () => fetchMySecretTypeCounts(repoId);
    fetchCounts().then(setSecretTypeCounts).catch(() => setSecretTypeCounts([]));
  }, [isAdmin, repoId]);

  async function loadPage(targetPage: number) {
    if (repoId === null) return;
    setLoading(true);
    try {
      let items: readonly IFinding[];
      let totalCount: number;
      if (isAdmin) {
        const result = await fetchFindings({
          repoIds: [repoId],
          // Untested-type findings are pointless to show here - they'll
          // never resolve to anything but "unknown" (see TESTABLE_SECRET_TYPES).
          secretTypes: secretTypes.length ? secretTypes : [...TESTABLE_SECRET_TYPES],
          statuses: statuses.length ? statuses : undefined,
          limit: FINDINGS_PAGE_SIZE,
          offset: targetPage * FINDINGS_PAGE_SIZE,
        });
        items = result.items;
        totalCount = result.total;
      } else {
        // mine/findings has no repoIds filter (it's already scoped to the
        // caller's own approved repos, which is at most a handful) - fetch
        // them all and paginate the selected repo's slice client-side.
        const filtered = (
          await fetchMyFindings({
            // Untested-type findings are pointless to show here - they'll
            // never resolve to anything but "unknown" (see TESTABLE_SECRET_TYPES).
            secretTypes: secretTypes.length ? secretTypes : [...TESTABLE_SECRET_TYPES],
            statuses: statuses.length ? statuses : undefined,
            limit: 1000,
          })
        ).items.filter((f) => f.repoId === repoId);
        totalCount = filtered.length;
        items = filtered.slice(targetPage * FINDINGS_PAGE_SIZE, (targetPage + 1) * FINDINGS_PAGE_SIZE);
      }
      setFindings(items);
      setTotal(totalCount);
      setPage(targetPage);
      setSelectedIds(new Set());
      setLog((prev) => [...prev, `Loaded ${items.length} of ${totalCount} finding(s) for repo ${repoId}`]);
    } catch {
      setFindings([]);
      setTotal(0);
      setLog((prev) => [...prev, `Failed to load findings for repo ${repoId}`]);
    } finally {
      setLoading(false);
    }
  }

  async function testOne(finding: IFinding) {
    setTestingId(finding.id);
    try {
      const updated = await (isAdmin ? adminTestFinding(finding.id) : testMyFinding(finding.id));
      setFindings((prev) => prev.map((f) => (f.id === finding.id ? updated : f)));
      setLog((prev) => [
        ...prev,
        `Tested ${finding.secretType} in ${finding.filePath}: ${updated.status}`,
      ]);
    } catch {
      setLog((prev) => [...prev, `Failed to test ${finding.secretType} in ${finding.filePath}`]);
    } finally {
      setTestingId(null);
    }
  }

  async function testAll() {
    if (repoId === null) return;
    setTestingAll(true);
    try {
      const updated = await (isAdmin ? adminTestRepoFindings(repoId) : testMyRepoFindings(repoId));
      setLog((prev) => [...prev, `Tested ${updated.length} finding(s) for repo ${repoId}`]);
      await loadPage(page);
    } catch {
      setLog((prev) => [...prev, `Failed to test findings for repo ${repoId}`]);
    } finally {
      setTestingAll(false);
    }
  }

  async function testSelected() {
    const targets = findings.filter((f) => selectedIds.has(f.id));
    if (targets.length === 0) return;
    setTestingSelected(true);
    let succeeded = 0;
    for (const finding of targets) {
      try {
        const updated = await (isAdmin ? adminTestFinding(finding.id) : testMyFinding(finding.id));
        setFindings((prev) => prev.map((f) => (f.id === finding.id ? updated : f)));
        succeeded += 1;
      } catch {
        setLog((prev) => [...prev, `Failed to test ${finding.secretType} in ${finding.filePath}`]);
      }
    }
    setLog((prev) => [...prev, `Tested ${succeeded}/${targets.length} selected finding(s)`]);
    setSelectedIds(new Set());
    setTestingSelected(false);
  }

  function toggleSelected(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const allSelected = findings.length > 0 && findings.every((f) => selectedIds.has(f.id));

  function toggleSelectAll() {
    setSelectedIds(allSelected ? new Set() : new Set(findings.map((f) => f.id)));
  }

  const pageCount = Math.max(1, Math.ceil(total / FINDINGS_PAGE_SIZE));
  const firstRow = total === 0 ? 0 : page * FINDINGS_PAGE_SIZE + 1;
  const lastRow = Math.min(total, (page + 1) * FINDINGS_PAGE_SIZE);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor="testing-repo" className="mb-1 block text-xs text-text-dim">
            Repository
          </label>
          <select
            id="testing-repo"
            value={repoId ?? ''}
            onChange={(e) => setRepoId(e.target.value ? Number(e.target.value) : null)}
            className="w-64 border border-line bg-surface-2 px-2 py-1.5 text-sm text-text outline-none focus:border-accent"
          >
            <option value="">Select a repository…</option>
            {repoOptions.map((repo) => (
              <option key={repo.repoId} value={repo.repoId}>
                {repo.owner}/{repo.name} ({repo.count})
              </option>
            ))}
          </select>
        </div>

        <MultiSelect
          label="Secret type"
          options={TESTABLE_SECRET_TYPES.map((value) => ({
            value,
            label: value.replace(/_/g, ' '),
            count: secretTypeCounts.find((c) => c.secretType === value)?.count,
          }))}
          selected={secretTypes}
          onChange={setSecretTypes}
        />

        <MultiSelect
          label="Status"
          options={Object.values(EFindingStatus).map((value) => ({ value, label: value }))}
          selected={statuses}
          onChange={setStatuses}
        />

        <button
          type="button"
          onClick={() => loadPage(0)}
          disabled={repoId === null || loading}
          className="border border-line bg-surface-2 px-3 py-1.5 text-sm text-text hover:border-accent disabled:opacity-50"
        >
          Load keys
        </button>
        <button
          type="button"
          onClick={testSelected}
          disabled={selectedIds.size === 0 || testingSelected}
          className="border border-accent px-3 py-1.5 text-sm font-medium text-accent transition-colors hover:bg-accent/10 disabled:opacity-40"
        >
          {testingSelected ? 'Testing selected…' : `Test selected (${selectedIds.size})`}
        </button>
        <button
          type="button"
          onClick={testAll}
          disabled={repoId === null || total === 0 || testingAll}
          className="bg-accent px-3 py-1.5 text-sm font-medium text-ink transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {testingAll ? 'Testing all…' : 'Test all'}
        </button>
        <span className="ml-auto font-mono text-xs text-text-dim">
          {firstRow}-{lastRow} of {total} rows
        </span>
      </div>

      {findings.length > 0 && (
        <>
          <Pagination page={page} pageCount={pageCount} onChange={loadPage} />

          <div className="overflow-x-auto border border-line">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-2 text-left text-xs text-text-dim">
                  <th className="px-3 py-2 font-medium">
                    <input
                      type="checkbox"
                      aria-label="Select all on this page"
                      checked={allSelected}
                      onChange={toggleSelectAll}
                    />
                  </th>
                  <th className="px-3 py-2 font-medium">File</th>
                  <th className="px-3 py-2 font-medium">Type</th>
                  <th className="px-3 py-2 font-medium">Secret</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Test</th>
                </tr>
              </thead>
              <tbody>
                {findings.map((finding) => (
                  <tr key={finding.id} className="border-b border-line bg-surface last:border-0">
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        aria-label={`Select ${finding.secretType} in ${finding.filePath}`}
                        checked={selectedIds.has(finding.id)}
                        onChange={() => toggleSelected(finding.id)}
                      />
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
                    <td className="px-3 py-2">
                      <FindingStatusBadge status={finding.status} />
                      <div className="mt-0.5 text-xs text-text-dim">{formatCheckedAt(finding.checkedAt)}</div>
                    </td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => testOne(finding)}
                        disabled={testingId === finding.id}
                        className="bg-accent px-3 py-1 text-xs font-medium text-ink transition-opacity hover:opacity-90 disabled:opacity-40"
                      >
                        {testingId === finding.id ? 'Testing…' : 'Test'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Pagination page={page} pageCount={pageCount} onChange={loadPage} />
        </>
      )}

      {log.length > 0 && (
        <div className="max-h-56 overflow-y-auto border border-line bg-ink px-4 py-2 font-mono text-xs leading-relaxed">
          {log.map((line, index) => (
            <p key={index} className="text-text-dim">
              <span className="text-text-dim">{String(index + 1).padStart(3, '0')} </span>
              {line}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
