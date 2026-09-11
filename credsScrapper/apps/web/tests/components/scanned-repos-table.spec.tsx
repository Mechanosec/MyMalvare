import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ScannedReposTable } from '../../src/components/scanned-repos-table';
import * as apiClient from '../../src/lib/api-client';
import { EScanStatus } from '../../src/lib/constant/scan-status.constant';
import { IScannedRepo } from '../../src/lib/types/scanned-repo.type';

const repo: IScannedRepo = {
  repoId: 42,
  owner: 'octocat',
  name: 'hello-world',
  status: EScanStatus.DONE,
  lastCommitSha: 'abc123def456',
  startedAt: '2026-09-12T00:00:00.000Z',
  scannedAt: '2026-09-12T00:01:00.000Z',
  failReason: null,
  retryCount: 0,
  findingsCount: 3,
};

describe('ScannedReposTable', () => {
  it('renders the initial repos without re-fetching on mount', () => {
    const fetchScannedRepos = vi.spyOn(apiClient, 'fetchScannedRepos');
    render(<ScannedReposTable initialRepos={[repo]} refreshKey={0} />);

    expect(screen.getByText('octocat/hello-world')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(fetchScannedRepos).not.toHaveBeenCalled();
  });

  it('re-fetches when refreshKey advances past its initial value', async () => {
    const fetchScannedRepos = vi.spyOn(apiClient, 'fetchScannedRepos').mockResolvedValue([repo]);
    render(<ScannedReposTable initialRepos={[]} refreshKey={1} />);

    await vi.waitFor(() => expect(fetchScannedRepos).toHaveBeenCalled());
  });

  it('shows an empty state when nothing has been scanned', () => {
    render(<ScannedReposTable initialRepos={[]} refreshKey={0} />);
    expect(screen.getByText('Nothing scanned yet — run Discover, then Scan.')).toBeInTheDocument();
  });
});
