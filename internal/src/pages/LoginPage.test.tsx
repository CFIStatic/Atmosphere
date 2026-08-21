import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { LoginPage } from './LoginPage';

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    user: null,
    access: null,
    loading: false,
    login: vi.fn(),
  }),
}));

describe('LoginPage', () => {
  it('asks for first name, last name, email, and access code — not a password', () => {
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: 'Internal' })).toBeInTheDocument();
    expect(screen.getByLabelText('First name')).toBeInTheDocument();
    expect(screen.getByLabelText('Last name')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Access code')).toBeInTheDocument();
    expect(screen.queryByLabelText('Password')).toBeNull();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /demo/i })).toBeNull();
  });
});
