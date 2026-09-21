'use client';

import { RepositorySelect } from './repository-select';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  adminTestFinding,
  fetchFindings,
  fetchMyFindings,
  fetchMyTestingFacets,
  fetchTestingFacets,
  FINDINGS_PAGE_SIZE,
  testMyFinding,
  scanMyRepo,
  startScanRepo,
} from '../lib/api-client';
import { EFindingStatus } from '../lib/constant/finding-status.constant';
import { ESecretType, TESTABLE_SECRET_TYPES } from '../lib/constant/secret-type.constant';
import { IFinding, IFindingsRepoOption, ISecretTypeCount, IStatusCount } from '../lib/types/finding.type';
import { FindingStatusBadge } from './finding-status-badge';
import { MultiSelect } from './multi-select';
import { Pagination } from './pagination';
import { SecretTypeBadge } from './secret-type-badge';
import { SecretValue } from './secret-value';
import { ProgressPanel } from './progress-panel';

function formatCheckedAt(checkedAt: string | null): string {
  return checkedAt ? `last attempt ${new Date(checkedAt).toLocaleString()}` : 'not attempted';
}

function needsRescan(finding: IFinding): boolean {
  return (finding.status === EFindingStatus.FAILED || finding.status === EFindingStatus.UNKNOWN) && [
    'Skipped: matching AWS Secret Access Key is missing.',
    'Skipped: AWS credentials are incomplete or malformed.',
    'Skipped: GCP credentials are not valid JSON.',
    'Skipped: GCP credentials need private_key and client_email.',
    'Skipped: GCP private key is not a readable PEM key.',
  ].includes(finding.testReason ?? '');
}

