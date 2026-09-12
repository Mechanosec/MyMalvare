import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as apiClient from '../lib/api-client';
import { AdminPanel } from './admin-panel';

describe('AdminPanel', () => {
  beforeEach(() => {
    vi.spyOn(apiClient, 'fetchAllRepoAuthorizations').mockResolvedValue([
      { id: 1, userId: 1, owner: 'acme', name: 'widgets', note: 'please check', status: 'pending', adminNote: null, createdAt: '2026-01-01T00:00:00Z', decidedAt: null, decidedByUserId: null },
    ]);
    vi.spyOn(apiClient, 'decideRepoAuthorization').mockResolvedValue({
      id: 1, userId: 1, owner: 'acme', name: 'widgets', note: 'please check', status: 'approved', adminNote: null, createdAt: '2026-01-01T00:00:00Z', decidedAt: '2026-01-02T00:00:00Z', decidedByUserId: 2,
    });
  });

  it('lists pending requests and approves one', async () => {
    render(<AdminPanel />);

    await waitFor(() => expect(screen.getByText('widgets')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));

    await waitFor(() => expect(apiClient.decideRepoAuthorization).toHaveBeenCalledWith(1, 'approved', undefined));
  });
});
