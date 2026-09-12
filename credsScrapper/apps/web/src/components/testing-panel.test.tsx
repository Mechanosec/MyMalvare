import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as apiClient from '../lib/api-client';
import { EFindingStatus } from '../lib/constant/finding-status.constant';
import { ESecretType } from '../lib/constant/secret-type.constant';
import { TestingPanel } from './testing-panel';

describe('TestingPanel', () => {
  beforeEach(() => {
    vi.spyOn(apiClient, 'fetchFindingsRepoOptions').mockResolvedValue([
      { repoId: 1, owner: 'acme', name: 'widgets', count: 1 },
    ]);
    vi.spyOn(apiClient, 'fetchFindings').mockResolvedValue({
      items: [
        {
          id: 10,
          repoId: 1,
          owner: 'acme',
          name: 'widgets',
          filePath: 'src/config.ts',
          commitSha: 'abc',
          secretType: ESecretType.AWS_ACCESS_KEY_ID,
          secretValue: 'AKIAABCDEFGH12345678',
          lineNumber: 3,
          context: null,
          foundAt: '2026-01-01T00:00:00Z',
          status: EFindingStatus.UNKNOWN,
          leakCommits: ['abc'],
        },
      ],
      total: 1,
    });
    vi.spyOn(apiClient, 'updateFindingStatus').mockResolvedValue({ ok: true });
  });

  it('loads a repo worklist and logs a marked verdict', async () => {
    render(<TestingPanel />);

    fireEvent.change(await screen.findByLabelText('Repository'), { target: { value: '1' } });
    fireEvent.click(screen.getByText('Load keys'));

    await waitFor(() => expect(screen.getByText('src/config.ts')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Valid' }));

    await waitFor(() =>
      expect(apiClient.updateFindingStatus).toHaveBeenCalledWith(10, EFindingStatus.VALID),
    );
    expect(screen.getByText(/marked valid/)).toBeInTheDocument();
  });

  it('logs a failure and keeps the last-known status when the PATCH rejects', async () => {
    vi.spyOn(apiClient, 'updateFindingStatus').mockRejectedValue(new Error('network error'));

    render(<TestingPanel />);

    fireEvent.change(await screen.findByLabelText('Repository'), { target: { value: '1' } });
    fireEvent.click(screen.getByText('Load keys'));

    await waitFor(() => expect(screen.getByText('src/config.ts')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Valid' }));

    await waitFor(() =>
      expect(screen.getByText(/Failed to mark .* as valid/)).toBeInTheDocument(),
    );
    expect(screen.getByText('unknown')).toBeInTheDocument();
  });
});
