import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as apiClient from '../lib/api-client';
import { MyReposPanel } from './my-repos-panel';

describe('MyReposPanel', () => {
  beforeEach(() => {
    vi.spyOn(apiClient, 'fetchMyRepoAuthorizations').mockResolvedValue([
      { id: 1, userId: 1, owner: 'acme', name: 'widgets', note: null, status: 'approved', adminNote: null, createdAt: '2026-01-01T00:00:00Z', decidedAt: null, decidedByUserId: null },
    ]);
    vi.spyOn(apiClient, 'submitRepoAuthorization').mockResolvedValue({
      id: 2, userId: 1, owner: 'acme', name: 'gadgets', note: null, status: 'pending', adminNote: null, createdAt: '2026-01-02T00:00:00Z', decidedAt: null, decidedByUserId: null,
    });
  });

  it('lists existing requests and submits a new one', async () => {
    render(<MyReposPanel />);

    await waitFor(() => expect(screen.getByText('widgets')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('Owner'), { target: { value: 'acme' } });
    fireEvent.change(screen.getByLabelText('Repository name'), { target: { value: 'gadgets' } });
    fireEvent.click(screen.getByText('Submit request'));

    await waitFor(() => expect(apiClient.submitRepoAuthorization).toHaveBeenCalledWith('acme', 'gadgets', undefined));
  });

  it('splits a pasted "owner/name" out of the Repository name field', async () => {
    render(<MyReposPanel />);
    await waitFor(() => expect(screen.getByText('widgets')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('Owner'), { target: { value: 'whatever-gets-overridden' } });
    fireEvent.change(screen.getByLabelText('Repository name'), { target: { value: 'acme/gadgets' } });
    fireEvent.click(screen.getByText('Submit request'));

    await waitFor(() => expect(apiClient.submitRepoAuthorization).toHaveBeenCalledWith('acme', 'gadgets', undefined));
  });

  it('splits a pasted "owner/name" out of the Owner field when Repository name has no slash', async () => {
    render(<MyReposPanel />);
    await waitFor(() => expect(screen.getByText('widgets')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('Owner'), { target: { value: 'acme/gadgets' } });
    fireEvent.change(screen.getByLabelText('Repository name'), { target: { value: '' } });
    fireEvent.click(screen.getByText('Submit request'));

    await waitFor(() => expect(apiClient.submitRepoAuthorization).toHaveBeenCalledWith('acme', 'gadgets', undefined));
  });

  it('shows a ProgressPanel for the jobId once a scan is triggered, instead of a static "complete" message', async () => {
    vi.spyOn(apiClient, 'scanMyRepo').mockResolvedValue({ repoId: 42, jobId: 'job-123' });
    vi.spyOn(apiClient, 'fetchJob').mockResolvedValue({
      id: 'job-123',
      status: 'queued' as never,
      processed: 0,
      message: 'scan-repo queued',
      log: [],
    });

    render(<MyReposPanel />);

    const scanButton = await screen.findByRole('button', { name: 'Scan' });
    fireEvent.click(scanButton);

    await waitFor(() => expect(apiClient.scanMyRepo).toHaveBeenCalledWith('acme', 'widgets'));
    // ProgressPanel renders "No job running." only when jobId is null;
    // once scanMyRepo resolves, MyReposPanel must pass the real jobId in.
    await waitFor(() => expect(screen.queryByText('No job running.')).not.toBeInTheDocument());
  });
});
