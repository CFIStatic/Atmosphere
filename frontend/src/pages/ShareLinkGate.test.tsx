import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  user: null as null | { email: string },
  adoptUser: vi.fn(async () => null),
  logout: vi.fn(async () => undefined),
  progressShareInvite: vi.fn(),
  claimProgressShare: vi.fn(),
  progressShareVerifyEmailSignIn: vi.fn(),
  progressShareGuest: vi.fn(),
}));

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: h.user, loading: false, adoptUser: h.adoptUser, logout: h.logout }),
}));
vi.mock('../lib/api', async (orig) => {
  const actual = await orig<typeof import('../lib/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      progressShareInvite: (...a: unknown[]) => h.progressShareInvite(...a),
      claimProgressShare: (...a: unknown[]) => h.claimProgressShare(...a),
      progressShareVerifyEmailSignIn: (...a: unknown[]) => h.progressShareVerifyEmailSignIn(...a),
      progressShareGuest: (...a: unknown[]) => h.progressShareGuest(...a),
    },
  };
});

import { ShareLinkGate } from './ShareLinkGate';

const TOKEN = 'tok_0123456789abcdef0123';

function Where() {
  const l = useLocation();
  return <p data-testid="where">{l.pathname + l.search}</p>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/progress/:token" element={<ShareLinkGate />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ShareLinkGate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.user = null;
    h.progressShareInvite.mockResolvedValue({ recipientEmail: 'Home@Owner.com', orgName: 'Jettx LLC', jobTitle: 'dry run test 2' });
    h.claimProgressShare.mockResolvedValue({ ok: true, orgId: 'o', jobId: 'j1', path: '/job-progress?job=j1' });
  });

  it('signed out: sends the homeowner to the shared sign-in page with the invite prefilled', async () => {
    renderAt(`/progress/${TOKEN}`);
    const where = await screen.findByTestId('where');
    const url = new URL(where.textContent!, 'https://x');
    expect(url.pathname).toBe('/login');
    expect(url.searchParams.get('share')).toBe(TOKEN);
    expect(url.searchParams.get('email')).toBe('home@owner.com');
    expect(url.searchParams.get('next')).toBe(`/progress/${TOKEN}`);
    expect(h.progressShareGuest).not.toHaveBeenCalled();
  });

  it('signed in as the invited email: claims and opens the job in the portal', async () => {
    h.user = { email: 'home@owner.com' };
    renderAt(`/progress/${TOKEN}`);
    expect(await screen.findByTestId('where')).toHaveTextContent('/job-progress?job=j1');
    expect(h.claimProgressShare).toHaveBeenCalledWith(TOKEN);
  });

  it('signed in as someone else: never claims, offers to switch', async () => {
    h.user = { email: 'gc@contractor.com' };
    renderAt(`/progress/${TOKEN}`);
    expect(await screen.findByTestId('share-gate-mismatch')).toHaveTextContent('Home@Owner.com');
    expect(h.claimProgressShare).not.toHaveBeenCalled();
    expect(screen.queryByText(/Open in my account/)).toBeNull();
  });

  it('emailed sign-in link: verifies, adopts the session and opens the job', async () => {
    h.progressShareVerifyEmailSignIn.mockResolvedValue({ ok: true, user: { id: 'u' }, orgId: 'o', jobId: 'j1', path: '/job-progress?job=j1' });
    renderAt(`/progress/${TOKEN}?signin=hash_abcdefgh&kind=magiclink`);
    expect(await screen.findByTestId('where')).toHaveTextContent('/job-progress?job=j1');
    expect(h.progressShareVerifyEmailSignIn).toHaveBeenCalledWith(TOKEN, { tokenHash: 'hash_abcdefgh', kind: 'magiclink' });
    await waitFor(() => expect(h.adoptUser).toHaveBeenCalled());
  });

  it('bad link: shows unavailable, no job data', async () => {
    const { ApiError } = await import('../lib/api');
    h.progressShareInvite.mockRejectedValue(new ApiError(404, 'This link does not exist.'));
    renderAt(`/progress/${TOKEN}`);
    expect(await screen.findByText('This link does not exist.')).toBeInTheDocument();
    // A dead link goes to the plain sign-in page, not the homeowner email-link page.
    expect(screen.getByTestId('share-gate-error-link')).toHaveAttribute('href', '/login');
  });
});
