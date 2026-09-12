'use client';

import { useState } from 'react';

interface ILoginFormProps {
  readonly onLogin: (email: string, password: string) => void;
  readonly onRegister: (email: string, password: string) => void;
  readonly error?: string | null;
}

export function LoginForm({ onLogin, onRegister, error }: ILoginFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  return (
    <div className="mx-auto mt-16 max-w-sm space-y-3 border border-line bg-surface p-6">
      <h2 className="text-sm font-semibold text-text">Log in to credsScrapper</h2>
      <div>
        <label htmlFor="login-email" className="mb-1 block text-xs text-text-dim">
          Email
        </label>
        <input
          id="login-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full border border-line bg-surface-2 px-2 py-1.5 text-sm text-text outline-none focus:border-accent"
        />
      </div>
      <div>
        <label htmlFor="login-password" className="mb-1 block text-xs text-text-dim">
          Password
        </label>
        <input
          id="login-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full border border-line bg-surface-2 px-2 py-1.5 text-sm text-text outline-none focus:border-accent"
        />
      </div>
      {error && <p className="text-xs text-critical">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onLogin(email, password)}
          className="flex-1 border border-line bg-surface-2 px-3 py-1.5 text-sm text-text hover:border-accent"
        >
          Log in
        </button>
        <button
          type="button"
          onClick={() => onRegister(email, password)}
          className="flex-1 border border-line bg-surface-2 px-3 py-1.5 text-sm text-text hover:border-accent"
        >
          Register
        </button>
      </div>
    </div>
  );
}
