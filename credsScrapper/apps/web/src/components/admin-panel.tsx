'use client';

import { useEffect, useState } from 'react';
import { decideRepoAuthorization, fetchAllRepoAuthorizations } from '../lib/api-client';
import { IRepoAuthorization } from '../lib/types/repo-authorization.type';

export function AdminPanel() {
  const [requests, setRequests] = useState<IRepoAuthorization[]>([]);

  function refresh() {
    fetchAllRepoAuthorizations().then(setRequests).catch(() => setRequests([]));
  }

  useEffect(refresh, []);

  async function decide(id: number, status: 'approved' | 'rejected') {
    await decideRepoAuthorization(id, status, undefined);
    refresh();
  }

  return (
    <div className="overflow-x-auto border border-line">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-line bg-surface-2 text-left text-xs text-text-dim">
            <th className="px-3 py-2 font-medium">Owner</th>
            <th className="px-3 py-2 font-medium">Repository</th>
            <th className="px-3 py-2 font-medium">Note</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium">Decide</th>
          </tr>
        </thead>
        <tbody>
          {requests.map((r) => (
            <tr key={r.id} className="border-b border-line bg-surface last:border-0">
              <td className="px-3 py-2 font-mono text-text">{r.owner}</td>
              <td className="px-3 py-2 font-mono text-text">{r.name}</td>
              <td className="px-3 py-2 text-text-dim">{r.note ?? '—'}</td>
              <td className="px-3 py-2 text-text-dim">{r.status}</td>
              <td className="px-3 py-2">
                {r.status === 'pending' && (
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => decide(r.id, 'approved')}
                      className="border border-line px-2 py-1 text-xs text-text hover:border-accent"
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      onClick={() => decide(r.id, 'rejected')}
                      className="border border-line px-2 py-1 text-xs text-text hover:border-accent"
                    >
                      Reject
                    </button>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
