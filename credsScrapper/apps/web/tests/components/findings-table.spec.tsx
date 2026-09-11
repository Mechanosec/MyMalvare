import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FindingsTable } from '../../src/components/findings-table';
import * as apiClient from '../../src/lib/api-client';
import { ESecretType } from '../../src/lib/constant/secret-type.constant';
import { IFinding } from '../../src/lib/types/finding.type';

const finding: IFinding = {
  id: 1,
  repoId: 42,
  owner: 'octocat',
  name: 'hello-world',
  filePath: 'config.py',
  commitSha: 'abc123',
  secretType: ESecretType.AWS_ACCESS_KEY_ID,
  secretValue: 'AKIA...',
  lineNumber: 7,
  context: null,
  foundAt: '2026-09-12T00:00:00.000Z',
};

describe('FindingsTable', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the initial findings, then confirms them via a fetch with no filter', async () => {
    const fetchFindings = vi.spyOn(apiClient, 'fetchFindings').mockResolvedValue([finding]);
    render(<FindingsTable initialFindings={[finding]} refreshKey={0} />);

    expect(screen.getByText('octocat/hello-world')).toBeInTheDocument();
    await vi.waitFor(() => expect(fetchFindings).toHaveBeenCalledWith({ secretType: undefined }));
  });

  it('re-fetches with the selected secretType when the filter changes', async () => {
    const fetchFindings = vi.spyOn(apiClient, 'fetchFindings').mockResolvedValue([finding]);
    render(<FindingsTable initialFindings={[]} refreshKey={0} />);

    fireEvent.change(screen.getByLabelText('Secret type'), {
      target: { value: ESecretType.GITHUB_PAT },
    });

    await vi.waitFor(() =>
      expect(fetchFindings).toHaveBeenLastCalledWith({ secretType: ESecretType.GITHUB_PAT }),
    );
  });

  it('shows an empty state when there are no findings', () => {
    vi.spyOn(apiClient, 'fetchFindings').mockResolvedValue([]);
    render(<FindingsTable initialFindings={[]} refreshKey={0} />);
    expect(screen.getByText('No findings match this filter.')).toBeInTheDocument();
  });
});
