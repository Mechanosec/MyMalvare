'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { getAuthToken, getMe, login as apiLogin, register as apiRegister, setAuthToken } from './api-client';
import { IAuthUser } from './types/auth.type';

interface IAuthContextValue {
  readonly user: IAuthUser | null;
  readonly loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<IAuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<IAuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!getAuthToken()) {
      setLoading(false);
      return;
    }
    getMe()
      .then(setUser)
      .catch(() => setAuthToken(null))
      .finally(() => setLoading(false));
  }, []);

  async function login(email: string, password: string) {
    const result = await apiLogin(email, password);
    setAuthToken(result.token);
    setUser(result.user);
  }

  async function register(email: string, password: string) {
    const result = await apiRegister(email, password);
    setAuthToken(result.token);
    setUser(result.user);
  }

  function logout() {
    setAuthToken(null);
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): IAuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
