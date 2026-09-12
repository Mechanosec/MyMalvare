import { ESecretType } from './constant/secret-type.constant';
import { IFindingsPage, IFindingsRepoOption, ISecretTypeCount } from './types/finding.type';
import { IJobState } from './types/job-progress-event.type';
import { IQueueStatus } from './types/queue-status.type';
import { IScannedRepo } from './types/scanned-repo.type';

// Public on purpose: this API has no auth/token yet, so there is nothing
// sensitive to keep out of the browser bundle (see the frontend design
// spec's "Deviation from the datatector reference" section). Revisit this
// the day auth is added.
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

async function get<T>(path: string): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`GET ${path} failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    throw new Error(`POST ${path} failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export function fetchQueueStatus(): Promise<IQueueStatus> {
  return get<IQueueStatus>('/scan/status');
}

export interface IFindingsQuery {
  secretTypes?: ESecretType[];
  repoIds?: number[];
  search?: string;
  limit?: number;
  offset?: number;
}

export const FINDINGS_PAGE_SIZE = 50;

export function fetchFindings(query: IFindingsQuery = {}): Promise<IFindingsPage> {
  const params = new URLSearchParams();
  if (query.secretTypes?.length) params.set('secretTypes', query.secretTypes.join(','));
  if (query.repoIds?.length) params.set('repoIds', query.repoIds.join(','));
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
