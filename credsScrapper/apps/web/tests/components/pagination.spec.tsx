import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Pagination } from '../../src/components/pagination';

describe('Pagination', () => {
  it('marks the current page and disables Previous on the first page', () => {
    render(<Pagination page={0} pageCount={5} onChange={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next' })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: '1' })).toHaveAttribute('aria-current', 'page');
  });

  it('disables Next on the last page', () => {
    render(<Pagination page={4} pageCount={5} onChange={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '5' })).toHaveAttribute('aria-current', 'page');
  });

  it('calls onChange with a 0-indexed page when a page number is clicked', () => {
    const onChange = vi.fn();
    render(<Pagination page={0} pageCount={5} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: '3' }));

    expect(onChange).toHaveBeenCalledWith(2);
  });

  it('collapses a large page count to first, a window around current, and last, with ellipses', () => {
    render(<Pagination page={49} pageCount={28495} onChange={vi.fn()} />);

    expect(screen.getByRole('button', { name: '1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '50' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: '48' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '52' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '28495' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '2' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '28494' })).not.toBeInTheDocument();
  });

  it('advances one page when Next is clicked', () => {
    const onChange = vi.fn();
    render(<Pagination page={1} pageCount={5} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    expect(onChange).toHaveBeenCalledWith(2);
  });
});
