import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComputerLogin, ComputerLoginsState, ComputerSignIn } from '../lib/computer';
import { LoginsPage } from './LoginsPage';

const computerLogins = vi.fn();
const computerStartSignIn = vi.fn();
const computerSignInLive = vi.fn();
const computerSignInDone = vi.fn();
const computerSignInCancel = vi.fn();
const computerRemoveLogin = vi.fn();

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api')>('../lib/api');
  return {
    ...actual,
    api: {
      ...actual.api,
      computerLogins: (...a: unknown[]) => computerLogins(...a),
      computerStartSignIn: (...a: unknown[]) => computerStartSignIn(...a),
      computerSignInLive: (...a: unknown[]) => computerSignInLive(...a),
      computerSignInDone: (...a: unknown[]) => computerSignInDone(...a),
      computerSignInCancel: (...a: unknown[]) => computerSignInCancel(...a),
      computerRemoveLogin: (...a: unknown[]) => computerRemoveLogin(...a),
    },
  };
});

const LIVE = 'https://www.browserbase.com/devtools-fullscreen/inspector.html?wss=connect.browserbase.com/debug/x';

function state(over: Partial<ComputerLoginsState> = {}): ComputerLoginsState {
  return { configured: true, message: null, logins: [], signingIn: null, busy: null, ...over };
}

const outlook: ComputerLogin = {
  id: 'l1',
  label: 'Outlook',
  url: 'https://outlook.office.com/',
  host: 'outlook.office.com',
  addedBy: 'Dana Ruiz',
  addedAt: new Date().toISOString(),
  lastSignedInAt: new Date().toISOString(),
  lastSignedInBy: 'Dana Ruiz',
  canClearCookies: true,
};

const signIn: ComputerSignIn = {
  sessionId: 's1',
  label: 'Outlook',
  url: 'https://outlook.office.com/',
  host: 'outlook.office.com',
  loginId: null,
  startedAt: new Date().toISOString(),
  startedBy: 'Dana Ruiz',
  startedByYou: true,
  expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
};

beforeEach(() => {
  vi.clearAllMocks();
  computerSignInLive.mockResolvedValue({ url: LIVE, expiresAt: new Date(Date.now() + 600_000).toISOString(), mode: 'control' });
});

describe('LoginsPage', () => {
  it('shows the empty state and the password line', async () => {
    computerLogins.mockResolvedValue(state());
    render(<LoginsPage />);
    expect(await screen.findByTestId('logins-empty')).toHaveTextContent('No logins yet');
    expect(screen.getByTestId('logins-password-line')).toHaveTextContent(
      'We never see or store your passwords',
    );
    expect(screen.getByRole('button', { name: 'Add login' })).toBeEnabled();
  });

  it('says when Computer is not set up and offers no Add login', async () => {
    computerLogins.mockResolvedValue(state({ configured: false, message: 'Computer is not set up yet.' }));
    render(<LoginsPage />);
    expect(await screen.findByTestId('logins-not-set-up')).toHaveTextContent('not set up');
    expect(screen.queryByRole('button', { name: 'Add login' })).toBeNull();
  });

  it('adds a login from a quick pick: opens the live view in control mode, then saves on Done', async () => {
    const user = userEvent.setup();
    computerLogins.mockResolvedValueOnce(state());
    computerStartSignIn.mockResolvedValue({ signIn });
    computerSignInDone.mockResolvedValue({ login: outlook });
    render(<LoginsPage />);
    await user.click(await screen.findByRole('button', { name: 'Add login' }));
    await user.click(screen.getByRole('button', { name: 'Outlook' }));
    expect(screen.getByLabelText('Website address')).toHaveValue('https://outlook.office.com');
    await user.click(screen.getByRole('button', { name: 'Open sign-in page' }));
    expect(computerStartSignIn).toHaveBeenCalledWith({ url: 'https://outlook.office.com', label: 'Outlook' });

    const panel = await screen.findByTestId('logins-signing-in');
    expect(within(panel).getByText('Signing in to Outlook')).toBeInTheDocument();
    const frame = await screen.findByTestId('computer-live-iframe');
    expect(frame).toHaveAttribute('src', LIVE);
    expect(frame.getAttribute('style') ?? '').not.toContain('pointer-events');
    expect(computerSignInLive).toHaveBeenCalledWith('s1');

    computerLogins.mockResolvedValue(state({ logins: [outlook] }));
    await user.click(screen.getByRole('button', { name: 'Done, I’m signed in' }));
    expect(computerSignInDone).toHaveBeenCalledWith('s1');
    expect(await screen.findByText('Saved. Computer is signed in to Outlook.')).toBeInTheDocument();
    const list = await screen.findByTestId('logins-list');
    expect(within(list).getByText('outlook.office.com')).toBeInTheDocument();
    expect(within(list).getByText(/Added by Dana Ruiz/)).toBeInTheDocument();
  });

  it('resumes your sign-in after a reload', async () => {
    computerLogins.mockResolvedValue(state({ signingIn: signIn }));
    render(<LoginsPage />);
    expect(await screen.findByTestId('logins-signing-in')).toBeInTheDocument();
    expect(await screen.findByTestId('computer-live-iframe')).toBeInTheDocument();
  });

  it('shows why it is busy and disables new sign-ins', async () => {
    computerLogins.mockResolvedValue(
      state({ logins: [outlook], busy: 'Computer is working on a task for your company right now.' }),
    );
    render(<LoginsPage />);
    expect(await screen.findByTestId('logins-busy')).toHaveTextContent('working on a task');
    expect(screen.getByRole('button', { name: 'Add login' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Sign in again' })).toBeDisabled();
  });

  it('signs in again to a saved site', async () => {
    const user = userEvent.setup();
    computerLogins.mockResolvedValue(state({ logins: [outlook] }));
    computerStartSignIn.mockResolvedValue({ signIn: { ...signIn, loginId: 'l1' } });
    render(<LoginsPage />);
    await user.click(await screen.findByRole('button', { name: 'Sign in again' }));
    expect(computerStartSignIn).toHaveBeenCalledWith({ loginId: 'l1' });
    expect(await screen.findByTestId('logins-signing-in')).toBeInTheDocument();
  });

  it('removes after a confirm and shows what happened to the cookies', async () => {
    const user = userEvent.setup();
    computerLogins.mockResolvedValueOnce(state({ logins: [outlook] }));
    computerRemoveLogin.mockResolvedValue({
      removed: true,
      cookiesCleared: true,
      message: 'Removed Outlook. Computer is signed out of it.',
    });
    render(<LoginsPage />);
    await user.click(await screen.findByRole('button', { name: 'Remove' }));
    expect(screen.getByText('Remove and sign Computer out of this site?')).toBeInTheDocument();
    computerLogins.mockResolvedValue(state());
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(computerRemoveLogin).toHaveBeenCalledWith('l1');
    expect(await screen.findByText('Removed Outlook. Computer is signed out of it.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('logins-empty')).toBeInTheDocument());
  });
});
