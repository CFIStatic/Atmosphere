import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    user: {
      id: 'user-1',
      email: 'dana@ortizrestoration.com',
      createdAt: '2026-01-01T00:00:00Z',
      lastSignInAt: '2026-08-22T00:00:00Z',
      emailConfirmed: true,
      metadata: {},
    },
    profile: { fullName: 'Dana Ortiz' },
    membership: { org: { id: 'org-1', name: 'Ortiz', joinCode: 'ABC123' } },
    setProfile: vi.fn(),
    logout: vi.fn(),
    refreshMembership: vi.fn(),
  }),
}));

vi.mock('../lib/api', () => ({
  api: {},
  ApiError: class ApiError extends Error {
    status = 400;
    code = 'failed';
  },
  ROLE_LABELS: {},
  WORK_TYPE_LABELS: {},
  CONTRACTOR_TYPE_LABELS: {},
}));

vi.mock('../hooks/useFeatureTimer', () => ({
  useFeatureTimer: () => undefined,
}));

vi.mock('../lib/usePlatform', () => ({
  usePlatform: () => ['operations', vi.fn()],
}));

import { SettingsPage } from './SettingsPage';

describe('Settings preferences', () => {
  it('no longer offers a product walkthrough replay', () => {
    render(
      <MemoryRouter initialEntries={['/settings?section=preferences']}>
        <SettingsPage />
      </MemoryRouter>,
    );

    expect(screen.getByText('This device')).toBeInTheDocument();
    expect(screen.getByText('Reduce motion')).toBeInTheDocument();
    expect(screen.getByText('Appearance')).toBeInTheDocument();
    expect(screen.queryByText('Product walkthrough')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Replay tour' })).toBeNull();
  });
});
