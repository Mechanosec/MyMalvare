import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import * as authContext from '../lib/auth-context';
import { Dashboard } from './dashboard';

function mockAuth(overrides: Partial<ReturnType<typeof authContext.useAuth>>) {
  vi.spyOn(authContext, 'useAuth').mockReturnValue({
    user: null,
    loading: false,
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    ...overrides,
  });
}

describe('Dashboard', () => {
  it('renders nothing while the stored session is still being verified, instead of flashing the landing page', () => {
    mockAuth({ loading: true, user: null });

    const { container } = render(<Dashboard />);

    expect(container).toBeEmptyDOMElement();
  });

  it('shows the landing page once verification finishes and there is no user', () => {
    mockAuth({ loading: false, user: null });

    render(<Dashboard />);

    expect(screen.getByRole('button', { name: 'Log in' })).toBeInTheDocument();
  });
});
