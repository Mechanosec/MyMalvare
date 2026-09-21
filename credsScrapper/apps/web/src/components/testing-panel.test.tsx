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
    vi.spyOn(apiClient, 'fetchMyTestingFacets').mockResolvedValue({
      repositories: [{ repoId: 1, owner: 'acme', name: 'widgets', count: 1, validCount: 0, invalidCount: 0, unknownCount: 1 }],
      statuses: [
        { status: EFindingStatus.UNKNOWN, count: 1 },
        { status: EFindingStatus.VALID, count: 0 },
        { status: EFindingStatus.INVALID, count: 0 },
      ],
      secretTypes: [{ secretType: ESecretType.GITHUB_PAT, count: 1 }],
    });
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

  it('shows loading instead of a false empty state before the initial requests finish', () => {
    vi.mocked(apiClient.fetchMyTestingFacets).mockImplementation(() => new Promise(() => {}));
    vi.mocked(apiClient.fetchMyFindings).mockImplementation(() => new Promise(() => {}));
    render(<TestingPanel isAdmin={false} />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(screen.queryByText('No findings match these filters.')).not.toBeInTheDocument();
    expect(screen.getByText('Updating filters…')).toBeInTheDocument();
  });

  it('lets the user choose unknown before a repository and then narrows the repository picker', async () => {
    vi.mocked(apiClient.fetchMyTestingFacets).mockImplementation(async (query) => ({
      repositories: query.status === EFindingStatus.UNKNOWN
        ? [{ repoId: 1, owner: 'acme', name: 'untested', count: 3, validCount: 0, invalidCount: 0, unknownCount: 3 }]
        : [
          { repoId: 1, owner: 'acme', name: 'untested', count: 3, validCount: 0, invalidCount: 0, unknownCount: 3 },
          { repoId: 2, owner: 'acme', name: 'tested', count: 2, validCount: 2, invalidCount: 0, unknownCount: 0 },
        ],
      statuses: [
        { status: EFindingStatus.UNKNOWN, count: 3 },
        { status: EFindingStatus.VALID, count: 2 },
        { status: EFindingStatus.INVALID, count: 0 },
      ],
      secretTypes: [{ secretType: ESecretType.GITHUB_PAT, count: 3 }],
    }));
    render(<TestingPanel isAdmin={false} />);
    const group = await screen.findByRole('group', { name: 'Finding status' });
    fireEvent.click(await within(group).findByRole('button', { name: 'unknown 3' }));

    await waitFor(() => expect(apiClient.fetchMyFindings).toHaveBeenLastCalledWith({
      repoIds: undefined, secretTypes: [...TESTABLE_SECRET_TYPES], statuses: [EFindingStatus.UNKNOWN], limit: 50, offset: 0,
    }));
    fireEvent.click(screen.getByLabelText('Repository'));
    expect(screen.getByRole('option', { name: /acme\/untested/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /acme\/tested/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('option', { name: /acme\/untested/ }));
    await waitFor(() => expect(apiClient.fetchMyFindings).toHaveBeenLastCalledWith({
      repoIds: [1], secretTypes: [...TESTABLE_SECRET_TYPES], statuses: [EFindingStatus.UNKNOWN], limit: 50, offset: 0,
    }));
  });

  it('cross-filters repository, status, and secret type in either order', async () => {
    const repoOne = { repoId: 1, owner: 'acme', name: 'one', count: 2, validCount: 1, invalidCount: 0, unknownCount: 1 };
    const repoTwo = { repoId: 2, owner: 'acme', name: 'two', count: 1, validCount: 0, invalidCount: 0, unknownCount: 1 };
    vi.mocked(apiClient.fetchMyTestingFacets).mockImplementation(async (query) => ({
      repositories: query.secretTypes.length ? [repoOne] : [repoOne, repoTwo],
      statuses: query.secretTypes.length
        ? [{ status: EFindingStatus.UNKNOWN, count: 1 }, { status: EFindingStatus.VALID, count: 0 }, { status: EFindingStatus.INVALID, count: 0 }]
        : [{ status: EFindingStatus.UNKNOWN, count: 2 }, { status: EFindingStatus.VALID, count: 1 }, { status: EFindingStatus.INVALID, count: 0 }],
      secretTypes: [
        { secretType: ESecretType.GITHUB_PAT, count: 1 },
        { secretType: ESecretType.SLACK_TOKEN, count: query.repoId === 1 && query.status === EFindingStatus.UNKNOWN ? 0 : 1 },
      ],
    }));
    render(<TestingPanel isAdmin={false} />);
    await waitFor(() => expect(screen.getByLabelText('Repository')).toBeEnabled());
    fireEvent.click(screen.getByLabelText('Secret type'));
    fireEvent.click(within(screen.getByRole('listbox')).getByText('github pat'));
    fireEvent.mouseDown(document.body);

    await waitFor(() => expect(apiClient.fetchMyTestingFacets).toHaveBeenLastCalledWith({
      repoId: null, status: null, secretTypes: [ESecretType.GITHUB_PAT], testableTypes: TESTABLE_SECRET_TYPES,
    }));
    expect(within(screen.getByRole('group', { name: 'Finding status' })).getByRole('button', { name: 'valid 0' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('Repository')).toBeEnabled());
    fireEvent.click(screen.getByLabelText('Repository'));
    expect(screen.getByRole('option', { name: /acme\/one/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /acme\/two/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('option', { name: /acme\/one/ }));
    fireEvent.click(await within(screen.getByRole('group', { name: 'Finding status' })).findByRole('button', { name: 'unknown 1' }));

    await waitFor(() => expect(apiClient.fetchMyTestingFacets).toHaveBeenLastCalledWith({
      repoId: 1, status: EFindingStatus.UNKNOWN, secretTypes: [ESecretType.GITHUB_PAT], testableTypes: TESTABLE_SECRET_TYPES,
    }));
    fireEvent.click(screen.getByLabelText('Secret type'));
    expect(within(screen.getByRole('listbox')).getByText('slack token').closest('label')).toHaveTextContent('0');
  });

  it('does not offer every secret type while facets refresh after unchecking a type', async () => {
    const facets = {
      repositories: [{ repoId: 1, owner: 'acme', name: 'widgets', count: 1, validCount: 0, invalidCount: 0, unknownCount: 1 }],
      statuses: [{ status: EFindingStatus.UNKNOWN, count: 1 }],
      secretTypes: [{ secretType: ESecretType.GITHUB_PAT, count: 1 }, { secretType: ESecretType.SLACK_TOKEN, count: 1 }],
    };
    let finishRefresh!: (value: typeof facets) => void;
    vi.mocked(apiClient.fetchMyTestingFacets)
      .mockResolvedValueOnce(facets)
      .mockResolvedValueOnce(facets)
      .mockImplementationOnce(() => new Promise((resolve) => { finishRefresh = resolve; }));
    render(<TestingPanel isAdmin={false} />);
    await waitFor(() => expect(screen.getByLabelText('Repository')).toBeEnabled());
    fireEvent.click(screen.getByLabelText('Secret type'));
    const listbox = screen.getByRole('listbox');
    fireEvent.click(within(listbox).getByText('github pat'));
    await waitFor(() => expect(within(listbox).getByText('slack token').closest('label')).toHaveTextContent('1'));
    fireEvent.click(within(listbox).getByText('github pat'));
    await waitFor(() => expect(apiClient.fetchMyTestingFacets).toHaveBeenCalledTimes(3));

    expect(within(listbox).getByText('slack token').closest('label')?.querySelector('input')).toBeDisabled();
    expect(within(listbox).getByText('github pat').closest('label')?.querySelector('input')).toBeDisabled();

    finishRefresh(facets);
    await waitFor(() => expect(within(listbox).getByText('slack token').closest('label')?.querySelector('input')).toBeEnabled());
  });

  it('explains unavailable options when facet loading fails', async () => {
    vi.mocked(apiClient.fetchMyTestingFacets).mockRejectedValue(new Error('offline'));
    render(<TestingPanel isAdmin={false} />);
    expect(await screen.findByText(/Could not load filters/)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Secret type'));
    expect(within(screen.getByRole('listbox')).getByText('Options unavailable. Retry filters.')).toBeInTheDocument();
    expect(within(screen.getByRole('listbox')).getByText('github pat').closest('label')?.querySelector('input')).toBeDisabled();
  });

  it('keeps the previous results visible but inert while the new filter loads', async () => {
    let finishLoad!: (value: { items: typeof testedFinding[]; total: number }) => void;
    vi.mocked(apiClient.fetchMyFindings)
      .mockResolvedValueOnce({ items: [testedFinding], total: 1 })
      .mockImplementationOnce(() => new Promise((resolve) => { finishLoad = resolve; }));
    render(<TestingPanel isAdmin={false} />);
    await screen.findByText('src/config.ts');
    fireEvent.click(within(screen.getByRole('group', { name: 'Finding status' })).getByRole('button', { name: 'unknown 1' }));
    await waitFor(() => expect(apiClient.fetchMyFindings).toHaveBeenCalledTimes(2));
    expect(screen.getByText('src/config.ts')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Test' })).toBeDisabled();
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    finishLoad({ items: [], total: 0 });
    expect(await screen.findByText('No findings match these filters.')).toBeInTheDocument();
    expect(screen.queryByText('src/config.ts')).not.toBeInTheDocument();
  });

  it('lists secret types with findings before zero-count types', async () => {
    vi.mocked(apiClient.fetchMyTestingFacets).mockResolvedValue({
      repositories: [], statuses: [],
      secretTypes: [
        { secretType: ESecretType.DISCORD_WEBHOOK_URL, count: 4 },
        { secretType: ESecretType.GITHUB_PAT, count: 2 },
      ],
    });
    render(<TestingPanel isAdmin={false} />);
    await waitFor(() => expect(screen.getByLabelText('Repository')).toBeEnabled());
    fireEvent.click(screen.getByLabelText('Secret type'));
    const labels = within(screen.getByRole('listbox')).getAllByRole('checkbox').map((checkbox) => checkbox.closest('label')?.textContent);
    expect(labels.slice(0, 2)).toEqual(['discord webhook url4', 'github pat2']);
    expect(labels.findIndex((label) => label?.startsWith('anthropic api key'))).toBeGreaterThan(1);
  });

  it('searches inside the dropdown and selects a repository with the keyboard', async () => {
    render(<TestingPanel isAdmin={false} />);
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('Repository')).toBeEnabled());
    fireEvent.click(screen.getByLabelText('Repository'));
    const search = screen.getByRole('combobox', { name: 'Search repositories' });
    expect(search).toHaveFocus();
    fireEvent.change(search, { target: { value: ' WIDGETS ' } });
    await screen.findByRole('option', { name: /acme\/widgets/ });
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Repository')).toHaveTextContent('acme/widgets');
    await waitFor(() => expect(screen.getByLabelText('Repository')).toBeEnabled());
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

    await waitFor(() => expect(screen.getByLabelText('Repository')).toBeEnabled());
    fireEvent.click(screen.getByLabelText('Repository'));
    fireEvent.click(await screen.findByRole('option', { name: /acme\/widgets/ }));

    await waitFor(() => expect(apiClient.fetchMyTestingFacets).toHaveBeenCalledWith({
      repoId: 1, status: null, secretTypes: [], testableTypes: TESTABLE_SECRET_TYPES,
    }));
    fireEvent.click(screen.getByLabelText('Secret type'));

    const listbox = screen.getByRole('listbox');
    expect(within(listbox).getByText('github pat').closest('label')).toHaveTextContent('1');
    expect(within(listbox).getByText('slack token').closest('label')).toHaveTextContent('0');
  });

  it("shows status counts and filters findings immediately", async () => {
    render(<TestingPanel isAdmin={false} />);

    await waitFor(() => expect(screen.getByLabelText('Repository')).toBeEnabled());
    fireEvent.click(screen.getByLabelText('Repository'));
    fireEvent.click(await screen.findByRole('option', { name: /acme\/widgets/ }));

    await waitFor(() => expect(apiClient.fetchMyTestingFacets).toHaveBeenCalledWith({
      repoId: 1, status: null, secretTypes: [], testableTypes: TESTABLE_SECRET_TYPES,
    }));
    const group = screen.getByRole('group', { name: 'Finding status' });
    expect(within(group).getByRole('button', { name: 'unknown 1' })).toBeInTheDocument();
    expect(within(group).getByRole('button', { name: 'valid 0' })).toBeInTheDocument();
    fireEvent.click(within(group).getByRole('button', { name: 'unknown 1' }));
    await waitFor(() => expect(apiClient.fetchMyFindings).toHaveBeenLastCalledWith({
      repoIds: [1], secretTypes: [...TESTABLE_SECRET_TYPES], statuses: [EFindingStatus.UNKNOWN], limit: 50, offset: 0,
    }));
  });

  it('only offers secret types with a live checker in the filter, not every detected type', async () => {
    render(<TestingPanel isAdmin={false} />);

    await waitFor(() => expect(screen.getByLabelText('Repository')).toBeEnabled());
    fireEvent.click(screen.getByLabelText('Repository'));
    fireEvent.click(await screen.findByRole('option', { name: /acme\/widgets/ }));
    fireEvent.click(screen.getByLabelText('Secret type'));

    const listbox = screen.getByRole('listbox');
    expect(within(listbox).getAllByRole('checkbox')).toHaveLength(TESTABLE_SECRET_TYPES.length);
    expect(within(listbox).queryByText('generic high entropy')).not.toBeInTheDocument();
  });

  it('only lists repos with at least one testable-type finding, with a count scoped the same way', async () => {
    render(<TestingPanel isAdmin={false} />);

    await waitFor(() => expect(apiClient.fetchMyTestingFacets).toHaveBeenCalledWith({
      repoId: null, status: null, secretTypes: [], testableTypes: TESTABLE_SECRET_TYPES,
    }));
  });

  it('shows the valid/invalid/unknown breakdown right in the repository picker, not just the total', async () => {
    vi.mocked(apiClient.fetchMyTestingFacets).mockResolvedValue({
      repositories: [{ repoId: 1, owner: 'acme', name: 'widgets', count: 4, validCount: 1, invalidCount: 2, unknownCount: 1 }],
      statuses: [{ status: EFindingStatus.UNKNOWN, count: 1 }, { status: EFindingStatus.VALID, count: 1 }, { status: EFindingStatus.INVALID, count: 2 }],
      secretTypes: [{ secretType: ESecretType.GITHUB_PAT, count: 4 }],
    });

    render(<TestingPanel isAdmin={false} />);
    await waitFor(() => expect(screen.getByLabelText('Repository')).toBeEnabled());
    fireEvent.click(screen.getByLabelText('Repository'));

    expect(
      await screen.findByRole('option', { name: 'acme/widgets (4: 1 valid, 2 invalid, 1 unknown)' }),
    ).toBeInTheDocument();
  });

  it('shows a skipped reason instead of claiming a successful test', async () => {
    vi.spyOn(apiClient, 'testMyFinding').mockResolvedValue({ ...testedFinding, status: EFindingStatus.UNKNOWN, testReason: 'Skipped: matching AWS Secret Access Key is missing.' });
    render(<TestingPanel isAdmin={false} />);
    await waitFor(() => expect(screen.getByLabelText('Repository')).toBeEnabled());
    fireEvent.click(screen.getByLabelText('Repository'));
    fireEvent.click(await screen.findByRole('option', { name: /acme\/widgets/ }));
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
    await waitFor(() => expect(screen.getByLabelText('Repository')).toBeEnabled());
    fireEvent.click(screen.getByLabelText('Repository'));
    fireEvent.click(await screen.findByRole('option', { name: /acme\/widgets/ }));
    expect(await screen.findByText('Skipped: GCP credentials are not valid JSON.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rescan' })).toBeInTheDocument();
  });

  it('explains a denied rescan without treating it as an API outage', async () => {
    vi.mocked(apiClient.fetchMyFindings).mockResolvedValue({
      items: [{ ...testedFinding, status: EFindingStatus.UNKNOWN, testReason: 'Skipped: matching AWS Secret Access Key is missing.' }], total: 1,
    });
    vi.spyOn(apiClient, 'scanMyRepo').mockRejectedValue(new Error('POST /repo-authorizations/mine/scan-repo failed: 403'));
    render(<TestingPanel isAdmin={false} />);
    await waitFor(() => expect(screen.getByLabelText('Repository')).toBeEnabled());
    fireEvent.click(screen.getByLabelText('Repository'));
    fireEvent.click(await screen.findByRole('option', { name: /acme\/widgets/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Rescan' }));
    expect(await screen.findByText(/Your account has no approved authorization/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rescan' })).toBeEnabled();
  });

  it('offers service rescan for previously valid keys too', async () => {
    vi.mocked(apiClient.fetchMyFindings).mockResolvedValue({ items: [testedFinding], total: 1 });
    vi.spyOn(apiClient, 'scanMyRepo').mockResolvedValue({ repoId: 1, jobId: '42' });
    render(<TestingPanel isAdmin={false} />);
    await waitFor(() => expect(screen.getByLabelText('Repository')).toBeEnabled());
    fireEvent.click(screen.getByLabelText('Repository'));
    fireEvent.click(await screen.findByRole('option', { name: /acme\/widgets/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Rescan' }));
    await waitFor(() => expect(apiClient.scanMyRepo).toHaveBeenCalledWith('acme', 'widgets', ESecretType.GITHUB_PAT));
    expect(screen.getByRole('button', { name: 'Test' })).toBeInTheDocument();
  });

  it('reloads findings and counters after rescan completes without Load keys', async () => {
    const reason = 'Skipped: matching AWS Secret Access Key is missing.';
    vi.mocked(apiClient.fetchMyFindings)
      .mockResolvedValueOnce({ items: [{ ...testedFinding, status: EFindingStatus.UNKNOWN, testReason: reason }], total: 1 })
      .mockResolvedValueOnce({ items: [{ ...testedFinding, status: EFindingStatus.UNKNOWN, testReason: reason }], total: 1 })
      .mockResolvedValue({ items: [{ ...testedFinding, status: EFindingStatus.UNKNOWN, testReason: null, checkedAt: null }], total: 1 });
    vi.spyOn(apiClient, 'scanMyRepo').mockResolvedValue({ repoId: 1, jobId: '42' });
    vi.spyOn(apiClient, 'fetchJob').mockResolvedValue({
      id: '42', status: EJobStatus.DONE, message: 'finished', processed: 1,
      log: [{ jobId: '42', status: EJobStatus.DONE, message: 'finished' }],
    });
    render(<TestingPanel isAdmin={false} />);
    await waitFor(() => expect(screen.getByLabelText('Repository')).toBeEnabled());
    fireEvent.click(screen.getByLabelText('Repository'));
    fireEvent.click(await screen.findByRole('option', { name: /acme\/widgets/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Rescan' }));
    expect(await screen.findByRole('button', { name: 'Test' })).toBeInTheDocument();
    expect(screen.queryByText(reason)).not.toBeInTheDocument();
    expect(apiClient.fetchMyFindings).toHaveBeenCalledTimes(3);
    await waitFor(() => expect(apiClient.fetchMyTestingFacets).toHaveBeenCalledTimes(3));
  });

  it('tests a single finding and shows the live result', async () => {
    vi.spyOn(apiClient, 'testMyFinding').mockResolvedValue(testedFinding);

    render(<TestingPanel isAdmin={false} />);

    await waitFor(() => expect(screen.getByLabelText('Repository')).toBeEnabled());
    fireEvent.click(screen.getByLabelText('Repository'));
    fireEvent.click(await screen.findByRole('option', { name: /acme\/widgets/ }));

    await waitFor(() => expect(screen.getByText('src/config.ts')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Test' }));

    await waitFor(() => expect(apiClient.testMyFinding).toHaveBeenCalledWith(10));
    expect(screen.getByText(/Check .* valid/)).toBeInTheDocument();
  });

  it('shows the latest test feedback without accumulating previous test messages', async () => {
    vi.spyOn(apiClient, 'testMyFinding')
      .mockResolvedValueOnce(testedFinding)
      .mockResolvedValueOnce({ ...testedFinding, status: EFindingStatus.INVALID });
    render(<TestingPanel isAdmin={false} />);
    await screen.findByText('src/config.ts');
    fireEvent.click(screen.getByRole('button', { name: 'Test' }));
    expect(await screen.findByText(/Check .* valid/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Test' }));
    expect(await screen.findByText(/Check .* invalid/)).toBeInTheDocument();
    expect(screen.queryByText(/Check .* valid/)).not.toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('group', { name: 'Finding status' })).getByRole('button', { name: 'unknown 1' }));
    expect(screen.queryByText(/Check .* invalid/)).not.toBeInTheDocument();
  });

  it('logs a failure and keeps the last-known status when the live test fails', async () => {
    vi.spyOn(apiClient, 'testMyFinding').mockRejectedValue(new Error('network error'));

    render(<TestingPanel isAdmin={false} />);

    await waitFor(() => expect(screen.getByLabelText('Repository')).toBeEnabled());
    fireEvent.click(screen.getByLabelText('Repository'));
    fireEvent.click(await screen.findByRole('option', { name: /acme\/widgets/ }));

    await waitFor(() => expect(screen.getByText('src/config.ts')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Test' }));

    await waitFor(() => expect(screen.getByText(/Failed to test/)).toBeInTheDocument());
    expect(screen.getAllByText('unknown').length).toBeGreaterThan(0);
  });

  it('does not offer unfiltered bulk testing', async () => {
    render(<TestingPanel isAdmin={false} />);

    await waitFor(() => expect(screen.getByLabelText('Repository')).toBeEnabled());
    fireEvent.click(screen.getByLabelText('Repository'));
    fireEvent.click(await screen.findByRole('option', { name: /acme\/widgets/ }));

    await waitFor(() => expect(screen.getByText('src/config.ts')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Test all' })).not.toBeInTheDocument();
  });

  it('tests only the checked findings via "Test selected"', async () => {
    vi.spyOn(apiClient, 'testMyFinding').mockResolvedValue(testedFinding);

    render(<TestingPanel isAdmin={false} />);

    await waitFor(() => expect(screen.getByLabelText('Repository')).toBeEnabled());
    fireEvent.click(screen.getByLabelText('Repository'));
    fireEvent.click(await screen.findByRole('option', { name: /acme\/widgets/ }));

    await waitFor(() => expect(screen.getByText('src/config.ts')).toBeInTheDocument());

    expect(screen.getByRole('button', { name: /Test selected/ })).toBeDisabled();
    fireEvent.click(screen.getByLabelText('Select github_pat in src/config.ts'));
    expect(screen.getByRole('button', { name: 'Test selected (1)' })).not.toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Test selected (1)' }));

    await waitFor(() => expect(apiClient.testMyFinding).toHaveBeenCalledWith(10));
    expect(screen.getByText(/Processed 1\/1 selected finding/)).toBeInTheDocument();
  });

  it('uses server pagination beyond 1000 findings and resets to page one when status changes', async () => {
    vi.mocked(apiClient.fetchMyFindings).mockResolvedValue({ items: [testedFinding], total: 1500 });
    render(<TestingPanel isAdmin={false} />);
    await waitFor(() => expect(screen.getByLabelText('Repository')).toBeEnabled());
    fireEvent.click(screen.getByLabelText('Repository'));
    fireEvent.click(await screen.findByRole('option', { name: /acme\/widgets/ }));
    await screen.findByText('src/config.ts');

    fireEvent.click(screen.getAllByRole('button', { name: '30' })[0]);
    await waitFor(() => expect(apiClient.fetchMyFindings).toHaveBeenLastCalledWith({
      repoIds: [1], secretTypes: [...TESTABLE_SECRET_TYPES], statuses: undefined, limit: 50, offset: 1450,
    }));

    fireEvent.click(within(screen.getByRole('group', { name: 'Finding status' })).getByRole('button', { name: 'unknown 1' }));
    await waitFor(() => expect(apiClient.fetchMyFindings).toHaveBeenLastCalledWith({
      repoIds: [1], secretTypes: [...TESTABLE_SECRET_TYPES], statuses: [EFindingStatus.UNKNOWN], limit: 50, offset: 0,
    }));
  });

  it('reports a load failure rather than showing it as an empty result', async () => {
    vi.mocked(apiClient.fetchMyFindings).mockRejectedValue(new Error('offline'));
    render(<TestingPanel isAdmin={false} />);
    await waitFor(() => expect(screen.getByLabelText('Repository')).toBeEnabled());
    fireEvent.click(screen.getByLabelText('Repository'));
    fireEvent.click(await screen.findByRole('option', { name: /acme\/widgets/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load findings');
    expect(screen.queryByText('No findings match these filters.')).not.toBeInTheDocument();
  });
});

describe('TestingPanel (admin, unscoped to any repo)', () => {
  beforeEach(() => {
    vi.spyOn(apiClient, 'fetchTestingFacets').mockResolvedValue({
      repositories: [{ repoId: 1, owner: 'acme', name: 'widgets', count: 1, validCount: 0, invalidCount: 0, unknownCount: 1 }],
      statuses: [
        { status: EFindingStatus.UNKNOWN, count: 1 },
        { status: EFindingStatus.VALID, count: 0 },
        { status: EFindingStatus.INVALID, count: 0 },
      ],
      secretTypes: [{ secretType: ESecretType.GITHUB_PAT, count: 1 }],
    });
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
    await waitFor(() => expect(screen.getByLabelText('Repository')).toBeEnabled());
    fireEvent.click(screen.getByLabelText('Repository'));
    fireEvent.click(await screen.findByRole('option', { name: /acme\/widgets/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Rescan' }));
    await waitFor(() => expect(apiClient.startScanRepo).toHaveBeenCalledWith('acme', 'widgets', ESecretType.GITHUB_PAT));
    expect(mine).not.toHaveBeenCalled();
  });

  it('only lists repos with at least one testable-type finding, unscoped by admin ownership', async () => {
    render(<TestingPanel isAdmin={true} />);

    await waitFor(() => expect(apiClient.fetchTestingFacets).toHaveBeenCalledWith({
      repoId: null, status: null, secretTypes: [], testableTypes: TESTABLE_SECRET_TYPES,
    }));
  });

  it('loads any repo (not just the admin\'s own), scoped to testable secret types', async () => {
    render(<TestingPanel isAdmin={true} />);

    await waitFor(() => expect(screen.getByLabelText('Repository')).toBeEnabled());
    fireEvent.click(screen.getByLabelText('Repository'));
    fireEvent.click(await screen.findByRole('option', { name: /acme\/widgets/ }));

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
    expect(screen.queryByRole('button', { name: 'Test all' })).not.toBeInTheDocument();
  });

  it('tests a single finding via the admin endpoint', async () => {
    vi.spyOn(apiClient, 'adminTestFinding').mockResolvedValue(testedFinding);

    render(<TestingPanel isAdmin={true} />);

    await waitFor(() => expect(screen.getByLabelText('Repository')).toBeEnabled());
    fireEvent.click(screen.getByLabelText('Repository'));
    fireEvent.click(await screen.findByRole('option', { name: /acme\/widgets/ }));

    await waitFor(() => expect(screen.getByText('src/config.ts')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Test' }));

    await waitFor(() => expect(apiClient.adminTestFinding).toHaveBeenCalledWith(10));
    expect(screen.getByText(/Check .* valid/)).toBeInTheDocument();
  });

  it('reloads automatically when the secret type changes', async () => {
    render(<TestingPanel isAdmin={true} />);

    await waitFor(() => expect(screen.getByLabelText('Repository')).toBeEnabled());
    fireEvent.click(screen.getByLabelText('Repository'));
    fireEvent.click(await screen.findByRole('option', { name: /acme\/widgets/ }));
    await waitFor(() => expect(apiClient.fetchTestingFacets).toHaveBeenCalledWith({
      repoId: 1, status: null, secretTypes: [], testableTypes: TESTABLE_SECRET_TYPES,
    }));

    fireEvent.click(screen.getByLabelText('Secret type'));
    fireEvent.click(within(screen.getByRole('listbox')).getByText(ESecretType.GITHUB_PAT.replace(/_/g, ' ')));


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
