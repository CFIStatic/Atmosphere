import { act, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePendingAuthRedirect } from './usePendingAuthRedirect';

const auth = vi.hoisted(() => ({ user: null as null | { id: string }, loading: false }));
vi.mock('../context/AuthContext', () => ({ useAuth: () => auth }));

let queue: (to: string) => void = () => undefined;
function Probe() {
  queue = usePendingAuthRedirect();
  return <h1>Signup</h1>;
}

function renderAt() {
  return render(
    <MemoryRouter initialEntries={['/signup']}>
      <Routes>
        <Route path="/signup" element={<Probe />} />
        <Route path="/intake" element={<h1>Start a job</h1>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('usePendingAuthRedirect', () => {
  beforeEach(() => {
    auth.user = null;
    auth.loading = false;
  });

  it('navigates right away when the user is already signed in (Stripe return, comped setup)', async () => {
    auth.user = { id: 'u1' };
    renderAt();
    act(() => queue('/intake'));
    expect(await screen.findByRole('heading', { name: 'Start a job' })).toBeInTheDocument();
  });

  it('waits for the user before navigating after login', async () => {
    const view = renderAt();
    act(() => queue('/intake'));
    expect(screen.getByRole('heading', { name: 'Signup' })).toBeInTheDocument();
    auth.user = { id: 'u1' };
    view.rerender(
      <MemoryRouter initialEntries={['/signup']}>
        <Routes>
          <Route path="/signup" element={<Probe />} />
          <Route path="/intake" element={<h1>Start a job</h1>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByRole('heading', { name: 'Start a job' })).toBeInTheDocument();
  });
});
