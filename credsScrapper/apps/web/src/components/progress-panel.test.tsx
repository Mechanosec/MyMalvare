import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as apiClient from '../lib/api-client';
import { EJobStatus } from '../lib/constant/job-status.constant';
import { IJobProgressEvent, IJobState } from '../lib/types/job-progress-event.type';
import { ProgressPanel } from './progress-panel';

const socketHandlers = vi.hoisted(() => ({ current: {} as Record<string, () => void> }));
vi.mock('socket.io-client', () => ({ io: () => ({
  on: (event: string, handler: () => void) => { socketHandlers.current[event] = handler; },
  disconnect: () => {},
}) }));

afterEach(() => vi.restoreAllMocks());

describe('ProgressPanel global cancellation result', () => {
  it('shows a stopped job as terminal and refreshes its consumer', async () => {
    vi.spyOn(apiClient, 'fetchJob').mockResolvedValue({
      id: 'synthetic-job', status: EJobStatus.STOPPED, processed: 1,
      message: 'Scan stopped',
      log: [{ jobId: 'synthetic-job', status: EJobStatus.STOPPED, message: 'Scan stopped', processed: 1 }],
    });
    const onDone = vi.fn();

    render(<ProgressPanel jobId="synthetic-job" showStopButton onDone={onDone} />);

    expect(await screen.findByText('Job stopped')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument();
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
  });

  it('resumes job polling if a connected socket disconnects', async () => {
    vi.spyOn(apiClient, 'fetchJob')
      .mockResolvedValueOnce({ id: 'synthetic-job', status: EJobStatus.RUNNING, processed: 0, message: 'Scanning', log: [] })
      .mockResolvedValue({ id: 'synthetic-job', status: EJobStatus.STOPPED, processed: 1, message: 'Stopped', log: [] });
    render(<ProgressPanel jobId="synthetic-job" />);
    expect(await screen.findByText('Job running')).toBeInTheDocument();
    await act(async () => {
      socketHandlers.current.connect();
      socketHandlers.current.disconnect();
      await new Promise((resolve) => setTimeout(resolve, 1100));
    });
    expect(await screen.findByText('Job stopped')).toBeInTheDocument();
  });

  it('does not replace a newer socket result with an older initial job response', async () => {
    let finishInitial!: (job: IJobState) => void;
    vi.spyOn(apiClient, 'fetchJob').mockImplementation(() => new Promise((resolve) => { finishInitial = resolve; }));
    render(<ProgressPanel jobId="synthetic-job" />);
    act(() => {
      (socketHandlers.current['job:synthetic-job'] as (event: IJobProgressEvent) => void)({
        jobId: 'synthetic-job', status: EJobStatus.STOPPED, message: 'Stopped', processed: 1,
      });
    });
    expect(screen.getByText('Job stopped')).toBeInTheDocument();

    await act(async () => finishInitial({
      id: 'synthetic-job', status: EJobStatus.RUNNING, processed: 0, message: 'Scanning',
      log: [{ jobId: 'synthetic-job', status: EJobStatus.RUNNING, message: 'Scanning' }],
    }));
    expect(screen.getByText('Job stopped')).toBeInTheDocument();
  });
});
