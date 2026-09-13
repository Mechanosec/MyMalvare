import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProgressPanel } from '../../src/components/progress-panel';
import * as apiClient from '../../src/lib/api-client';
import { EJobStatus } from '../../src/lib/constant/job-status.constant';

const handlers = new Map<string, (payload: unknown) => void>();
const fakeSocket = {
  on: vi.fn((event: string, handler: (payload: unknown) => void) => {
    handlers.set(event, handler);
  }),
  disconnect: vi.fn(),
};

vi.mock('socket.io-client', () => ({
  io: () => fakeSocket,
}));

describe('ProgressPanel', () => {
  beforeEach(() => {
    handlers.clear();
    vi.useFakeTimers();
    // Default: no history to hydrate, so existing tests (which drive state
    // purely via the fake socket) see the same "Starting…" -> live-event
    // behavior as before hydration was added.
    vi.spyOn(apiClient, 'fetchJob').mockResolvedValue({
      id: 'job-1',
      status: EJobStatus.RUNNING,
      processed: 0,
      message: 'scan started',
      log: [],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('renders nothing running when no job is given', () => {
    render(<ProgressPanel jobId={null} />);
    expect(screen.getByText('No job running.')).toBeInTheDocument();
  });

  it('shows a starting state before any event arrives', () => {
    render(<ProgressPanel jobId="job-1" />);
    expect(screen.getByText('Starting…')).toBeInTheDocument();
  });

  it('renders the message and processed count from a job:<id> socket event', () => {
    render(<ProgressPanel jobId="job-1" />);

    act(() => {
      handlers.get('job:job-1')?.({
        jobId: 'job-1',
        status: EJobStatus.RUNNING,
        message: 'processed 5',
        processed: 5,
      });
    });

    expect(screen.getByText(/\[running\] processed 5 \(5 processed\)/)).toBeInTheDocument();
  });

  it('accumulates multiple events into a scrolling log instead of replacing the last one', () => {
    render(<ProgressPanel jobId="job-1" />);

    act(() => {
      handlers.get('job:job-1')?.({ jobId: 'job-1', status: EJobStatus.RUNNING, message: 'processed 5', processed: 5 });
      handlers.get('job:job-1')?.({ jobId: 'job-1', status: EJobStatus.RUNNING, message: 'processed 10', processed: 10 });
    });

    expect(screen.getByText(/processed 5 \(5 processed\)/)).toBeInTheDocument();
    expect(screen.getByText(/processed 10 \(10 processed\)/)).toBeInTheDocument();
    expect(screen.getByText('2 lines')).toBeInTheDocument();
  });

  it('hydrates the log from GET /jobs/:id on mount, so a page reload does not lose history', async () => {
    vi.spyOn(apiClient, 'fetchJob').mockResolvedValue({
      id: 'job-1',
      status: EJobStatus.RUNNING,
      processed: 3,
      message: 'scan: octocat/repo3 - cloning',
      log: [
        { jobId: 'job-1', status: EJobStatus.RUNNING, message: 'scan started' },
        { jobId: 'job-1', status: EJobStatus.RUNNING, message: 'scan: octocat/repo1 - cloning' },
        { jobId: 'job-1', status: EJobStatus.RUNNING, message: 'scan: octocat/repo1 - done, 0 findings total', processed: 1 },
      ],
    });

    render(<ProgressPanel jobId="job-1" />);

    await vi.waitFor(() => expect(screen.getByText('3 lines')).toBeInTheDocument());
    expect(screen.getByText(/scan: octocat\/repo1 - cloning/)).toBeInTheDocument();
    expect(screen.getByText(/scan: octocat\/repo1 - done, 0 findings total/)).toBeInTheDocument();
  });

  it('does not show a Stop button unless showStopButton is passed', () => {
    render(<ProgressPanel jobId="job-1" />);

    act(() => {
      handlers.get('job:job-1')?.({ jobId: 'job-1', status: EJobStatus.RUNNING, message: 'processed 5', processed: 5 });
    });

    expect(screen.queryByRole('button', { name: /Stop/ })).not.toBeInTheDocument();
  });

  it('shows a Stop button while the job is queued or running when showStopButton is passed, and calls stopJob on click', async () => {
    vi.spyOn(apiClient, 'stopJob').mockResolvedValue({ ok: true });
    render(<ProgressPanel jobId="job-1" showStopButton />);

    act(() => {
      handlers.get('job:job-1')?.({ jobId: 'job-1', status: EJobStatus.RUNNING, message: 'processed 5', processed: 5 });
    });

    const stopButton = screen.getByRole('button', { name: 'Stop' });
    fireEvent.click(stopButton);

    expect(apiClient.stopJob).toHaveBeenCalledWith('job-1');
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Stopping…' })).toBeInTheDocument());
  });

  it('hides the Stop button once the job reaches a terminal status', () => {
    render(<ProgressPanel jobId="job-1" showStopButton />);

    act(() => {
      handlers.get('job:job-1')?.({ jobId: 'job-1', status: EJobStatus.DONE, message: 'finished', processed: 5 });
    });

    expect(screen.queryByRole('button', { name: /Stop/ })).not.toBeInTheDocument();
  });
});
