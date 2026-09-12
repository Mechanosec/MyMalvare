import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MultiSelect } from '../../src/components/multi-select';

const OPTIONS = [
  { value: 'a', label: 'Option A', count: 3 },
  { value: 'b', label: 'Option B', count: 0 },
  { value: 'c', label: 'Option C' },
];

describe('MultiSelect', () => {
  it('shows "All" when nothing is selected, and opens the option list on click', () => {
    render(<MultiSelect label="Type" options={OPTIONS} selected={[]} onChange={vi.fn()} />);

    expect(screen.getByLabelText('Type')).toHaveTextContent('All');
    fireEvent.click(screen.getByLabelText('Type'));

    expect(screen.getByText('Option A')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('disables a zero-count option so it cannot be clicked for nothing', () => {
    render(<MultiSelect label="Type" options={OPTIONS} selected={[]} onChange={vi.fn()} />);
    fireEvent.click(screen.getByLabelText('Type'));

    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes[1]).toBeDisabled();
    expect(checkboxes[0]).not.toBeDisabled();
  });

  it('calls onChange with the toggled value added', () => {
    const onChange = vi.fn();
    render(<MultiSelect label="Type" options={OPTIONS} selected={[]} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('Type'));

    fireEvent.click(screen.getAllByRole('checkbox')[0]);

    expect(onChange).toHaveBeenCalledWith(['a']);
  });

  it('calls onChange with the toggled value removed when already selected', () => {
    const onChange = vi.fn();
    render(<MultiSelect label="Type" options={OPTIONS} selected={['a']} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('Type'));

    fireEvent.click(screen.getAllByRole('checkbox')[0]);

    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('shows the single selected label, or a count once more than one is selected', () => {
    const { rerender } = render(
      <MultiSelect label="Type" options={OPTIONS} selected={['a']} onChange={vi.fn()} />,
    );
    expect(screen.getByLabelText('Type')).toHaveTextContent('Option A');

    rerender(<MultiSelect label="Type" options={OPTIONS} selected={['a', 'c']} onChange={vi.fn()} />);
    expect(screen.getByLabelText('Type')).toHaveTextContent('2 selected');
  });
});
