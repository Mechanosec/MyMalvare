import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EFindingStatus } from '../lib/constant/finding-status.constant';
import { FindingStatusBadge } from './finding-status-badge';

describe('FindingStatusBadge', () => {
  it('renders the status label', () => {
    render(<FindingStatusBadge status={EFindingStatus.VALID} />);
    expect(screen.getByText('valid')).toBeInTheDocument();
  });
});
