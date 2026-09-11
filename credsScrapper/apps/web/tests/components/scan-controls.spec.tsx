import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ScanControls } from '../../src/components/scan-controls';
import * as apiClient from '../../src/lib/api-client';

describe('ScanControls', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('calls startDiscover and reports the job id on Discover click', async () => {
    vi.spyOn(apiClient, 'startDiscover').mockResolvedValue({ jobId: 'job-1' });
    const onJobStarted = vi.fn();
    render(<ScanControls onJobStarted={onJobStarted} />);

    fireEvent.click(screen.getByText('Discover'));

    await vi.waitFor(() => expect(onJobStarted).toHaveBeenCalledWith('job-1'));
  });

  it('calls startScan with the entered workers and maxRepos', async () => {
    const startScan = vi.spyOn(apiClient, 'startScan').mockResolvedValue({ jobId: 'job-2' });
    const onJobStarted = vi.fn();
    render(<ScanControls onJobStarted={onJobStarted} />);

    fireEvent.change(screen.getByLabelText('Workers'), { target: { value: '4' } });
    fireEvent.change(screen.getByLabelText('Max repos (optional)'), { target: { value: '10' } });
    fireEvent.click(screen.getByText('Scan'));

    await vi.waitFor(() =>
      expect(startScan).toHaveBeenCalledWith({ workers: 4, maxRepos: 10 }),
    );
    expect(onJobStarted).toHaveBeenCalledWith('job-2');
  });

  it('shows an error message when startScan rejects', async () => {
    vi.spyOn(apiClient, 'startScan').mockRejectedValue(new Error('boom'));
    render(<ScanControls onJobStarted={vi.fn()} />);

    fireEvent.click(screen.getByText('Scan'));

    expect(await screen.findByText('boom')).toBeInTheDocument();
  });
});
