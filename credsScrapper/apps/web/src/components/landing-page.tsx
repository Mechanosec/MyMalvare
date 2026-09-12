'use client';

import { LoginForm } from './login-form';

interface ILandingPageProps {
  readonly onLogin: (email: string, password: string) => void;
  readonly onRegister: (email: string, password: string) => void;
  readonly error?: string | null;
}

const FEATURES = [
  {
    title: 'Deep secret detection',
    body: 'Scans repository trees and full git history for leaked API keys, tokens, and paired credentials across dozens of services.',
  },
  {
    title: 'Live validity checks',
    body: 'Once you approve a repo, automated checks tell you whether a leaked key is still active — not just that it once existed.',
  },
  {
    title: 'Private by design',
    body: "Every account only sees its own approved repositories. Nothing you haven't authorized is ever scanned or shown.",
  },
] as const;

export function LandingPage({ onLogin, onRegister, error }: ILandingPageProps) {
  return (
    <main className="min-h-full">
      <header className="border-b border-line px-6 py-4">
        <div className="mx-auto flex max-w-6xl items-center gap-3">
          <span className="h-2 w-2 rounded-full bg-accent" />
          <h1 className="text-base font-semibold">credsScrapper</h1>
          <span className="text-sm text-text-dim">GitHub secret scanner</span>
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl gap-10 px-6 py-16 lg:grid-cols-[1.2fr_1fr] lg:items-start">
        <div className="space-y-8">
          <div className="space-y-3">
            <h2 className="text-2xl font-semibold text-text">
              Find leaked credentials in your GitHub repos before someone else does.
            </h2>
            <p className="text-sm leading-relaxed text-text-dim">
              credsScrapper scans your repositories — including full commit history, not just the
              current tree — for API keys, tokens, and other secrets that were ever committed.
              Approve a repository once, and it stays under continuous, authorized watch.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            {FEATURES.map((feature) => (
              <div key={feature.title} className="border border-line bg-surface p-4">
                <h3 className="mb-1 text-sm font-semibold text-text">{feature.title}</h3>
                <p className="text-xs leading-relaxed text-text-dim">{feature.body}</p>
              </div>
            ))}
          </div>

          <p className="text-xs text-text-dim">
            Access is invite-based. Log in or register, then submit a repository for approval to
            get started.
          </p>
        </div>

        <LoginForm onLogin={onLogin} onRegister={onRegister} error={error} />
      </div>
    </main>
  );
}
