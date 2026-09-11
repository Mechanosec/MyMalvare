import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SecretValue } from '../../src/components/secret-value';

describe('SecretValue', () => {
  it('renders masked by default, not the raw secret', () => {
    render(<SecretValue value="AKIAABCDEFGHIJKLMNOP" />);
    expect(screen.queryByText('AKIAABCDEFGHIJKLMNOP')).not.toBeInTheDocument();
    expect(screen.getByText(/^AKIA/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reveal secret' })).toBeInTheDocument();
  });

  it('reveals the raw value on clicking the eye button, and re-masks on a second click', () => {
    render(<SecretValue value="AKIAABCDEFGHIJKLMNOP" />);

    fireEvent.click(screen.getByRole('button', { name: 'Reveal secret' }));
    expect(screen.getByText('AKIAABCDEFGHIJKLMNOP')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Hide secret' }));
    expect(screen.queryByText('AKIAABCDEFGHIJKLMNOP')).not.toBeInTheDocument();
  });
});