// e.g. "acme/widgets (4: 1 valid, 3 unknown)" - only non-zero buckets are
// listed, so a repo with nothing tested yet just reads "(4: 4 unknown)".
function formatRepoOptionLabel(repo: IFindingsRepoOption): string {
  const breakdown = [
    repo.validCount > 0 ? `${repo.validCount} valid` : null,
    repo.invalidCount > 0 ? `${repo.invalidCount} invalid` : null,
    repo.failedCount > 0 ? `${repo.failedCount} failed` : null,
    repo.unknownCount > 0 ? `${repo.unknownCount} unknown` : null,
  ].filter((part): part is string => part !== null);
  return `${repo.owner}/${repo.name} (${repo.count}${breakdown.length ? `: ${breakdown.join(', ')}` : ''})`;
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
  const [selectedRepo, setSelectedRepo] = useState<IFindingsRepoOption | null>(null);
  const [repoId, setRepoId] = useState<number | null>(null);
  const [secretTypes, setSecretTypes] = useState<ESecretType[]>([]);
  const [status, setStatus] = useState<EFindingStatus | null>(null);
  const [secretTypeCounts, setSecretTypeCounts] = useState<ISecretTypeCount[]>([]);
  const [statusCounts, setStatusCounts] = useState<IStatusCount[]>([]);
  const [countsLoading, setCountsLoading] = useState(true);
  const [countsError, setCountsError] = useState(false);
  const [findings, setFindings] = useState<readonly IFinding[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(FINDINGS_PAGE_SIZE);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<number>>(new Set());
  const [feedback, setFeedback] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [testingId, setTestingId] = useState<number | null>(null);
  const [testingSelected, setTestingSelected] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const requestId = useRef(0);
  const countsRequestId = useRef(0);
  const selectedRepoId = useRef<number | null>(null);
  const filterRevision = useRef(0);
  const [rescanningRepoId, setRescanningRepoId] = useState<number | null>(null);
  const [rescanJobId, setRescanJobId] = useState<string | null>(null);

  async function rescan(finding: IFinding) {
    setRescanningRepoId(finding.repoId);
    try {
      const result = await (isAdmin ? startScanRepo : scanMyRepo)(finding.owner, finding.name, finding.secretType);
      setRescanJobId(result.jobId);
      setFeedback(`Rescan queued for ${finding.owner}/${finding.name} (${finding.secretType}): job ${result.jobId}. Findings will refresh when it completes; no key tests were started.`);
    } catch (error) {
      const status = error instanceof Error
        ? /^POST (?:\/repo-authorizations\/mine\/scan-repo|\/scan\/repo) failed: (\d{3})$/.exec(error.message)?.[1]
        : undefined;
      const reason = status === '403'
        ? isAdmin
          ? 'Administrator access is required. Sign in again with an administrator account.'
          : 'Your account has no approved authorization for this repository. Rescan requires repository-owner permission.'
        : status === '401'
          ? 'Your session has expired. Sign in again.'
          : status === '404'
            ? 'The repository could not be found.'
            : 'The API request failed. Check server availability and retry.';
      setFeedback(`Could not queue rescan for ${finding.owner}/${finding.name}. ${reason}`);
    } finally {
      setRescanningRepoId(null);
    }
  }

  const refreshFacets = useCallback((targetRepoId: number | null, targetStatus: EFindingStatus | null, targetSecretTypes: readonly ESecretType[]) => {
    if (targetRepoId !== selectedRepoId.current) return;
    const currentRequest = ++countsRequestId.current;
    setCountsLoading(true);
    setCountsError(false);
    const fetchFacets = isAdmin ? fetchTestingFacets : fetchMyTestingFacets;
    fetchFacets({ repoId: targetRepoId, status: targetStatus, secretTypes: targetSecretTypes, testableTypes: TESTABLE_SECRET_TYPES }).then((facets) => {
      if (currentRequest === countsRequestId.current) {
        setRepoOptions([...facets.repositories]);
        setStatusCounts([...facets.statuses]);
        setSecretTypeCounts([...facets.secretTypes]);
        setCountsLoading(false);
      }
    }).catch(() => {
      if (currentRequest === countsRequestId.current) {
        setRepoOptions([]);
        setStatusCounts([]);
        setSecretTypeCounts([]);
        setCountsLoading(false);
        setCountsError(true);
      }
    });
  }, [isAdmin]);

  useEffect(() => {
    refreshFacets(repoId, status, secretTypes);
  }, [refreshFacets, repoId, status, secretTypes]);

  const loadPage = useCallback(async (targetPage: number) => {
    if (repoId !== selectedRepoId.current) return;
    const currentRequest = ++requestId.current;
    setLoading(true);
    setLoadError(false);
    try {
      let items: readonly IFinding[];
      let totalCount: number;
      if (isAdmin) {
        const result = await fetchFindings({
          repoIds: repoId === null ? undefined : [repoId],
          // Only types with a live checker can provide a useful result here.
          secretTypes: secretTypes.length ? secretTypes : [...TESTABLE_SECRET_TYPES],
          statuses: status ? [status] : undefined,
          limit: pageSize,
          offset: targetPage * pageSize,
        });
        items = result.items;
        totalCount = result.total;
      } else {
        const result = await fetchMyFindings({
          repoIds: repoId === null ? undefined : [repoId],
          secretTypes: secretTypes.length ? secretTypes : [...TESTABLE_SECRET_TYPES],
          statuses: status ? [status] : undefined,
          limit: pageSize,
          offset: targetPage * pageSize,
        });
        items = result.items;
        totalCount = result.total;
      }
      if (currentRequest !== requestId.current) return;
      setFindings(items);
      setTotal(totalCount);
      setPage(targetPage);
      setSelectedIds(new Set());
    } catch {
      if (currentRequest !== requestId.current) return;
      setFindings([]);
      setTotal(0);
      setLoadError(true);
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  }, [isAdmin, repoId, secretTypes, status, pageSize]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) void loadPage(0);
    });
    return () => { cancelled = true; };
  }, [loadPage]);

  async function refreshAfterRescan() {
    const revision = filterRevision.current;
    await loadPage(0);
    if (revision === filterRevision.current) {
      refreshFacets(repoId, status, secretTypes);
      setFeedback(null);
    }
  }

  async function testOne(finding: IFinding) {
    const revision = filterRevision.current;
    setTestingId(finding.id);
    try {
      const updated = await (isAdmin ? adminTestFinding(finding.id) : testMyFinding(finding.id));
      if (revision === filterRevision.current) setFindings((prev) => prev.map((f) => (f.id === finding.id ? updated : f)));
      setFeedback(`Check ${finding.secretType} in ${finding.filePath}: ${updated.testReason ?? updated.status}`);
      if (revision === filterRevision.current) {
        refreshFacets(repoId, status, secretTypes);
        if (status !== null) await loadPage(0);
      }
    } catch {
      setFeedback(`Failed to test ${finding.secretType} in ${finding.filePath}`);
    } finally {
      setTestingId(null);
    }
  }

  async function testSelected() {
    const revision = filterRevision.current;
    const targets = findings.filter((f) => selectedIds.has(f.id));
    if (targets.length === 0) return;
    setTestingSelected(true);
    let succeeded = 0;
    for (const finding of targets) {
      try {
        const updated = await (isAdmin ? adminTestFinding(finding.id) : testMyFinding(finding.id));
        if (revision === filterRevision.current) setFindings((prev) => prev.map((f) => (f.id === finding.id ? updated : f)));
        succeeded += 1;
      } catch { /* The summary below includes failures without flooding the page. */ }
    }
    setFeedback(`Processed ${succeeded}/${targets.length} selected finding(s)${succeeded < targets.length ? '; failed checks can be retried' : ''}.`);
    setSelectedIds(new Set());
    setTestingSelected(false);
    if (revision === filterRevision.current) {
      refreshFacets(repoId, status, secretTypes);
      if (status !== null) await loadPage(0);
    }
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

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const firstRow = total === 0 ? 0 : page * pageSize + 1;
  const lastRow = Math.min(total, (page + 1) * pageSize);
  const allStatusCount = statusCounts.reduce((sum, count) => sum + count.count, 0);
  const selectedRepoOption = selectedRepo && !repoOptions.some((repo) => repo.repoId === selectedRepo.repoId)
    ? { ...selectedRepo, count: 0, validCount: 0, invalidCount: 0, failedCount: 0, unknownCount: 0 }
    : null;
  const visibleRepoOptions = selectedRepoOption ? [selectedRepoOption, ...repoOptions] : repoOptions;

  function invalidateResults() {
    filterRevision.current += 1;
    requestId.current += 1;
    countsRequestId.current += 1;
    setSelectedIds(new Set());
    setLoading(true);
    setCountsLoading(true);
    setCountsError(false);
    setLoadError(false);
    setFeedback(null);
  }

  function chooseRepo(value: number | null) {
    if (value === repoId) return;
    invalidateResults();
    selectedRepoId.current = value;
    setSelectedRepo(value === null ? null : visibleRepoOptions.find((repo) => repo.repoId === value) ?? null);
    setRepoId(value);
  }

  function chooseStatus(value: EFindingStatus | null) {
    if (value === status) return;
    invalidateResults();
    setStatus(value);
  }

  function chooseSecretTypes(values: ESecretType[]) {
    if (values.length === secretTypes.length && values.every((value) => secretTypes.includes(value))) return;
    invalidateResults();
    setSecretTypes(values);
  }

  function choosePageSize(value: number) {
    requestId.current += 1;
    filterRevision.current += 1;
    setSelectedIds(new Set());
    setLoading(true);
    setLoadError(false);
    setPage(0);
    setPageSize(value);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Finding status">
          <span className="mr-1 text-xs text-text-dim">Status</span>
          {([null, EFindingStatus.UNKNOWN, EFindingStatus.FAILED, EFindingStatus.INVALID, EFindingStatus.VALID] as const).map((value) => {
            const count = value === null ? allStatusCount : statusCounts.find((item) => item.status === value)?.count ?? 0;
            return (
              <button key={value ?? 'all'} type="button" onClick={() => chooseStatus(value)}
                aria-pressed={status === value}
                className={`border px-3 py-1.5 text-xs transition-colors ${status === value ? 'border-accent bg-accent/15 text-accent' : 'border-line bg-surface-2 text-text-dim hover:border-accent hover:text-text'}`}
              >
                {value ?? 'All'} <span className={`font-mono ${countsLoading ? 'opacity-50' : ''}`}>{countsError ? '—' : count}</span>
              </button>
            );
          })}
          <span className="ml-auto text-xs text-text-dim">
            {countsError ? 'Repositories —' : countsLoading ? 'Updating filters…' : `${repoOptions.length} repositories`}
          </span>
          {(repoId !== null || status !== null || secretTypes.length > 0) && (
            <button type="button" className="text-xs text-text-dim underline hover:text-text" onClick={() => {
              chooseRepo(null);
              chooseStatus(null);
              chooseSecretTypes([]);
            }}>Clear filters</button>
          )}
        </div>

      <div className="flex flex-wrap items-end gap-3">
        <RepositorySelect
          options={visibleRepoOptions.map((repo) => ({ value: repo.repoId, name: `${repo.owner}/${repo.name}`, label: formatRepoOptionLabel(repo) }))}
          value={repoId}
          onChange={chooseRepo}
          placeholder="All repositories"
          disabled={countsLoading || countsError}
        />

        <MultiSelect
          label="Secret type"
          options={TESTABLE_SECRET_TYPES.map((value) => ({
            value,
            label: value.replace(/_/g, ' '),
            count: countsError || (countsLoading && secretTypeCounts.length === 0)
              ? undefined
              : (secretTypeCounts.find((c) => c.secretType === value)?.count ?? 0),
          })).sort((a, b) => (b.count ?? 0) - (a.count ?? 0))}
          selected={secretTypes}
          onChange={chooseSecretTypes}
          updating={countsLoading}
          unavailable={countsError}
        />

        <button
          type="button"
          onClick={testSelected}
          disabled={loading || selectedIds.size === 0 || testingSelected || testingId !== null}
          className="border border-accent px-3 py-1.5 text-sm font-medium text-accent transition-colors hover:bg-accent/10 disabled:opacity-40"
        >
          {testingSelected ? 'Testing selected…' : `Test selected (${selectedIds.size})`}
        </button>
        <label className="flex items-center gap-2 text-xs text-text-dim">
          Rows per page
          <select
            value={pageSize}
            onChange={(event) => choosePageSize(Number(event.target.value))}
            disabled={loading || testingSelected || testingId !== null}
            className="border border-line bg-surface-2 px-2 py-1.5 text-sm text-text outline-none focus:border-accent disabled:opacity-50"
          >
            {[10, 50, 100, 200, 500, 1000].map((size) => <option key={size} value={size}>{size}</option>)}
          </select>
        </label>
        <span className="ml-auto font-mono text-xs text-text-dim">
          {loading ? 'Loading…' : loadError ? 'Load failed' : `${firstRow}-${lastRow} of ${total} rows`}
        </span>
      </div>

      {countsError && <p role="alert" className="text-sm text-red-400">Could not load filters. <button type="button" className="underline" onClick={() => refreshFacets(repoId, status, secretTypes)}>Retry</button></p>}

      {loadError && <p role="alert" className="text-sm text-red-400">Could not load findings. Check the API and try again.</p>}
      {!loading && !loadError && total === 0 && <p className="py-4 text-sm text-text-dim">No findings match these filters.</p>}

      {findings.length > 0 && (
        <>
          <fieldset disabled={loading}><Pagination page={page} pageCount={pageCount} onChange={loadPage} /></fieldset>

          <div aria-busy={loading} className={`overflow-x-auto border border-line ${loading ? 'opacity-50' : ''}`}>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-2 text-left text-xs text-text-dim">
                  <th className="px-3 py-2 font-medium">
                    <input
                      type="checkbox"
                      aria-label="Select all on this page"
                      checked={allSelected}
                      disabled={loading}
                      onChange={toggleSelectAll}
                    />
                  </th>
                  {repoId === null && <th className="px-3 py-2 font-medium">Repository</th>}
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
                        disabled={loading}
                        onChange={() => toggleSelected(finding.id)}
                      />
                    </td>
                    {repoId === null && <td className="max-w-48 truncate px-3 py-2 font-mono text-text-dim" title={`${finding.owner}/${finding.name}`}>{finding.owner}/{finding.name}</td>}
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
                      {finding.testReason && <div className="mt-1 max-w-md break-words text-xs text-text-dim">{finding.testReason}</div>}
                      <div className="mt-0.5 text-xs text-text-dim">{formatCheckedAt(finding.checkedAt)}</div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => needsRescan(finding) ? rescan(finding) : testOne(finding)}
                        disabled={loading || testingId !== null || testingSelected || rescanningRepoId === finding.repoId}
                        className="bg-accent px-3 py-1 text-xs font-medium text-ink transition-opacity hover:opacity-90 disabled:opacity-40"
                      >
                        {needsRescan(finding)
                          ? rescanningRepoId === finding.repoId ? 'Queuing…' : 'Rescan'
                          : testingId === finding.id ? 'Testing…' : 'Test'}
                      </button>
                      {!needsRescan(finding) && (
                        <button
                          type="button"
                          onClick={() => rescan(finding)}
                          disabled={loading || testingId === finding.id || rescanningRepoId === finding.repoId}
                          title="Rescan this repository for this service and reset its previous test results"
                          className="border border-line px-3 py-1 text-xs font-medium hover:bg-surface-2 disabled:opacity-40"
                        >
                          {rescanningRepoId === finding.repoId ? 'Queuing…' : 'Rescan'}
                        </button>
                      )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <fieldset disabled={loading}><Pagination page={page} pageCount={pageCount} onChange={loadPage} /></fieldset>
        </>
      )}

      {rescanJobId && <ProgressPanel key={rescanJobId} jobId={rescanJobId} onDone={refreshAfterRescan} />}
      {feedback && <p role="status" className="border border-line bg-surface-2 px-3 py-2 text-xs text-text-dim">{feedback}</p>}
    </div>
  );
}
