import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as apiClient from '../lib/api-client';
import { MyReposPanel } from './my-repos-panel';

describe('MyReposPanel', () => {
  beforeEach(() => {
    vi.spyOn(apiClient, 'fetchMyRepoAuthorizations').mockResolvedValue([
      { id: 1, userId: 1, owner: 'acme', name: 'widgets', note: null, status: 'pending', adminNote: null, createdAt: '2026-01-01T00:00:00Z', decidedAt: null, decidedByUserId: null },
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
});
