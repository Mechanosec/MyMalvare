import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as apiClient from '../lib/api-client';
import * as authContext from '../lib/auth-context';
import { EScanStatus } from '../lib/constant/scan-status.constant';
import { EFindingStatus } from '../lib/constant/finding-status.constant';
import { ESecretType } from '../lib/constant/secret-type.constant';
import { IQueueStatus } from '../lib/types/queue-status.type';
import { Dashboard } from './dashboard';

const admin = { id: 1, email: 'admin@example.test', role: 'admin' as const };
const viewer = { id: 2, email: 'viewer@example.test', role: 'user' as const };
const readyStatus: IQueueStatus = {
  pendingCandidates: 0,
  scannedByStatus: { [EScanStatus.DONE]: 1 },
  runtime: {
    epoch: 0, state: 'ready', stopEpoch: null, requestedAt: null, finishedAt: null,
    queues: {
      control: { queued: 0, active: 0 },
      head: { queued: 0, active: 0 },
      history: { queued: 0, active: 1 },
    },
  },
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  localStorage.clear();
});

function mockAuth(overrides: Partial<ReturnType<typeof authContext.useAuth>>) {
  vi.spyOn(authContext, 'useAuth').mockReturnValue({
    user: null,
    loading: false,
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    ...overrides,
  });
}

