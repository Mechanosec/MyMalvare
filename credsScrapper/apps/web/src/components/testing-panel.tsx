'use client';

import { useEffect, useState } from 'react';
import { fetchFindings, fetchMyTestableRepos, updateFindingStatus } from '../lib/api-client';
import { EFindingStatus } from '../lib/constant/finding-status.constant';
import { IFinding, IFindingsRepoOption } from '../lib/types/finding.type';
import { FindingStatusBadge } from './finding-status-badge';
import { SecretTypeBadge } from './secret-type-badge';
import { SecretValue } from './secret-value';

// Manual, human-recorded verdicts only - see CLAUDE.md's "Detection is
// passive, always" rule. This tool never calls out to a service with a
// secret it found; it only records what the user tells it after
// checking a key by whatever means they choose.
export function TestingPanel() {
  const [repoOptions, setRepoOptions] = useState<IFindingsRepoOption[]>([]);
  const [repoId, setRepoId] = useState<number | null>(null);
  const [findings, setFindings] = useState<readonly IFinding[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchMyTestableRepos().then(setRepoOptions).catch(() => setRepoOptions([]));
  }, []);

  async function loadKeys() {
    if (repoId === null) return;
    setLoading(true);
    try {
      const page = await fetchFindings({ repoIds: [repoId], limit: 1000 });
      setFindings(page.items);
      setLog((prev) => [...prev, `Loaded ${page.items.length} finding(s) for repo ${repoId}`]);
    } catch {
      setFindings([]);
      setLog((prev) => [...prev, `Failed to load findings for repo ${repoId}`]);
    } finally {
      setLoading(false);
    }
  }

  async function mark(finding: IFinding, status: EFindingStatus) {
    try {
      await updateFindingStatus(finding.id, status);
      setFindings((prev) => prev.map((f) => (f.id === finding.id ? { ...f, status } : f)));
      setLog((prev) => [
        ...prev,
        `${finding.secretType} in ${finding.filePath} marked ${status}`,
      ]);
    } catch {
      setLog((prev) => [
        ...prev,
        `Failed to mark ${finding.secretType} in ${finding.filePath} as ${status}`,
      ]);
    }
  }

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
        <button
          type="button"
          onClick={loadKeys}
          disabled={repoId === null || loading}
          className="border border-line bg-surface-2 px-3 py-1.5 text-sm text-text hover:border-accent disabled:opacity-50"
        >
          Load keys
        </button>
      </div>

      {findings.length > 0 && (
        <div className="overflow-x-auto border border-line">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-2 text-left text-xs text-text-dim">
                <th className="px-3 py-2 font-medium">File</th>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium">Secret</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Mark as</th>
              </tr>
            </thead>
            <tbody>
              {findings.map((finding) => (
                <tr key={finding.id} className="border-b border-line bg-surface last:border-0">
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
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => mark(finding, EFindingStatus.VALID)}
                        className="border border-line px-2 py-1 text-xs text-text hover:border-accent"
                      >
                        Valid
                      </button>
                      <button
                        type="button"
                        onClick={() => mark(finding, EFindingStatus.INVALID)}
                        className="border border-line px-2 py-1 text-xs text-text hover:border-accent"
                      >
                        Invalid
                      </button>
                      <button
                        type="button"
                        onClick={() => mark(finding, EFindingStatus.UNKNOWN)}
                        className="border border-line px-2 py-1 text-xs text-text hover:border-accent"
                      >
                        Unknown
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
