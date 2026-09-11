'use client';

import { useEffect, useState } from 'react';
import { fetchFindings } from '../lib/api-client';
import { ESecretType } from '../lib/constant/secret-type.constant';
import { IFinding } from '../lib/types/finding.type';

interface IFindingsTableProps {
  readonly initialFindings: IFinding[];
  readonly refreshKey: number;
}

export function FindingsTable({ initialFindings, refreshKey }: IFindingsTableProps) {
  const [secretType, setSecretType] = useState<ESecretType | ''>('');
  const [findings, setFindings] = useState(initialFindings);

  useEffect(() => {
    fetchFindings({ secretType: secretType || undefined })
      .then(setFindings)
      .catch(() => setFindings([]));
  }, [secretType, refreshKey]);

  return (
    <div>
      <label className="mb-2 flex flex-col text-sm">
        Secret type
        <select
          value={secretType}
          onChange={(e) => setSecretType(e.target.value as ESecretType | '')}
          className="w-64 rounded border px-2 py-1"
        >
          <option value="">All</option>
          {Object.values(ESecretType).map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </label>

      {findings.length === 0 ? (
        <p className="text-sm text-gray-500">No findings yet.</p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="py-1 pr-4">Repo</th>
              <th className="py-1 pr-4">File</th>
              <th className="py-1 pr-4">Type</th>
              <th className="py-1 pr-4">Context</th>
              <th className="py-1">Line</th>
            </tr>
          </thead>
          <tbody>
            {findings.map((finding) => (
              <tr key={finding.id} className="border-b">
                <td className="py-1 pr-4">
                  {finding.owner}/{finding.name}
                </td>
                <td className="py-1 pr-4">{finding.filePath}</td>
                <td className="py-1 pr-4">{finding.secretType}</td>
                <td className="py-1 pr-4">{finding.context ?? '—'}</td>
                <td className="py-1">{finding.lineNumber ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