describe('Dashboard', () => {
  it('renders nothing while the stored session is still being verified, instead of flashing the landing page', () => {
    mockAuth({ loading: true, user: null });

    const { container } = render(<Dashboard />);

    expect(container).toBeEmptyDOMElement();
  });

  it('shows the landing page once verification finishes and there is no user', () => {
    mockAuth({ loading: false, user: null });

    render(<Dashboard />);

    expect(screen.getByRole('button', { name: 'Log in' })).toBeInTheDocument();
  });

  it('offers global Stop for background HISTORY without a remembered job', async () => {
    mockAuth({ user: admin });
    vi.spyOn(apiClient, 'fetchScannedRepos').mockResolvedValue([]);
    vi.spyOn(apiClient, 'fetchQueueStatus').mockResolvedValue(readyStatus);

    render(<Dashboard />);

    expect(await screen.findByRole('button', { name: 'Stop all scans' })).toBeEnabled();
    expect(screen.getByText('HISTORY jobs')).toBeInTheDocument();
    expect(screen.getByText('No job running.')).toBeInTheDocument();
  });

  it('shows Stopping after 202 and waits for server stopped before showing Stopped', async () => {
    mockAuth({ user: admin });
    vi.spyOn(apiClient, 'fetchScannedRepos').mockResolvedValue([]);
    const fetchStatus = vi.spyOn(apiClient, 'fetchQueueStatus').mockResolvedValue(readyStatus);
    vi.spyOn(apiClient, 'stopAllScans').mockResolvedValue({
      epoch: 1, state: 'stopping', stopEpoch: 1, requestedAt: '2026-09-22T10:00:00Z', finishedAt: null,
    });
    render(<Dashboard />);
    fireEvent.click(await screen.findByRole('button', { name: 'Stop all scans' }));

    expect(await screen.findByText('Stopping…')).toBeInTheDocument();
    expect(screen.queryByText('Stopped')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Scan' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Discover' })).toBeEnabled();

    fetchStatus.mockResolvedValue({
      ...readyStatus,
      runtime: { ...readyStatus.runtime, state: 'stopped', finishedAt: '2026-09-22T10:00:02Z', queues: {
        control: { queued: 0, active: 0 }, head: { queued: 0, active: 0 }, history: { queued: 0, active: 0 },
      } },
    });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 2200)); });
    expect(await screen.findByText('Stopped')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Scan' })).toBeEnabled();
  });

  it('restores stopping from server status after reload and hides global Stop from non-admins', async () => {
    mockAuth({ user: admin });
    vi.spyOn(apiClient, 'fetchScannedRepos').mockResolvedValue([]);
    const fetchStatus = vi.spyOn(apiClient, 'fetchQueueStatus').mockResolvedValue({
      ...readyStatus, runtime: { ...readyStatus.runtime, state: 'stopping', epoch: 1, stopEpoch: 1 },
    });
    const { unmount } = render(<Dashboard />);
    expect(await screen.findByText('Stopping…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Scan' })).toBeDisabled();
    unmount();

    vi.restoreAllMocks();
    mockAuth({ user: viewer });
    vi.spyOn(apiClient, 'fetchMyScannedRepos').mockResolvedValue([]);
    render(<Dashboard />);
    expect(screen.queryByRole('button', { name: 'Stop all scans' })).not.toBeInTheDocument();
    expect(fetchStatus).toHaveBeenCalledTimes(1);
  });

  it('does not turn a failed runtime request into zero activity', async () => {
    mockAuth({ user: admin });
    vi.spyOn(apiClient, 'fetchScannedRepos').mockResolvedValue([]);
    vi.spyOn(apiClient, 'fetchQueueStatus').mockRejectedValue(new Error('offline'));
    render(<Dashboard />);
    expect(await screen.findByText(/Could not reach the API/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Stop all scans' })).not.toBeInTheDocument();
    expect(screen.queryByText('HISTORY jobs')).not.toBeInTheDocument();
  });

  it('ignores an older ready poll response after Stop has been accepted', async () => {
    mockAuth({ user: admin });
    vi.spyOn(apiClient, 'fetchScannedRepos').mockResolvedValue([]);
    let finishOldPoll!: (status: IQueueStatus) => void;
    const fetchStatus = vi.spyOn(apiClient, 'fetchQueueStatus')
      .mockResolvedValueOnce(readyStatus)
      .mockImplementationOnce(() => new Promise((resolve) => { finishOldPoll = resolve; }))
      .mockResolvedValue(readyStatus);
    vi.spyOn(apiClient, 'stopAllScans').mockResolvedValue({
      epoch: 1, state: 'stopping', stopEpoch: 1, requestedAt: '2026-09-22T10:00:00Z', finishedAt: null,
    });
    render(<Dashboard />);
    await screen.findByRole('button', { name: 'Stop all scans' });
    await waitFor(() => expect(fetchStatus).toHaveBeenCalledTimes(2), { timeout: 3000 });

    fireEvent.click(screen.getByRole('button', { name: 'Stop all scans' }));
    expect(await screen.findByText('Stopping…')).toBeInTheDocument();
    await act(async () => finishOldPoll(readyStatus));
    expect(screen.getByText('Stopping…')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Stop all scans' })).not.toBeInTheDocument();
  });

  it('keeps discovery usable and reports a rejected scan without retrying', async () => {
    mockAuth({ user: admin });
    vi.spyOn(apiClient, 'fetchScannedRepos').mockResolvedValue([]);
    vi.spyOn(apiClient, 'fetchQueueStatus').mockResolvedValue(readyStatus);
    const startScan = vi.spyOn(apiClient, 'startScan').mockRejectedValue(new Error('Scan stopping (409). Wait until it stops, then retry.'));
    render(<Dashboard />);
    fireEvent.click(await screen.findByRole('button', { name: 'Scan' }));
    expect(await screen.findByText(/Scan stopping \(409\)/)).toBeInTheDocument();
    expect(startScan).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Discover' })).toBeEnabled();
  });

  it('keeps live testing and authorization usable while scan and rescan are stopped', async () => {
    mockAuth({ user: admin });
    vi.spyOn(apiClient, 'fetchScannedRepos').mockResolvedValue([]);
    vi.spyOn(apiClient, 'fetchQueueStatus').mockResolvedValue({
      ...readyStatus, runtime: { ...readyStatus.runtime, state: 'stopping', epoch: 1, stopEpoch: 1 },
    });
    vi.spyOn(apiClient, 'fetchTestingFacets').mockResolvedValue({
      repositories: [{ repoId: 1, owner: 'synthetic', name: 'repo', count: 2, validCount: 1, invalidCount: 0, failedCount: 1, unknownCount: 0 }],
      statuses: [{ status: EFindingStatus.VALID, count: 1 }, { status: EFindingStatus.FAILED, count: 1 }],
      secretTypes: [{ secretType: ESecretType.GITHUB_PAT, count: 2 }],
    });
    const baseFinding = {
      id: 1, repoId: 1, owner: 'synthetic', name: 'repo', filePath: 'config.txt', commitSha: 'abc',
      secretType: ESecretType.GITHUB_PAT, secretValue: 'synthetic-placeholder', lineNumber: 1,
      context: null, foundAt: '2026-09-22T10:00:00Z', checkedAt: null, leakCommits: ['abc'],
    };
    vi.spyOn(apiClient, 'fetchFindings').mockResolvedValue({
      items: [
        { ...baseFinding, status: EFindingStatus.VALID, testReason: null },
        { ...baseFinding, id: 2, status: EFindingStatus.FAILED, testReason: 'Skipped: matching AWS Secret Access Key is missing.' },
      ],
      total: 2,
    });
    vi.spyOn(apiClient, 'fetchMyRepoAuthorizations').mockResolvedValue([{ id: 1, userId: 1, owner: 'synthetic', name: 'repo', note: null, status: 'approved', adminNote: null, createdAt: '2026-09-22T10:00:00Z', decidedAt: null, decidedByUserId: null }]);
    render(<Dashboard />);
    expect(await screen.findByText('Stopping…')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Testing' }));
    expect(await screen.findByRole('button', { name: 'Test' })).toBeEnabled();
    for (const rescan of screen.getAllByRole('button', { name: 'Rescan' })) expect(rescan).toBeDisabled();

    fireEvent.click(screen.getByRole('tab', { name: 'My Repos' }));
    expect(await screen.findByRole('button', { name: 'Scan' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Submit request' })).toBeEnabled();
  });
});
