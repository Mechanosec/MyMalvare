'use client';

import { useState } from 'react';

interface ISecretValueProps {
  readonly value: string;
}

function mask(value: string): string {
  if (value.length <= 8) return '•'.repeat(value.length);
  return `${value.slice(0, 4)}${'•'.repeat(Math.min(value.length - 8, 20))}${value.slice(-4)}`;
}

// Findings hold a real, live secret value (see the repo's guardrail on
// plaintext storage) - shown masked by default so it isn't exposed on a
// shared screen or a screenshot by accident, with an explicit eye button
// (not just clicking the text, which wasn't discoverable as interactive)
// to reveal it when someone actually needs to read or copy it.
export function SecretValue({ value }: ISecretValueProps) {
  const [revealed, setRevealed] = useState(false);

  return (
    <span className={`inline-flex items-start gap-2 ${revealed ? 'max-w-56' : 'whitespace-nowrap'}`}>
      <span className={`min-w-0 font-mono text-text ${revealed ? 'break-all' : 'whitespace-nowrap'}`}>{revealed ? value : mask(value)}</span>
      <button
        type="button"
        onClick={() => setRevealed((prev) => !prev)}
        aria-label={revealed ? 'Hide secret' : 'Reveal secret'}
        title={revealed ? 'Hide secret' : 'Reveal secret'}
        className="shrink-0 text-text-dim hover:text-accent"
      >
        {revealed ? (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M2 2l12 12M6.5 6.7A2 2 0 008 10a2 2 0 001.4-3.4M4 4.3C2.4 5.4 1.2 7 1.2 8c0 0 2 4 6.8 4 1.1 0 2.1-.2 2.9-.6M9.8 3.4c-.6-.1-1.2-.2-1.8-.2-.5 0-1 .1-1.4.2m5.4 2c1 .9 1.6 2 1.6 2.6 0 0-.6 1.2-1.9 2.3"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M1.2 8S3.2 4 8 4s6.8 4 6.8 4-2 4-6.8 4-6.8-4-6.8-4z"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinejoin="round"
            />
            <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.3" />
          </svg>
        )}
      </button>
    </span>
  );
}
