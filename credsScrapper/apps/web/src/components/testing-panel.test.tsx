import { EJobStatus } from '../lib/constant/job-status.constant';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as apiClient from '../lib/api-client';
import { EFindingStatus } from '../lib/constant/finding-status.constant';
import { ESecretType, TESTABLE_SECRET_TYPES } from '../lib/constant/secret-type.constant';
import { TestingPanel } from './testing-panel';

const testedFinding = {
  id: 10,
  repoId: 1,
  owner: 'acme',
  name: 'widgets',
  filePath: 'src/config.ts',
  commitSha: 'abc',
  secretType: ESecretType.GITHUB_PAT,
  secretValue: 'ghp_fake',
  lineNumber: 3,
  context: null,
  foundAt: '2026-01-01T00:00:00Z',
  status: EFindingStatus.VALID,
  checkedAt: '2026-01-02T00:00:00Z',
  leakCommits: ['abc'],
};

describe('TestingPanel (regular user, scoped to own approved repos)', () => {
  beforeEach(() => {
    vi.spyOn(apiClient, 'fetchMyTestableRepos').mockResolvedValue([
      { repoId: 1, owner: 'acme', name: 'widgets', count: 1, validCount: 1, invalidCount: 0, unknownCount: 0 },
    ]);
    vi.spyOn(apiClient, 'fetchMyFindings').mockResolvedValue({
      items: [{ ...testedFinding, status: EFindingStatus.UNKNOWN, checkedAt: null }],
      total: 1,
    });
    vi.spyOn(apiClient, 'fetchMySecretTypeCounts').mockResolvedValue([
      { secretType: ESecretType.GITHUB_PAT, count: 1 },
      { secretType: ESecretType.SLACK_TOKEN, count: 0 },
    ]);
    vi.spyOn(apiClient, 'fetchMyStatusCounts').mockResolvedValue([
      { status: EFindingStatus.UNKNOWN, count: 1 },
      { status: EFindingStatus.VALID, count: 0 },
      { status: EFindingStatus.INVALID, count: 0 },
    ]);
  });

  it('searches inside the dropdown and selects a repository with the keyboard', async () => {
    render(<TestingPanel isAdmin={false} />);
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Repository'));
    const search = screen.getByRole('combobox', { name: 'Search repositories' });
    expect(search).toHaveFocus();
    fireEvent.change(search, { target: { value: ' WIDGETS ' } });
    await screen.findByRole('option', { name: /acme\/widgets/ });
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Repository')).toHaveTextContent('acme/widgets');
    fireEvent.click(screen.getByLabelText('Repository'));
    const selectedOption = screen.getByRole('option', { name: /acme\/widgets/ });
    expect(selectedOption).toHaveAttribute('aria-selected', 'true');
    expect(selectedOption).toHaveClass('bg-accent/15');
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'no-match' } });
    expect(screen.getByText('No matching repositories.')).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' });
    expect(screen.getByLabelText('Repository')).toHaveFocus();
    expect(screen.getByLabelText('Repository')).toHaveTextContent('acme/widgets');
  });

  it("shows each secret type's count for the selected repo", async () => {
    render(<TestingPanel isAdmin={false} />);

    fireEvent.click(await screen.findByLabelText('Repository'));
    fireEvent.click(await screen.findByRole('option', { name: /acme\/widgets/ }));

    await waitFor(() => expect(apiClient.fetchMySecretTypeCounts).toHaveBeenCalledWith(1));
    fireEvent.click(screen.getByLabelText('Secret type'));

    const listbox = screen.getByRole('listbox');
    expect(within(listbox).getByText('github pat').closest('label')).toHaveTextContent('1');
    expect(within(listbox).getByText('slack token').closest('label')).toHaveTextContent('0');
  });

  it("shows each status's count (valid/invalid/unknown) for the selected repo", async () => {
    render(<TestingPanel isAdmin={false} />);

    fireEvent.click(await screen.findByLabelText('Repository'));
    fireEvent.click(await screen.findByRole('option', { name: /acme\/widgets/ }));

    await waitFor(() =>
      expect(apiClient.fetchMyStatusCounts).toHaveBeenCalledWith(1, [...TESTABLE_SECRET_TYPES]),
    );
    fireEvent.click(screen.getByLabelText('Status'));

    const listbox = screen.getByRole('listbox');
    expect(within(listbox).getByText(EFindingStatus.UNKNOWN).closest('label')).toHaveTextContent('1');
    expect(within(listbox).getByText(EFindingStatus.VALID).closest('label')).toHaveTextContent('0');
    expect(within(listbox).getByText(EFindingStatus.INVALID).closest('label')).toHaveTextContent('0');
  });

  it('only offers secret types with a live checker in the filter, not every detected type', async () => {
    render(<TestingPanel isAdmin={false} />);

    fireEvent.click(await screen.findByLabelText('Repository'));
    fireEvent.click(await screen.findByRole('option', { name: /acme\/widgets/ }));
    fireEvent.click(screen.getByLabelText('Secret type'));

    const listbox = screen.getByRole('listbox');
    expect(within(listbox).getAllByRole('checkbox')).toHaveLength(TESTABLE_SECRET_TYPES.length);
    expect(within(listbox).queryByText('generic high entropy')).not.toBeInTheDocument();
  });

  it('only lists repos with at least one testable-type finding, with a count scoped the same way', async () => {
    render(<TestingPanel isAdmin={false} />);

    await waitFor(() =>
      expect(apiClient.fetchMyTestableRepos).toHaveBeenCalledWith([...TESTABLE_SECRET_TYPES]),
    );
  });

  it('shows the valid/invalid/unknown breakdown right in the repository picker, not just the total', async () => {
    vi.spyOn(apiClient, 'fetchMyTestableRepos').mockResolvedValue([
      { repoId: 1, owner: 'acme', name: 'widgets', count: 4, validCount: 1, invalidCount: 2, unknownCount: 1 },
    ]);

    render(<TestingPanel isAdmin={false} />);
    fireEvent.click(screen.getByLabelText('Repository'));

    expect(
      await screen.findByRole('option', { name: 'acme/widgets (4: 1 valid, 2 invalid, 1 unknown)' }),
    ).toBeInTheDocument();
  });

  it('shows a skipped reason instead of claiming a successful test', async () => {
    vi.spyOn(apiClient, 'testMyFinding').mockResolvedValue({ ...testedFinding, status: EFindingStatus.UNKNOWN, testReason: 'Skipped: matching AWS Secret Access Key is missing.' });
    render(<TestingPanel isAdmin={false} />);
    fireEvent.click(await screen.findByLabelText('Repository'));
    fireEvent.click(await screen.findByRole('option', { name: /acme\/widgets/ }));
    fireEvent.click(screen.getByText('Load keys'));
    await screen.findByText('src/config.ts');
    fireEvent.click(screen.getByRole('button', { name: 'Test' }));
    expect(await screen.findByText('Skipped: matching AWS Secret Access Key is missing.')).toBeInTheDocument();
    expect(screen.queryByText(/Tested .* valid/)).not.toBeInTheDocument();
    const scan = vi.spyOn(apiClient, 'scanMyRepo').mockResolvedValue({ repoId: 1, jobId: '42' });
    vi.mocked(apiClient.testMyFinding).mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Rescan' }));
    expect(await screen.findByText(/Rescan queued.*job 42/)).toBeInTheDocument();
    expect(scan).toHaveBeenCalledWith('acme', 'widgets', testedFinding.secretType);
    expect(apiClient.testMyFinding).not.toHaveBeenCalled();
  });

  it('shows the saved reason when findings are loaded again', async () => {
    vi.mocked(apiClient.fetchMyFindings).mockResolvedValue({
      items: [{ ...testedFinding, status: EFindingStatus.UNKNOWN, testReason: 'Skipped: GCP credentials are not valid JSON.' }], total: 1,
    });
    render(<TestingPanel isAdmin={false} />);
    fireEvent.click(await screen.findByLabelText('Repository'));
    fireEvent.click(await screen.findByRole('option', { name: /acme\/widgets/ }));
    fireEvent.click(screen.getByText('Load keys'));
    expect(await screen.findByText('Skipped: GCP credentials are not valid JSON.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rescan' })).toBeInTheDocument();
  });

  it('explains a denied rescan without treating it as an API outage', async () => {
    vi.mocked(apiClient.fetchMyFindings).mockResolvedValue({
      items: [{ ...testedFinding, status: EFindingStatus.UNKNOWN, testReason: 'Skipped: matching AWS Secret Access Key is missing.' }], total: 1,
    });
    vi.spyOn(apiClient, 'scanMyRepo').mockRejectedValue(new Error('POST /repo-authorizations/mine/scan-repo failed: 403'));
    render(<TestingPanel isAdmin={false} />);
    fireEvent.click(await screen.findByLabelText('Repository'));
    fireEvent.click(await screen.findByRole('option', { name: /acme\/widgets/ }));
    fireEvent.click(screen.getByText('Load keys'));
    fireEvent.click(await screen.findByRole('button', { name: 'Rescan' }));
    expect(await screen.findByText(/Your account has no approved authorization/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rescan' })).toBeEnabled();
  });

  it('offers service rescan for previously valid keys too', async () => {
    vi.mocked(apiClient.fetchMyFindings).mockResolvedValue({ items: [testedFinding], total: 1 });
    vi.spyOn(apiClient, 'scanMyRepo').mockResolvedValue({ repoId: 1, jobId: '42' });
    render(<TestingPanel isAdmin={false} />);
    fireEvent.click(await screen.findByLabelText('Repository'));
    fireEvent.click(await screen.findByRole('option', { name: /acme\/widgets/ }));
    fireEvent.click(screen.getByText('Load keys'));
    fireEvent.click(await screen.findByRole('button', { name: 'Rescan' }));
    await waitFor(() => expect(apiClient.scanMyRepo).toHaveBeenCalledWith('acme', 'widgets', ESecretType.GITHUB_PAT));
    expect(screen.getByRole('button', { name: 'Test' })).toBeInTheDocument();
  });

  it('reloads findings and counters after rescan completes without Load keys', async () => {
    const reason = 'Skipped: matching AWS Secret Access Key is missing.';
    vi.mocked(apiClient.fetchMyFindings)
      .mockResolvedValueOnce({ items: [{ ...testedFinding, status: EFindingStatus.UNKNOWN, testReason: reason }], total: 1 })
      .mockResolvedValue({ items: [{ ...testedFinding, status: EFindingStatus.UNKNOWN, testReason: null, checkedAt: null }], total: 1 });
    vi.spyOn(apiClient, 'scanMyRepo').mockResolvedValue({ repoId: 1, jobId: '42' });
    vi.spyOn(apiClient, 'fetchJob').mockResolvedValue({
      id: '42', status: EJobStatus.DONE, message: 'finished', processed: 1,
      log: [{ jobId: '42', status: EJobStatus.DONE, message: 'finished' }],
    });
    render(<TestingPanel isAdmin={false} />);
    fireEvent.click(await screen.findByLabelText('Repository'));
    fireEvent.click(await screen.findByRole('option', { name: /acme\/widgets/ }));
    fireEvent.click(screen.getByText('Load keys'));
    fireEvent.click(await screen.findByRole('button', { name: 'Rescan' }));
    expect(await screen.findByRole('button', { name: 'Test' })).toBeInTheDocument();
    expect(screen.queryByText(reason)).not.toBeInTheDocument();
    expect(apiClient.fetchMyFindings).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(apiClient.fetchMyTestableRepos).toHaveBeenCalledTimes(2));
    expect(apiClient.fetchMySecretTypeCounts).toHaveBeenCalledTimes(2);
  });

  it('tests a single finding and shows the live result', async () => {
    vi.spyOn(apiClient, 'testMyFinding').mockResolvedValue(testedFinding);

    render(<TestingPanel isAdmin={false} />);

    fireEvent.click(await screen.findByLabelText('Repository'));
    fireEvent.click(await screen.findByRole('option', { name: /acme\/widgets/ }));
    fireEvent.click(screen.getByText('Load keys'));

    await waitFor(() => expect(screen.getByText('src/config.ts')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Test' }));

    await waitFor(() => expect(apiClient.testMyFinding).toHaveBeenCalledWith(10));
    expect(screen.getByText(/Check .* valid/)).toBeInTheDocument();
  });

  it('logs a failure and keeps the last-known status when the live test fails', async () => {
    vi.spyOn(apiClient, 'testMyFinding').mockRejectedValue(new Error('network error'));

    render(<TestingPanel isAdmin={false} />);

    fireEvent.click(await screen.findByLabelText('Repository'));
    fireEvent.click(await screen.findByRole('option', { name: /acme\/widgets/ }));
    fireEvent.click(screen.getByText('Load keys'));

    await waitFor(() => expect(screen.getByText('src/config.ts')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Test' }));

    await waitFor(() => expect(screen.getByText(/Failed to test/)).toBeInTheDocument());
    expect(screen.getByText('unknown')).toBeInTheDocument();
  });

  it('tests all findings for the selected repo', async () => {
    vi.spyOn(apiClient, 'testMyRepoFindings').mockResolvedValue([testedFinding]);

    render(<TestingPanel isAdmin={false} />);

    fireEvent.click(await screen.findByLabelText('Repository'));
    fireEvent.click(await screen.findByRole('option', { name: /acme\/widgets/ }));
    fireEvent.click(screen.getByText('Load keys'));

    await waitFor(() => expect(screen.getByText('src/config.ts')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Test all' }));

    await waitFor(() => expect(apiClient.testMyRepoFindings).toHaveBeenCalledWith(1));
    expect(screen.getByText(/Processed 1 finding/)).toBeInTheDocument();
  });

  it('tests only the checked findings via "Test selected"', async () => {
    vi.spyOn(apiClient, 'testMyFinding').mockResolvedValue(testedFinding);

    render(<TestingPanel isAdmin={false} />);

    fireEvent.click(await screen.findByLabelText('Repository'));
    fireEvent.click(await screen.findByRole('option', { name: /acme\/widgets/ }));
    fireEvent.click(screen.getByText('Load keys'));

    await waitFor(() => expect(screen.getByText('src/config.ts')).toBeInTheDocument());

    expect(screen.getByRole('button', { name: /Test selected/ })).toBeDisabled();
    fireEvent.click(screen.getByLabelText('Select github_pat in src/config.ts'));
    expect(screen.getByRole('button', { name: 'Test selected (1)' })).not.toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Test selected (1)' }));

    await waitFor(() => expect(apiClient.testMyFinding).toHaveBeenCalledWith(10));
    expect(screen.getByText(/Processed 1\/1 selected finding/)).toBeInTheDocument();
  });
});

describe('TestingPanel (admin, unscoped to any repo)', () => {
  beforeEach(() => {
    vi.spyOn(apiClient, 'fetchFindingsRepoOptions').mockResolvedValue([
      { repoId: 1, owner: 'acme', name: 'widgets', count: 1, validCount: 1, invalidCount: 0, unknownCount: 0 },
    ]);
    vi.spyOn(apiClient, 'fetchFindings').mockResolvedValue({
      items: [{ ...testedFinding, status: EFindingStatus.UNKNOWN, checkedAt: null }],
      total: 1,
    });
    vi.spyOn(apiClient, 'fetchFindingsSecretTypeCounts').mockResolvedValue([
      { secretType: ESecretType.GITHUB_PAT, count: 1 },
    ]);
    vi.spyOn(apiClient, 'fetchFindingsStatusCounts').mockResolvedValue([
      { status: EFindingStatus.UNKNOWN, count: 1 },
      { status: EFindingStatus.VALID, count: 0 },
      { status: EFindingStatus.INVALID, count: 0 },
    ]);
  });

  it('queues a service rescan through the admin endpoint without owner authorization', async () => {
    vi.spyOn(apiClient, 'startScanRepo').mockResolvedValue({ repoId: 1, jobId: '42' });
    const mine = vi.spyOn(apiClient, 'scanMyRepo');
    render(<TestingPanel isAdmin={true} />);
    fireEvent.click(await screen.findByLabelText('Repository'));
    fireEvent.click(await screen.findByRole('option', { name: /acme\/widgets/ }));
    fireEvent.click(screen.getByText('Load keys'));
    fireEvent.click(await screen.findByRole('button', { name: 'Rescan' }));
    await waitFor(() => expect(apiClient.startScanRepo).toHaveBeenCalledWith('acme', 'widgets', ESecretType.GITHUB_PAT));
    expect(mine).not.toHaveBeenCalled();
  });

  it('only lists repos with at least one testable-type finding, unscoped by admin ownership', async () => {
    render(<TestingPanel isAdmin={true} />);

    await waitFor(() =>
      expect(apiClient.fetchFindingsRepoOptions).toHaveBeenCalledWith(undefined, [...TESTABLE_SECRET_TYPES]),
    );
  });

  it('loads any repo (not just the admin\'s own), scoped to testable secret types, and tests all its findings', async () => {
    vi.spyOn(apiClient, 'adminTestRepoFindings').mockResolvedValue([testedFinding]);

    render(<TestingPanel isAdmin={true} />);

    fireEvent.click(await screen.findByLabelText('Repository'));
    fireEvent.click(await screen.findByRole('option', { name: /acme\/widgets/ }));
    fireEvent.click(screen.getByText('Load keys'));

    await waitFor(() =>
      expect(apiClient.fetchFindings).toHaveBeenCalledWith({
        repoIds: [1],
        secretTypes: [...TESTABLE_SECRET_TYPES],
        statuses: undefined,
        limit: 50,
        offset: 0,
      }),
    );
    await waitFor(() => expect(screen.getByText('src/config.ts')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Test all' }));

    await waitFor(() => expect(apiClient.adminTestRepoFindings).toHaveBeenCalledWith(1));
    expect(screen.getByText(/Processed 1 finding/)).toBeInTheDocument();
  });

  it('tests a single finding via the admin endpoint', async () => {
    vi.spyOn(apiClient, 'adminTestFinding').mockResolvedValue(testedFinding);

    render(<TestingPanel isAdmin={true} />);

    fireEvent.click(await screen.findByLabelText('Repository'));
    fireEvent.click(await screen.findByRole('option', { name: /acme\/widgets/ }));
    fireEvent.click(screen.getByText('Load keys'));

    await waitFor(() => expect(screen.getByText('src/config.ts')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Test' }));

    await waitFor(() => expect(apiClient.adminTestFinding).toHaveBeenCalledWith(10));
    expect(screen.getByText(/Check .* valid/)).toBeInTheDocument();
  });

  it('does not fetch just from picking a secret type - only once "Load keys" is clicked', async () => {
    render(<TestingPanel isAdmin={true} />);

    fireEvent.click(await screen.findByLabelText('Repository'));
    fireEvent.click(await screen.findByRole('option', { name: /acme\/widgets/ }));
    await waitFor(() => expect(apiClient.fetchFindingsSecretTypeCounts).toHaveBeenCalledWith(1));

    fireEvent.click(screen.getByLabelText('Secret type'));
    fireEvent.click(within(screen.getByRole('listbox')).getByText(ESecretType.GITHUB_PAT.replace(/_/g, ' ')));

    expect(apiClient.fetchFindings).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Load keys'));

    await waitFor(() =>
      expect(apiClient.fetchFindings).toHaveBeenCalledWith({
        repoIds: [1],
        secretTypes: [ESecretType.GITHUB_PAT],
        statuses: undefined,
        limit: 50,
        offset: 0,
      }),
    );
  });
});
