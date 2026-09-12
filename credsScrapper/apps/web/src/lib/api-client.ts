import { EFindingStatus } from './constant/finding-status.constant';
import { ESecretType } from './constant/secret-type.constant';
import { IFindingsPage, IFindingsRepoOption, ISecretTypeCount } from './types/finding.type';
import { IJobState } from './types/job-progress-event.type';
import { IQueueStatus } from './types/queue-status.type';
import { IScannedRepo } from './types/scanned-repo.type';
import { IAuthResult, IAuthUser } from './types/auth.type';
import { IRepoAuthorization } from './types/repo-authorization.type';

// Public on purpose: this API has no auth/token yet, so there is nothing
// sensitive to keep out of the browser bundle (see the frontend design
// spec's "Deviation from the datatector reference" section). Revisit this
// the day auth is added.
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

const AUTH_TOKEN_KEY = 'credsscrapper:authToken';

export function getAuthToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(AUTH_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setAuthToken(token: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (token) localStorage.setItem(AUTH_TOKEN_KEY, token);
    else localStorage.removeItem(AUTH_TOKEN_KEY);
  } catch {
    /* per-viewer convenience only - fine if it can't be saved */
  }
}

function authHeaders(): Record<string, string> {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function get<T>(path: string): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, { cache: 'no-store', headers: authHeaders() });
  if (!response.ok) {
    throw new Error(`GET ${path} failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    throw new Error(`POST ${path} failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

async function patch<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`PATCH ${path} failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export function register(email: string, password: string): Promise<IAuthResult> {
  return post<IAuthResult>('/auth/register', { email, password });
}

export function login(email: string, password: string): Promise<IAuthResult> {
  return post<IAuthResult>('/auth/login', { email, password });
}

export function getMe(): Promise<IAuthUser> {
  return get<IAuthUser>('/auth/me');
}

export function fetchQueueStatus(): Promise<IQueueStatus> {
  return get<IQueueStatus>('/scan/status');
}

export interface IFindingsQuery {
  secretTypes?: ESecretType[];
  repoIds?: number[];
  statuses?: EFindingStatus[];
  search?: string;
  limit?: number;
  offset?: number;
}

export const FINDINGS_PAGE_SIZE = 50;

export function fetchFindings(query: IFindingsQuery = {}): Promise<IFindingsPage> {
  const params = new URLSearchParams();
  if (query.secretTypes?.length) params.set('secretTypes', query.secretTypes.join(','));
  if (query.repoIds?.length) params.set('repoIds', query.repoIds.join(','));
  if (query.statuses?.length) params.set('statuses', query.statuses.join(','));
  if (query.search) params.set('search', query.search);
  params.set('limit', String(query.limit ?? FINDINGS_PAGE_SIZE));
  params.set('offset', String(query.offset ?? 0));
  return get<IFindingsPage>(`/findings?${params.toString()}`);
}

export function fetchFindingsRepoOptions(limit?: number): Promise<IFindingsRepoOption[]> {
  return get<IFindingsRepoOption[]>(`/findings/repos${limit ? `?limit=${limit}` : ''}`);
}

export function fetchFindingsSecretTypeCounts(): Promise<ISecretTypeCount[]> {
  return get<ISecretTypeCount[]>('/findings/secret-type-counts');
}

export function updateFindingStatus(id: number, status: EFindingStatus): Promise<{ ok: true }> {
  return patch<{ ok: true }>(`/findings/${id}/status`, { status });
}

export function startDiscover(): Promise<{ jobId: string }> {
  return post<{ jobId: string }>('/discover');
}

export interface IStartScanBody {
  workers?: number;
  maxRepos?: number;
}

export function startScan(body: IStartScanBody): Promise<{ jobId: string }> {
  return post<{ jobId: string }>('/scan', body);
}

export function fetchJob(jobId: string): Promise<IJobState> {
  return get<IJobState>(`/jobs/${jobId}`);
}

export function fetchScannedRepos(limit = 100): Promise<IScannedRepo[]> {
  return get<IScannedRepo[]>(`/scan/repos?limit=${limit}`);
}

export function submitRepoAuthorization(owner: string, name: string, note?: string): Promise<IRepoAuthorization> {
  return post<IRepoAuthorization>('/repo-authorizations', { owner, name, note });
}

export function fetchMyRepoAuthorizations(): Promise<IRepoAuthorization[]> {
  return get<IRepoAuthorization[]>('/repo-authorizations/mine');
}
