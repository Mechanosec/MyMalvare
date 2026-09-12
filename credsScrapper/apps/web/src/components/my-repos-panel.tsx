'use client';

import { useEffect, useState } from 'react';
import { fetchMyRepoAuthorizations, scanMyRepo, submitRepoAuthorization } from '../lib/api-client';
import { IRepoAuthorization } from '../lib/types/repo-authorization.type';
import { ProgressPanel } from './progress-panel';

const TONE_BY_STATUS: Record<IRepoAuthorization['status'], string> = {
  pending: 'text-warning border-warning/50 bg-warning/10',
  approved: 'text-accent border-accent-dim bg-accent/10',
  rejected: 'text-critical border-critical/50 bg-critical/10',
};

export function MyReposPanel() {
  const [requests, setRequests] = useState<IRepoAuthorization[]>([]);
  const [owner, setOwner] = useState('');
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [scanningRequestId, setScanningRequestId] = useState<number | null>(null);
  const [scanJobId, setScanJobId] = useState<string | null>(null);
  const [scanError, setScanError] = useState<{ id: number; text: string } | null>(null);

  function refresh() {
    fetchMyRepoAuthorizations().then(setRequests).catch(() => setRequests([]));
  }

  async function scan(request: IRepoAuthorization) {
    setScanningRequestId(request.id);
    setScanJobId(null);
    setScanError(null);
    try {
      const { jobId } = await scanMyRepo(request.owner, request.name);
      setScanJobId(jobId);
    } catch {
      setScanError({ id: request.id, text: 'Failed to start scan — see server logs for details.' });
      setScanningRequestId(null);
    }
  }

  useEffect(refresh, []);

  // Splits a pasted "owner/name" out of whichever field it landed in, so
  // pasting the full slug from the Findings/Repositories tab into either
  // box still submits the correct owner/name pair instead of a literal
  // slash-containing name that can never match a scanned repo.
  function splitOwnerName(rawOwner: string, rawName: string): { owner: string; name: string } {
    const slashIn = rawName.includes('/') ? rawName : rawOwner.includes('/') ? rawOwner : null;
    if (!slashIn) return { owner: rawOwner, name: rawName };
    const [splitOwner, ...rest] = slashIn.split('/');
    return { owner: splitOwner, name: rest.join('/') };
  }

  async function submit() {
    const normalized = splitOwnerName(owner.trim(), name.trim());
    if (!normalized.owner || !normalized.name) return;
    await submitRepoAuthorization(normalized.owner, normalized.name, note || undefined);
    setOwner('');
    setName('');
    setNote('');
    refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor="repo-owner" className="mb-1 block text-xs text-text-dim">
            Owner
          </label>
          <input
            id="repo-owner"
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
            className="w-48 border border-line bg-surface-2 px-2 py-1.5 text-sm text-text outline-none focus:border-accent"
          />
        </div>
        <div>
          <label htmlFor="repo-name" className="mb-1 block text-xs text-text-dim">
            Repository name
          </label>
          <input
            id="repo-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="name or owner/name"
            className="w-48 border border-line bg-surface-2 px-2 py-1.5 text-sm text-text outline-none placeholder:text-text-dim focus:border-accent"
          />
        </div>
        <div>
          <label htmlFor="repo-note" className="mb-1 block text-xs text-text-dim">
            Note (optional)
          </label>
          <input
            id="repo-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="w-64 border border-line bg-surface-2 px-2 py-1.5 text-sm text-text outline-none focus:border-accent"
          />
        </div>
        <button
          type="button"
          onClick={submit}
          className="border border-line bg-surface-2 px-3 py-1.5 text-sm text-text hover:border-accent"
        >
          Submit request
        </button>
      </div>

      <div className="overflow-x-auto border border-line">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-line bg-surface-2 text-left text-xs text-text-dim">
              <th className="px-3 py-2 font-medium">Owner</th>
              <th className="px-3 py-2 font-medium">Repository</th>
              <th className="px-3 py-2 font-medium">Note</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Admin note</th>
              <th className="px-3 py-2 font-medium">Scan</th>
            </tr>
          </thead>
          <tbody>
            {requests.map((r) => (
              <tr key={r.id} className="border-b border-line bg-surface last:border-0">
                <td className="px-3 py-2 font-mono text-text">{r.owner}</td>
                <td className="px-3 py-2 font-mono text-text">{r.name}</td>
                <td className="px-3 py-2 text-text-dim">{r.note ?? '—'}</td>
                <td className="px-3 py-2">
                  <span className={`inline-flex items-center rounded-sm border px-2 py-0.5 text-xs font-medium ${TONE_BY_STATUS[r.status]}`}>
                    {r.status}
                  </span>
                </td>
                <td className="px-3 py-2 text-text-dim">{r.adminNote ?? '—'}</td>
                <td className="px-3 py-2">
                  {r.status === 'approved' ? (
                    <button
                      type="button"
                      onClick={() => scan(r)}
                      disabled={scanningRequestId === r.id && scanJobId === null}
                      className="shrink-0 whitespace-nowrap border border-accent-dim bg-accent/10 px-3 py-1 text-xs font-medium text-accent hover:bg-accent/20 disabled:opacity-40"
                    >
                      {scanningRequestId === r.id && scanJobId === null ? 'Starting…' : 'Scan'}
                    </button>
                  ) : (
                    <span className="text-xs text-text-dim">—</span>
                  )}
                  {scanError?.id === r.id && <p className="mt-1 text-xs text-critical">{scanError.text}</p>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {scanningRequestId !== null && (
        <ProgressPanel key={scanJobId} jobId={scanJobId} />
      )}
    </div>
  );
}
