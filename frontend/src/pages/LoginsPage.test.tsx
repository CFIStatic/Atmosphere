import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComputerLogin, ComputerLoginsState, ComputerSignIn, LoginCatalog } from '../lib/computer';
import { LoginsPage } from './LoginsPage';

const computerLogins = vi.fn();
const computerStartSignIn = vi.fn();
const computerSignInLive = vi.fn();
const computerSignInDone = vi.fn();
const computerSignInCancel = vi.fn();
const computerRemoveLogin = vi.fn();
const computerSaveCredential = vi.fn();
const computerDeleteCredential = vi.fn();
const computerLoginCatalog = vi.fn();

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
      computerSaveCredential: (...a: unknown[]) => computerSaveCredential(...a),
      computerDeleteCredential: (...a: unknown[]) => computerDeleteCredential(...a),
      computerLoginCatalog: (...a: unknown[]) => computerLoginCatalog(...a),
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
  credential: null,
};

const PASSWORD = 'PW-SECRET-zq9-Atmosphere-TEST-7781-frontend';
const ADMIN = { enabled: true, message: null, canManage: true };
const MEMBER = { enabled: true, message: null, canManage: false };

const xactimate: ComputerLogin = {
  ...outlook,
  id: 'l2',
  label: 'Xactimate',
  url: 'https://identity.xactware.com/',
  host: 'identity.xactware.com',
  credential: {
    saved: true,
    username: 'estimates@example.test',
    loginUrl: null,
    status: 'ok',
    attentionReason: null,
    lastUsedAt: null,
    updatedAt: new Date().toISOString(),
    updatedBy: 'Dana Ruiz',
  },
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

const CATALOG: LoginCatalog = {
  categories: [
    { id: 'email_calendar', label: 'Email and calendar' },
    { id: 'chat_meetings', label: 'Team chat and meetings' },
    { id: 'accounting_payments', label: 'Accounting and payments' },
    { id: 'restoration', label: 'Restoration job management' },
  ],
  sites: [
    {
      id: 'outlook', name: 'Outlook (Microsoft 365)', category: 'email_calendar', signInUrl: 'https://outlook.office.com/mail/',
      host: 'outlook.office.com', aliases: ['outlook', 'office 365'], twoStep: 'likely', sso: true,
      logo: { text: 'O', color: '#0F6CBD' }, termsNote: null, practice: ['outlook.read_inbox'],
      signInSteps: 'Username, then Next, then password. Computer fills in the saved login itself.',
    },
    {
      id: 'gmail', name: 'Gmail (Google)', category: 'email_calendar', signInUrl: 'https://mail.google.com/',
      host: 'mail.google.com', aliases: ['gmail', 'google workspace'], twoStep: 'likely', sso: true,
      logo: { text: 'G', color: '#EA4335' }, termsNote: null, practice: ['gmail.read_inbox'],
      signInSteps: 'Username, then Next, then password. Computer fills in the saved login itself. Google may ask for a code.',
    },
    {
      id: 'slack', name: 'Slack', category: 'chat_meetings', signInUrl: 'https://slack.com/signin',
      host: 'slack.com', aliases: ['slack'], twoStep: 'likely', sso: true,
      logo: { text: 'S', color: '#4A154B' }, termsNote: null, practice: ['slack.read_channels'],
      signInSteps: 'Username, then Next, then password. Computer fills in the saved login itself.',
    },
    {
      id: 'quickbooks', name: 'QuickBooks Online', category: 'accounting_payments', signInUrl: 'https://qbo.intuit.com/',
      host: 'qbo.intuit.com', aliases: ['quickbooks', 'qbo'], twoStep: 'likely', sso: false,
      logo: { text: 'QB', color: '#2CA01C' }, termsNote: null, practice: ['quickbooks.accounting_recent'],
      signInSteps: 'Username, then Next, then password. Computer fills in the saved login itself.',
    },
    {
      id: 'encircle', name: 'Encircle', category: 'restoration', signInUrl: 'https://encircleapp.com/login',
      host: 'encircleapp.com', aliases: ['encircle'], twoStep: 'rare', sso: false,
      logo: { text: 'En', color: '#00A88F' }, termsNote: null, practice: ['encircle.restoration_jobs'],
      signInSteps: 'Username, then Next, then password. Computer fills in the saved login itself.',
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  computerLoginCatalog.mockResolvedValue(CATALOG);
  computerSignInLive.mockResolvedValue({ url: LIVE, expiresAt: new Date(Date.now() + 600_000).toISOString(), mode: 'control' });
});

describe('LoginsPage', () => {
  it('shows the empty state and the password line', async () => {
    computerLogins.mockResolvedValue(state());
    render(<LoginsPage />);
    expect(await screen.findByTestId('logins-empty')).toHaveTextContent('No logins yet');
    expect(screen.getByTestId('logins-password-line')).toHaveTextContent(
      'Passwords are encrypted and only used to sign Computer in. Atmosphere’s AI never sees them.',
    );
    expect(screen.queryByText(/We never see or store/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Add login' })).toBeEnabled();
  });

  it('says when Computer is not set up and offers no Add login', async () => {
    computerLogins.mockResolvedValue(state({ configured: false, message: 'Computer is not set up yet.' }));
    render(<LoginsPage />);
    expect(await screen.findByTestId('logins-not-set-up')).toHaveTextContent('not set up');
    expect(screen.queryByRole('button', { name: 'Add login' })).toBeNull();
  });

  it('adds a login from the catalog: opens the live view in control mode, then saves on Done', async () => {
    const user = userEvent.setup();
    computerLogins.mockResolvedValueOnce(state());
    computerStartSignIn.mockResolvedValue({ signIn });
    computerSignInDone.mockResolvedValue({ login: outlook });
    render(<LoginsPage />);
    await user.click(await screen.findByRole('button', { name: 'Add login' }));
    await user.click(await screen.findByTestId('logins-catalog-outlook'));
    const picked = screen.getByTestId('logins-picked-site');
    expect(within(picked).getByText('https://outlook.office.com/mail/')).toBeInTheDocument();
    expect(screen.getByTestId('logins-two-step-note')).toHaveTextContent('You’ll be asked for a code when signing in.');
    await user.click(screen.getByRole('button', { name: 'Open sign-in page' }));
    expect(computerStartSignIn).toHaveBeenCalledWith({ url: 'https://outlook.office.com/mail/', label: 'Outlook (Microsoft 365)' });

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

  it('Add login: an admin can save a username and password for a custom site; Computer signs in with it', async () => {
    const user = userEvent.setup();
    const started = { ...signIn, label: 'Carrier portal' };
    computerLogins.mockResolvedValueOnce(state({ passwords: ADMIN }));
    computerLogins.mockResolvedValue(state({ passwords: ADMIN, signingIn: started }));
    computerStartSignIn.mockResolvedValue({
      signIn: { ...started, autoSignIn: { outcome: 'two_factor', message: 'The saved password worked. The portal is asking for a verification code.' } },
    });
    render(<LoginsPage />);
    await user.click(await screen.findByRole('button', { name: 'Add login' }));
    await user.click(await screen.findByTestId('logins-catalog-custom'));
    await user.type(screen.getByLabelText('Website address'), 'https://portal.carrier.example');
    await user.click(screen.getByRole('checkbox', { name: /Save a username and password/ }));
    await user.type(screen.getByLabelText('Username or email'), 'estimates@example.test');
    await user.type(screen.getByLabelText('Password'), PASSWORD);
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
    await user.click(screen.getByRole('button', { name: 'Save and sign in' }));
    expect(computerStartSignIn).toHaveBeenCalledWith({
      url: 'https://portal.carrier.example',
      label: undefined,
      credential: { username: 'estimates@example.test', password: PASSWORD, loginUrl: null },
    });
    expect(await screen.findByTestId('logins-auto-sign-in')).toHaveTextContent('asking for a verification code');
    expect(document.body.innerHTML).not.toContain(PASSWORD);
  });

  it('asks for both fields before saving a password', async () => {
    const user = userEvent.setup();
    computerLogins.mockResolvedValue(state({ passwords: ADMIN }));
    render(<LoginsPage />);
    await user.click(await screen.findByRole('button', { name: 'Add login' }));
    await user.click(await screen.findByTestId('logins-catalog-custom'));
    await user.type(screen.getByLabelText('Website address'), 'https://portal.example.test');
    await user.click(screen.getByRole('checkbox', { name: /Save a username and password/ }));
    await user.type(screen.getByLabelText('Username or email'), 'someone');
    await user.click(screen.getByRole('button', { name: 'Save and sign in' }));
    expect(await screen.findByText('Enter the username and password to save.')).toBeInTheDocument();
    expect(computerStartSignIn).not.toHaveBeenCalled();
  });

  it('turned off without the key: a plain message, no password fields', async () => {
    const user = userEvent.setup();
    const message = "Saving passwords isn't turned on for your account yet. You can still sign in yourself in the browser.";
    computerLogins.mockResolvedValue(state({ passwords: { enabled: false, message, canManage: true } }));
    render(<LoginsPage />);
    await user.click(await screen.findByRole('button', { name: 'Add login' }));
    await user.click(await screen.findByTestId('logins-catalog-custom'));
    expect(screen.getByTestId('logins-password-off')).toHaveTextContent(message);
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByLabelText('Password')).toBeNull();
    expect(screen.getByRole('button', { name: 'Open sign-in page' })).toBeEnabled();
  });

  it('catalog: grouped by category, searchable, with a Custom website option', async () => {
    const user = userEvent.setup();
    computerLogins.mockResolvedValue(state());
    render(<LoginsPage />);
    await user.click(await screen.findByRole('button', { name: 'Add login' }));
    const picker = await screen.findByTestId('logins-catalog');
    // The search bar is the first thing in the picker, focused and ready to type into.
    expect(screen.getByLabelText('Search sites')).toHaveFocus();
    expect(picker.querySelector('input')).toBe(screen.getByTestId('logins-catalog-search'));
    expect(screen.getByTestId('logins-catalog-count')).toHaveTextContent('5 sites');
    expect(within(picker).getByRole('region', { name: 'Email and calendar' })).toBeInTheDocument();
    expect(within(picker).getByRole('region', { name: 'Accounting and payments' })).toBeInTheDocument();
    expect(within(picker).getAllByText('Code at sign-in').length).toBeGreaterThan(0);
    expect(within(picker).getAllByText('Single sign-on').length).toBeGreaterThan(0);
    await user.type(screen.getByLabelText('Search sites'), 'qbo');
    expect(within(picker).getByTestId('logins-catalog-quickbooks')).toBeInTheDocument();
    expect(within(picker).queryByTestId('logins-catalog-outlook')).toBeNull();
    await user.clear(screen.getByLabelText('Search sites'));
    await user.type(screen.getByLabelText('Search sites'), 'team chat');
    expect(within(picker).getByTestId('logins-catalog-slack')).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Search sites'));
    await user.type(screen.getByLabelText('Search sites'), 'restoration');
    expect(within(picker).getByTestId('logins-catalog-encircle')).toBeInTheDocument();
    expect(within(picker).queryByTestId('logins-catalog-gmail')).toBeNull();
    expect(screen.getByTestId('logins-catalog-count')).toHaveTextContent('1 site matches');
    await user.clear(screen.getByLabelText('Search sites'));
    await user.type(screen.getByLabelText('Search sites'), 'nothing like this');
    expect(screen.getByTestId('logins-catalog-empty')).toHaveTextContent('Use Custom website');
    expect(screen.getByTestId('logins-catalog-custom')).toBeInTheDocument();
  });

  it('catalog pick as admin: URL filled in, password fields ready, the code note shown; password never rendered', async () => {
    const user = userEvent.setup();
    computerLogins.mockResolvedValueOnce(state({ passwords: ADMIN }));
    computerLogins.mockResolvedValue(state({ passwords: ADMIN, signingIn: { ...signIn, label: 'Gmail (Google)' } }));
    computerStartSignIn.mockResolvedValue({ signIn: { ...signIn, label: 'Gmail (Google)' } });
    render(<LoginsPage />);
    await user.click(await screen.findByRole('button', { name: 'Add login' }));
    await user.click(await screen.findByTestId('logins-catalog-gmail'));
    expect(screen.getByTestId('logins-ready-steps')).toHaveTextContent('Ready to go. Username, then Next, then password.');
    expect(screen.getByTestId('logins-two-step-note')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Save a username and password/ })).toBeChecked();
    expect(screen.getByLabelText('Sign-in page (optional)')).toHaveValue('https://mail.google.com/');
    await user.type(screen.getByLabelText('Username or email'), 'office@example.test');
    await user.type(screen.getByLabelText('Password'), PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Save and sign in' }));
    expect(computerStartSignIn).toHaveBeenCalledWith({
      url: 'https://mail.google.com/',
      label: 'Gmail (Google)',
      credential: { username: 'office@example.test', password: PASSWORD, loginUrl: 'https://mail.google.com/' },
    });
    expect(document.body.innerHTML).not.toContain(PASSWORD);
  });

  it('catalog unavailable: falls back to the custom website form', async () => {
    const user = userEvent.setup();
    computerLoginCatalog.mockRejectedValue(new Error('offline'));
    computerLogins.mockResolvedValue(state());
    render(<LoginsPage />);
    await user.click(await screen.findByRole('button', { name: 'Add login' }));
    expect(await screen.findByLabelText('Website address')).toBeInTheDocument();
    expect(screen.queryByTestId('logins-catalog')).toBeNull();
  });

  it('members see "Password saved" but no username, and cannot change or remove it', async () => {
    const user = userEvent.setup();
    computerLogins.mockResolvedValue(state({ logins: [outlook, { ...xactimate, credential: { ...xactimate.credential!, username: null } }], passwords: MEMBER }));
    computerStartSignIn.mockResolvedValue({ signIn: { ...signIn, loginId: 'l2' } });
    render(<LoginsPage />);
    const row = await screen.findByTestId('login-row-l2');
    expect(within(row).getByTestId('login-credential')).toHaveTextContent('Password saved');
    expect(within(row).queryByText(/estimates@/)).toBeNull();
    expect(within(row).queryByRole('button', { name: /password/i })).toBeNull();
    expect(within(row).queryByRole('button', { name: 'Remove' })).toBeNull();
    // Members can still remove sites without a saved password, and sign in again directly.
    expect(within(screen.getByTestId('login-row-l1')).getByRole('button', { name: 'Remove' })).toBeInTheDocument();
    await user.click(within(row).getByRole('button', { name: 'Sign in again' }));
    expect(computerStartSignIn).toHaveBeenCalledWith({ loginId: 'l2' });
  });

  it('admins see the username, can replace and delete the password', async () => {
    const user = userEvent.setup();
    computerLogins.mockResolvedValue(state({ logins: [xactimate], passwords: ADMIN }));
    computerSaveCredential.mockResolvedValue({ login: xactimate });
    computerDeleteCredential.mockResolvedValue({ deleted: true });
    render(<LoginsPage />);
    const row = await screen.findByTestId('login-row-l2');
    expect(within(row).getByTestId('login-credential')).toHaveTextContent('Password saved· estimates@example.test');
    await user.click(within(row).getByRole('button', { name: 'Replace password' }));
    await user.type(within(row).getByLabelText('Username or email'), 'new@example.test');
    await user.type(within(row).getByLabelText('Password'), PASSWORD);
    await user.click(within(row).getByRole('button', { name: 'Save password' }));
    expect(computerSaveCredential).toHaveBeenCalledWith('l2', { username: 'new@example.test', password: PASSWORD, loginUrl: null });
    expect(await screen.findByText('Password saved for Xactimate. Computer will sign in on its own.')).toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain(PASSWORD);

    await user.click(within(row).getByRole('button', { name: 'Delete password' }));
    await user.click(within(row).getByRole('button', { name: 'Delete password' }));
    expect(computerDeleteCredential).toHaveBeenCalledWith('l2');
  });

  it('Sign in again (admin) offers the save-password option first', async () => {
    const user = userEvent.setup();
    computerLogins.mockResolvedValue(state({ logins: [outlook], passwords: ADMIN }));
    computerStartSignIn.mockResolvedValue({ signIn: { ...signIn, loginId: 'l1' } });
    render(<LoginsPage />);
    const row = await screen.findByTestId('login-row-l1');
    await user.click(within(row).getByRole('button', { name: 'Sign in again' }));
    expect(within(row).getByRole('checkbox', { name: /Save a username and password/ })).not.toBeChecked();
    await user.click(within(row).getByRole('button', { name: 'Open sign-in page' }));
    expect(computerStartSignIn).toHaveBeenCalledWith({ loginId: 'l1' });
  });

  it('shows "Needs attention" with the reason when the saved password stopped working', async () => {
    computerLogins.mockResolvedValue(
      state({
        logins: [{ ...xactimate, credential: { ...xactimate.credential!, status: 'needs_attention', attentionReason: 'The saved password didn’t work on Oct 3.' } }],
        passwords: ADMIN,
      }),
    );
    render(<LoginsPage />);
    const row = await screen.findByTestId('login-row-l2');
    expect(within(row).getByTestId('login-needs-attention')).toHaveTextContent('Needs attention');
    expect(row).toHaveTextContent('The saved password didn’t work on Oct 3. Replace the password or sign in again.');
  });
});
