import { EFindingStatus } from './constant/finding-status.constant';
import { ESecretType } from './constant/secret-type.constant';
import { IFinding, IFindingsPage, IFindingsRepoOption, ISecretTypeCount, IStatusCount, ITestingFacets } from './types/finding.type';
import { IJobState } from './types/job-progress-event.type';
import { IQueueStatus } from './types/queue-status.type';
import { IScannedRepo } from './types/scanned-repo.type';
import { IAuthResult, IAuthUser } from './types/auth.type';
import { IRepoAuthorization } from './types/repo-authorization.type';

// Public on purpose: this is just the base URL the browser talks to, not a
// secret (see the frontend design spec's "Deviation from the datatector
// reference" section). The JWT itself is stored in localStorage below and
// sent as a bearer token, not baked into this constant.
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

export interface ITestingFacetsQuery {
  repoId?: number | null;
  status?: EFindingStatus | null;
  secretTypes: readonly ESecretType[];
  testableTypes: readonly ESecretType[];
}

function testingFacetParams(query: ITestingFacetsQuery): string {
  const params = new URLSearchParams({ testableTypes: query.testableTypes.join(',') });
  if (query.repoId !== null && query.repoId !== undefined) params.set('repoId', String(query.repoId));
  if (query.status) params.set('status', query.status);
  if (query.secretTypes.length) params.set('secretTypes', query.secretTypes.join(','));
  return params.toString();
}

export function fetchTestingFacets(query: ITestingFacetsQuery): Promise<ITestingFacets> {
  return get<ITestingFacets>(`/findings/testing-facets?${testingFacetParams(query)}`);
}

export function fetchMyTestingFacets(query: ITestingFacetsQuery): Promise<ITestingFacets> {
  return get<ITestingFacets>(`/repo-authorizations/mine/testing-facets?${testingFacetParams(query)}`);
}

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

export function fetchFindingsRepoOptions(
  limit?: number,
  secretTypes?: ESecretType[],
): Promise<IFindingsRepoOption[]> {
  const params = new URLSearchParams();
  if (limit) params.set('limit', String(limit));
  if (secretTypes?.length) params.set('secretTypes', secretTypes.join(','));
  const query = params.toString();
  return get<IFindingsRepoOption[]>(`/findings/repos${query ? `?${query}` : ''}`);
}

export function fetchFindingsSecretTypeCounts(repoId?: number): Promise<ISecretTypeCount[]> {
  return get<ISecretTypeCount[]>(`/findings/secret-type-counts${repoId !== undefined ? `?repoId=${repoId}` : ''}`);
}

export function fetchFindingsStatusCounts(repoId?: number, secretTypes?: ESecretType[]): Promise<IStatusCount[]> {
  const params = new URLSearchParams();
  if (repoId !== undefined) params.set('repoId', String(repoId));
  if (secretTypes?.length) params.set('secretTypes', secretTypes.join(','));
  const query = params.toString();
  return get<IStatusCount[]>(`/findings/status-counts${query ? `?${query}` : ''}`);
}

export function fetchMyTestableRepos(secretTypes?: ESecretType[]): Promise<IFindingsRepoOption[]> {
  const query = secretTypes?.length ? `?secretTypes=${secretTypes.join(',')}` : '';
  return get<IFindingsRepoOption[]>(`/repo-authorizations/mine/testable-repos${query}`);
}

export function fetchMySecretTypeCounts(repoId: number): Promise<ISecretTypeCount[]> {
  return get<ISecretTypeCount[]>(`/repo-authorizations/mine/secret-type-counts?repoId=${repoId}`);
}

export function fetchMyStatusCounts(repoId: number, secretTypes?: ESecretType[]): Promise<IStatusCount[]> {
  const params = new URLSearchParams({ repoId: String(repoId) });
  if (secretTypes?.length) params.set('secretTypes', secretTypes.join(','));
  return get<IStatusCount[]>(`/repo-authorizations/mine/status-counts?${params.toString()}`);
}

export function updateFindingStatus(id: number, status: EFindingStatus): Promise<{ ok: true }> {
  return patch<{ ok: true }>(`/findings/${id}/status`, { status });
}

export function testMyFinding(id: number): Promise<IFinding> {
  return post<IFinding>(`/repo-authorizations/mine/test-finding/${id}`);
}

export function testMyRepoFindings(repoId: number): Promise<IFinding[]> {
  return post<IFinding[]>(`/repo-authorizations/mine/test-repo/${repoId}`);
}

// Admin-only, unscoped equivalents - any repo/finding, no RepoAuthorization
// required. MVP stand-in until scanning+testing runs automatically.
export function adminTestFinding(id: number): Promise<IFinding> {
  return post<IFinding>(`/findings/${id}/test`);
}

export function adminTestRepoFindings(repoId: number): Promise<IFinding[]> {
  return post<IFinding[]>(`/findings/test-repo/${repoId}`);
}

export function fetchMyFindings(query: IFindingsQuery = {}): Promise<IFindingsPage> {
  const params = new URLSearchParams();
  if (query.repoIds?.length === 1) params.set('repoId', String(query.repoIds[0]));
  if (query.secretTypes?.length) params.set('secretTypes', query.secretTypes.join(','));
  if (query.statuses?.length) params.set('statuses', query.statuses.join(','));
  if (query.search) params.set('search', query.search);
  params.set('limit', String(query.limit ?? FINDINGS_PAGE_SIZE));
  params.set('offset', String(query.offset ?? 0));
  return get<IFindingsPage>(`/repo-authorizations/mine/findings?${params.toString()}`);
}

export function fetchMyScannedRepos(): Promise<IScannedRepo[]> {
  return get<IScannedRepo[]>('/repo-authorizations/mine/scanned-repos');
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

export function startScanRepo(owner: string, name: string, secretType?: ESecretType): Promise<{ repoId: number; jobId: string }> {
  return post<{ repoId: number; jobId: string }>('/scan/repo', { owner, name, ...(secretType ? { secretType } : {}) });
}

export function fetchJob(jobId: string): Promise<IJobState> {
  return get<IJobState>(`/jobs/${jobId}`);
}

export function stopJob(jobId: string): Promise<{ ok: true }> {
  return post<{ ok: true }>(`/jobs/${jobId}/stop`);
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

export function fetchAllRepoAuthorizations(status?: string): Promise<IRepoAuthorization[]> {
  return get<IRepoAuthorization[]>(`/repo-authorizations${status ? `?status=${status}` : ''}`);
}

export function decideRepoAuthorization(
  id: number,
  status: 'approved' | 'rejected',
  adminNote?: string,
): Promise<IRepoAuthorization> {
  return patch<IRepoAuthorization>(`/repo-authorizations/${id}`, { status, adminNote });
}

export function scanMyRepo(owner: string, name: string, secretType?: ESecretType): Promise<{ repoId: number; jobId: string }> {
  return post<{ repoId: number; jobId: string }>('/repo-authorizations/mine/scan-repo', { owner, name, ...(secretType ? { secretType } : {}) });
}
