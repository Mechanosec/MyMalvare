import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProgressPanel } from '../../src/components/progress-panel';
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
  });

  afterEach(() => {
    vi.useRealTimers();
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
});
