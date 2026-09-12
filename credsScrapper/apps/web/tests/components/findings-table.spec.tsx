import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FindingsTable } from '../../src/components/findings-table';
import * as apiClient from '../../src/lib/api-client';
import { EFindingStatus } from '../../src/lib/constant/finding-status.constant';
import { ESecretType } from '../../src/lib/constant/secret-type.constant';
import { IFinding, IFindingsPage } from '../../src/lib/types/finding.type';

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
  status: EFindingStatus.UNKNOWN,
  leakCommits: [],
};

function page(items: IFinding[], total = items.length): IFindingsPage {
  return { items, total };
}

const NO_FILTER_QUERY = {
  secretTypes: undefined,
  repoIds: undefined,
  statuses: undefined,
  search: undefined,
  offset: 0,
};

describe('FindingsTable', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(apiClient, 'fetchFindingsRepoOptions').mockResolvedValue([
      { repoId: 42, owner: 'octocat', name: 'hello-world', count: 1 },
    ]);
    vi.spyOn(apiClient, 'fetchFindingsSecretTypeCounts').mockResolvedValue(
      Object.values(ESecretType).map((secretType) => ({ secretType, count: 1 })),
    );
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fetches and renders findings on mount with no filter', async () => {
    const fetchFindings = vi.spyOn(apiClient, 'fetchFindings').mockResolvedValue(page([finding]));
    render(<FindingsTable isAdmin refreshKey={0} />);

    await vi.waitFor(() => {
      expect(fetchFindings).toHaveBeenCalledWith(NO_FILTER_QUERY);
      expect(screen.getByText('octocat/hello-world')).toBeInTheDocument();
    });
  });

  it('re-fetches with the selected secret type when the filter changes', async () => {
    const fetchFindings = vi.spyOn(apiClient, 'fetchFindings').mockResolvedValue(page([finding]));
    render(<FindingsTable isAdmin refreshKey={0} />);

    fireEvent.click(screen.getByLabelText('Secret type'));
    fireEvent.click(screen.getByText(ESecretType.GITHUB_PAT.replace(/_/g, ' ')));

    await vi.waitFor(() =>
      expect(fetchFindings).toHaveBeenLastCalledWith({
        ...NO_FILTER_QUERY,
        secretTypes: [ESecretType.GITHUB_PAT],
      }),
    );
  });

  it('coalesces rapid checkbox clicks into a single debounced fetch instead of one per click', async () => {
    const fetchFindings = vi.spyOn(apiClient, 'fetchFindings').mockResolvedValue(page([finding]));
    render(<FindingsTable isAdmin refreshKey={0} />);
    const callsBeforeClicks = fetchFindings.mock.calls.length;

    fireEvent.click(screen.getByLabelText('Secret type'));
    fireEvent.click(screen.getByText(ESecretType.GITHUB_PAT.replace(/_/g, ' ')));
    vi.advanceTimersByTime(100);
    fireEvent.click(screen.getByText(ESecretType.GITLAB_PAT.replace(/_/g, ' ')));
    vi.advanceTimersByTime(100);
    fireEvent.click(screen.getByText(ESecretType.SLACK_TOKEN.replace(/_/g, ' ')));

    // Still within the debounce window of the last click - no new fetch yet.
    vi.advanceTimersByTime(299);
    expect(fetchFindings.mock.calls.length).toBe(callsBeforeClicks);

    vi.advanceTimersByTime(1);
    await vi.waitFor(() =>
      expect(fetchFindings).toHaveBeenLastCalledWith({
        ...NO_FILTER_QUERY,
        secretTypes: [ESecretType.GITHUB_PAT, ESecretType.GITLAB_PAT, ESecretType.SLACK_TOKEN],
      }),
    );
    // Exactly one fetch for the whole burst of clicks, not three.
    expect(fetchFindings.mock.calls.length).toBe(callsBeforeClicks + 1);
  });

  it('re-fetches with the selected repository when the filter changes', async () => {
    const fetchFindings = vi.spyOn(apiClient, 'fetchFindings').mockResolvedValue(page([finding]));
    render(<FindingsTable isAdmin refreshKey={0} />);

    fireEvent.click(screen.getByLabelText('Repository'));
    const listbox = screen.getByRole('listbox');
    await vi.waitFor(() => within(listbox).getByText('octocat/hello-world'));
    fireEvent.click(within(listbox).getByText('octocat/hello-world'));

    await vi.waitFor(() =>
      expect(fetchFindings).toHaveBeenLastCalledWith({ ...NO_FILTER_QUERY, repoIds: [42] }),
    );
  });

  it('debounces the search box and searches server-side across the whole dataset', async () => {
    const fetchFindings = vi.spyOn(apiClient, 'fetchFindings').mockResolvedValue(page([finding]));
    render(<FindingsTable isAdmin refreshKey={0} />);

    fireEvent.change(screen.getByLabelText('Search findings'), {
      target: { value: 'octocat/hello' },
    });

    vi.advanceTimersByTime(299);
    expect(fetchFindings).not.toHaveBeenLastCalledWith(
      expect.objectContaining({ search: 'octocat/hello' }),
    );

    vi.advanceTimersByTime(1);
    await vi.waitFor(() =>
      expect(fetchFindings).toHaveBeenLastCalledWith({
        ...NO_FILTER_QUERY,
        search: 'octocat/hello',
      }),
    );
  });

  it('shows an empty state when there are no findings', () => {
    vi.spyOn(apiClient, 'fetchFindings').mockResolvedValue(page([]));
    render(<FindingsTable isAdmin refreshKey={0} />);
    expect(screen.getByText('No findings match this filter.')).toBeInTheDocument();
  });

  it('requests the next offset when Next is clicked, duplicated top and bottom', async () => {
    const fetchFindings = vi
      .spyOn(apiClient, 'fetchFindings')
      .mockResolvedValue(page([finding], 120));
    render(<FindingsTable isAdmin refreshKey={0} />);

    // Wait for the initial fetch to resolve AND the resulting re-render to
    // land (total: 120 -> a page "2" button exists) before clicking Next.
    await vi.waitFor(() => expect(screen.getAllByRole('button', { name: '2' })).toHaveLength(2));

    // Pagination appears above and below the table, so every query here
    // expects two matches.
    const previousButtons = screen.getAllByRole('button', { name: 'Previous' });
    expect(previousButtons).toHaveLength(2);
    previousButtons.forEach((button) => expect(button).toBeDisabled());
    screen.getAllByRole('button', { name: '1' }).forEach((button) =>
      expect(button).toHaveAttribute('aria-current', 'page'),
    );

    fireEvent.click(screen.getAllByRole('button', { name: 'Next' })[0]);

    await vi.waitFor(() =>
      expect(fetchFindings).toHaveBeenLastCalledWith({ ...NO_FILTER_QUERY, offset: 50 }),
    );
    screen.getAllByRole('button', { name: '2' }).forEach((button) =>
      expect(button).toHaveAttribute('aria-current', 'page'),
    );
    screen
      .getAllByRole('button', { name: 'Previous' })
      .forEach((button) => expect(button).not.toBeDisabled());
  });
});
