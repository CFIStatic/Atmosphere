import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authState = vi.hoisted(() => ({
  user: {
    id: 'user-1',
    email: 'tech@jett.test',
    createdAt: '2026-01-01T00:00:00Z',
    lastSignInAt: '2026-08-22T00:00:00Z',
    emailConfirmed: true,
    metadata: {},
  },
  profile: {
    id: 'user-1',
    email: 'tech@jett.test',
    fullName: 'Field Tech',
    avatarUrl: null as string | null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-08-22T00:00:00Z',
  },
  membership: { org: { id: 'org-1', name: 'Jett', joinCode: 'ABC123' }, role: 'technician' },
  logout: vi.fn(),
}));

vi.mock('../context/AuthContext', () => ({
  useAuth: () => authState,
}));

vi.mock('../hooks/useFeatureTimer', () => ({
  useFeatureTimer: () => undefined,
}));

vi.mock('../lib/usePlatform', () => ({
  usePlatform: () => ['field', vi.fn()],
}));

import { ConsoleShell } from './ConsoleShell';

function renderConsole(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<ConsoleShell />}>
          <Route path="/intake" element={<h1>Start a job</h1>} />
          <Route path="/verifier-library" element={<h1>Dashboard</h1>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('ConsoleShell', () => {
  beforeEach(() => {
    authState.logout.mockReset();
  });

  it('keeps the same left rail mounted when Dashboard is clicked', async () => {
    const user = userEvent.setup();
    renderConsole('/intake');

    expect(screen.getByRole('heading', { name: 'Start a job' })).toBeInTheDocument();
    const rail = screen.getByRole('navigation', { name: 'Primary' });
    expect(rail).toHaveTextContent('Start a job');
    expect(rail).toHaveTextContent('Dashboard');
    expect(rail).not.toHaveTextContent('Overview');
    expect(rail).not.toHaveTextContent('Job Files');

    await user.click(screen.getByRole('link', { name: 'Dashboard' }));

    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Start a job' })).toBeNull();
    // Same DOM node — a remounted shell would be a new <nav>.
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBe(rail);
    expect(rail).not.toHaveTextContent('Overview');
    expect(rail).not.toHaveTextContent('My work');
    expect(rail).toHaveTextContent('Start a job');
    expect(rail).toHaveTextContent('Dashboard');
    expect(rail).not.toHaveTextContent('Job Files');
    expect(rail).toHaveTextContent('Settings');
    expect(rail).not.toHaveTextContent('Capture');
  });
});
