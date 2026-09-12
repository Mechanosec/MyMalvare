import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LoginForm } from './login-form';

describe('LoginForm', () => {
  it('calls onLogin with the entered email and password', () => {
    const onLogin = vi.fn();
    const onRegister = vi.fn();
    render(<LoginForm onLogin={onLogin} onRegister={onRegister} />);

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));

    expect(onLogin).toHaveBeenCalledWith('a@b.com', 'secret123');
  });

  it('calls onRegister instead when the register button is clicked', () => {
    const onLogin = vi.fn();
    const onRegister = vi.fn();
    render(<LoginForm onLogin={onLogin} onRegister={onRegister} />);

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Register' }));

    expect(onRegister).toHaveBeenCalledWith('a@b.com', 'secret123');
  });
});
