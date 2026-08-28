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
          <Route path="/field" element={<h1>Field overview</h1>} />
          <Route path="/my-work" element={<h1>My work</h1>} />
          <Route path="/jobs" element={<h1>Jobs</h1>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('ConsoleShell', () => {
  beforeEach(() => {
    authState.logout.mockReset();
  });

  it('keeps the same left rail mounted when Overview is clicked', async () => {
    const user = userEvent.setup();
    renderConsole('/jobs');

    expect(screen.getByRole('heading', { name: 'Jobs' })).toBeInTheDocument();
    const rail = screen.getByRole('navigation', { name: 'Primary' });
    expect(rail).toHaveTextContent('Overview');
    expect(rail).toHaveTextContent('Job Files');

    await user.click(screen.getByRole('link', { name: 'Overview' }));

    expect(screen.getByRole('heading', { name: 'Field overview' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Jobs' })).toBeNull();
    // Same DOM node — a remounted shell would be a new <nav>.
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBe(rail);
    expect(rail).toHaveTextContent('Overview');
    expect(rail).toHaveTextContent('My work');
    expect(rail).toHaveTextContent('Start a job');
    expect(rail).toHaveTextContent('Dashboard');
    expect(rail).toHaveTextContent('Job Files');
    expect(rail).toHaveTextContent('Settings');
    expect(rail).not.toHaveTextContent('Capture');
  });
});
