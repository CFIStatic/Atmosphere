import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComputerLogin, ComputerLoginsState, ComputerSignIn, LoginCatalog } from '../lib/computer';
import { Link, MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
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
    { id: 'suppliers', label: 'Suppliers', terms: ['supply', 'materials'] },
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
      id: 'google_calendar', name: 'Google Calendar', category: 'email_calendar',
      signInUrl: 'https://accounts.google.com/ServiceLogin?service=cl&continue=https://calendar.google.com/calendar/',
      host: 'calendar.google.com', aliases: ['gcal'], twoStep: 'likely', sso: true,
      logo: { text: 'GC', color: '#4285F4' }, termsNote: null, practice: [],
      signInSteps: 'Username, then Next, then password.',
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
    {
      id: 'homedepot', name: 'The Home Depot / Pro', category: 'suppliers', signInUrl: 'https://www.homedepot.com/auth/view/signin',
      host: 'www.homedepot.com', aliases: ['home depot', 'homedepot'], twoStep: 'sometimes', sso: false,
      logo: { text: 'HD', color: '#F96302' }, termsNote: null, practice: ['homedepot.supplier_search'],
      signInSteps: 'Username, then Next, then password. Computer fills in the saved login itself.',
    },
  ],
};


let scrollTo: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  computerLoginCatalog.mockResolvedValue(CATALOG);
  computerSignInLive.mockResolvedValue({ url: LIVE, expiresAt: new Date(Date.now() + 600_000).toISOString(), mode: 'control' });
  scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});

/** Like the app's sidebar rail (an iframe): it asks the app to navigate('/logins'), even when already there. */
function RailLogins() {
  const navigate = useNavigate();
  return (
    <>
      <button type="button" onClick={() => navigate('/logins')}>
        Rail Logins
      </button>
      <button type="button" onClick={() => navigate(-1)}>
        Browser Back
      </button>
    </>
  );
}

function Where() {
  const loc = useLocation();
  return <output data-testid="where">{`${loc.pathname}${loc.search}`}</output>;
}

/** The page inside a router, with a sidebar-style Logins link like the app shell's. */
function renderPage(entry = '/logins') {
  const user = userEvent.setup();
  render(
    <MemoryRouter initialEntries={[entry]}>
      <nav>
        <Link to="/logins">Sidebar Logins</Link>
        <RailLogins />
      </nav>
      <Where />
      <Routes>
        <Route path="/logins" element={<LoginsPage />} />
      </Routes>
    </MemoryRouter>,
  );
  return user;
}

const where = () => screen.getByTestId('where').textContent;

describe('LoginsPage', () => {
  it('one short intro line, a search box, the catalog; no saved list, no count, no badges', async () => {
    computerLogins.mockResolvedValue(state());
    renderPage();
    const picker = await screen.findByTestId('logins-catalog');
    expect(screen.getByTestId('logins-password-line')).toHaveTextContent(
      'Save your sign-ins once and Computer uses them for you. Passwords are encrypted and never seen by the AI.',
    );
    expect(screen.getByLabelText('Search sites')).toHaveFocus();
    expect(screen.queryByText('Websites')).toBeNull();
    expect(screen.queryByTestId('logins-catalog-count')).toBeNull();
    expect(screen.queryByText('Saved logins')).toBeNull();
    expect(screen.queryByTestId('logins-yours')).toBeNull();
    expect(within(picker).queryByText('Code at sign-in')).toBeNull();
    expect(within(picker).queryByText('Single sign-on')).toBeNull();
    // Tiles are logo + name only.
    expect(screen.getByTestId('logins-catalog-outlook')).toHaveTextContent(/^Outlook \(Microsoft 365\)$/);
    expect(screen.queryAllByTestId('logins-saved-check')).toHaveLength(0);
  });

  it('says when Computer is not set up and hides the site list', async () => {
    computerLogins.mockResolvedValue(state({ configured: false, message: 'Computer is not set up yet.' }));
    renderPage();
    expect(await screen.findByTestId('logins-not-set-up')).toHaveTextContent('not set up');
    expect(screen.queryByTestId('logins-catalog')).toBeNull();
  });

  it('saved sites come first under "Your logins" with the check, and are not repeated below', async () => {
    computerLogins.mockResolvedValue(state({ logins: [outlook, xactimate], passwords: ADMIN }));
    renderPage();
    const yours = await screen.findByTestId('logins-yours');
    const picker = screen.getByTestId('logins-catalog');
    expect(picker.querySelector('section')).toBe(yours);
    expect(within(yours).getByRole('heading', { name: 'Your logins' })).toBeInTheDocument();
    const o = within(yours).getByTestId('logins-catalog-outlook');
    expect(o).toHaveTextContent('Outlook (Microsoft 365)');
    expect(within(o).getByRole('img', { name: 'Saved' })).toBeInTheDocument();
    // A saved site outside the catalog (custom, e.g. Xactimate) is there too.
    const x = within(yours).getByTestId('logins-saved-l2');
    expect(x).toHaveTextContent('Xactimate');
    expect(within(x).getByRole('img', { name: 'Saved' })).toBeInTheDocument();
    expect(screen.getAllByTestId('logins-catalog-outlook')).toHaveLength(1);
    expect(screen.getAllByTestId('logins-saved-check')).toHaveLength(2);
    expect(within(picker).queryByText('Password saved')).toBeNull();
  });

  it('search filters your logins and the catalog together', async () => {
    computerLogins.mockResolvedValue(state({ logins: [xactimate] }));
    const user = renderPage();
    const picker = await screen.findByTestId('logins-catalog');
    await user.type(screen.getByLabelText('Search sites'), 'xact');
    expect(within(picker).getByTestId('logins-saved-l2')).toBeInTheDocument();
    expect(within(picker).queryByTestId('logins-catalog-outlook')).toBeNull();
    await user.clear(screen.getByLabelText('Search sites'));
    await user.type(screen.getByLabelText('Search sites'), 'qbo');
    expect(within(picker).getByTestId('logins-catalog-quickbooks')).toBeInTheDocument();
    expect(within(picker).queryByTestId('logins-yours')).toBeNull();
    await user.clear(screen.getByLabelText('Search sites'));
    await user.type(screen.getByLabelText('Search sites'), 'supply');
    expect(within(picker).getByTestId('logins-catalog-homedepot')).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Search sites'));
    await user.type(screen.getByLabelText('Search sites'), 'nothing like this');
    expect(screen.getByTestId('logins-catalog-empty')).toHaveTextContent('custom website');
    expect(screen.getByTestId('logins-catalog-custom')).toBeInTheDocument();
  });

  it('add form (admin): logo + name, email and password, Save; no URL, badges or instructions', async () => {
    computerLogins.mockResolvedValueOnce(state({ passwords: ADMIN }));
    computerLogins.mockResolvedValue(state({ passwords: ADMIN, signingIn: { ...signIn, label: 'Google Calendar' } }));
    computerStartSignIn.mockResolvedValue({ signIn: { ...signIn, label: 'Google Calendar' } });
    const user = renderPage();
    await user.click(await screen.findByTestId('logins-catalog-google_calendar'));
    expect(where()).toBe('/logins?site=google_calendar');
    const form = screen.getByTestId('logins-add-form');
    expect(within(form).getByRole('heading', { name: 'Google Calendar' })).toBeInTheDocument();
    expect(form).not.toHaveTextContent('accounts.google.com');
    expect(form).not.toHaveTextContent('Single sign-on');
    expect(form).not.toHaveTextContent('Ready to go');
    expect(within(form).queryByRole('checkbox')).toBeNull();
    expect(screen.getByTestId('logins-two-step-note')).toHaveTextContent('This site may send a code; Computer will ask you for it.');
    const email = within(form).getByLabelText('Email or username');
    expect(email).toHaveFocus();
    expect(email).toHaveAttribute('autocomplete', 'username');
    const pw = within(form).getByLabelText('Password');
    expect(pw).toHaveAttribute('type', 'password');
    expect(pw).toHaveAttribute('autocomplete', 'current-password');
    expect(within(form).queryByLabelText('Sign-in page')).toBeNull();
    await user.type(email, 'office@example.test');
    await user.type(pw, PASSWORD);
    await user.click(within(form).getByRole('button', { name: 'Show password' }));
    expect(pw).toHaveAttribute('type', 'text');
    await user.click(within(form).getByRole('button', { name: 'Hide password' }));
    expect(pw).toHaveAttribute('type', 'password');
    // Enter submits.
    await user.type(pw, '{Enter}');
    expect(computerStartSignIn).toHaveBeenCalledWith({
      url: CATALOG.sites[2]!.signInUrl,
      label: 'Google Calendar',
      credential: { username: 'office@example.test', password: PASSWORD, loginUrl: CATALOG.sites[2]!.signInUrl },
    });
    expect(await screen.findByTestId('logins-signing-in')).toBeInTheDocument();
    expect(where()).toBe('/logins');
    expect(document.body.innerHTML).not.toContain(PASSWORD);
  });

  it('add form: More options has the sign-in page and signing in without saving a password', async () => {
    computerLogins.mockResolvedValue(state({ passwords: ADMIN }));
    computerStartSignIn.mockResolvedValue({ signIn });
    const user = renderPage();
    await user.click(await screen.findByTestId('logins-catalog-gmail'));
    await user.click(screen.getByRole('button', { name: 'More options' }));
    expect(screen.getByLabelText('Sign-in page')).toHaveAttribute('placeholder', 'https://mail.google.com/');
    await user.click(screen.getByRole('button', { name: 'Sign in myself without saving a password' }));
    expect(computerStartSignIn).toHaveBeenCalledWith({ url: 'https://mail.google.com/', label: 'Gmail (Google)' });
  });

  it('add form asks for both fields before saving', async () => {
    computerLogins.mockResolvedValue(state({ passwords: ADMIN }));
    const user = renderPage();
    await user.click(await screen.findByTestId('logins-catalog-gmail'));
    await user.type(screen.getByLabelText('Email or username'), 'someone');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Enter the email and password.')).toBeInTheDocument();
    expect(computerStartSignIn).not.toHaveBeenCalled();
  });

  it('members: no password fields, one line, Open sign-in page; the live view opens and Done saves', async () => {
    computerLogins.mockResolvedValueOnce(state({ passwords: MEMBER }));
    computerStartSignIn.mockResolvedValue({ signIn });
    computerSignInDone.mockResolvedValue({ login: outlook });
    const user = renderPage();
    await user.click(await screen.findByTestId('logins-catalog-outlook'));
    expect(screen.getByTestId('logins-password-admin-only')).toBeInTheDocument();
    expect(screen.queryByLabelText('Password')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Open sign-in page' }));
    expect(computerStartSignIn).toHaveBeenCalledWith({ url: 'https://outlook.office.com/mail/', label: 'Outlook (Microsoft 365)' });
    const frame = await screen.findByTestId('computer-live-iframe');
    expect(frame).toHaveAttribute('src', LIVE);
    expect(computerSignInLive).toHaveBeenCalledWith('s1');
    computerLogins.mockResolvedValue(state({ logins: [outlook], passwords: MEMBER }));
    await user.click(screen.getByRole('button', { name: 'Done, I’m signed in' }));
    expect(await screen.findByText('Saved. Computer is signed in to Outlook.')).toBeInTheDocument();
    const yours = await screen.findByTestId('logins-yours');
    expect(within(within(yours).getByTestId('logins-catalog-outlook')).getByRole('img', { name: 'Saved' })).toBeInTheDocument();
  });

  it('turned off without the key: a plain message, no password fields', async () => {
    const message = "Saving passwords isn't turned on for your account yet. You can still sign in yourself in the browser.";
    computerLogins.mockResolvedValue(state({ passwords: { enabled: false, message, canManage: true } }));
    const user = renderPage();
    await user.click(await screen.findByTestId('logins-catalog-custom'));
    expect(screen.getByTestId('logins-password-off')).toHaveTextContent(message);
    expect(screen.queryByLabelText('Password')).toBeNull();
    expect(screen.getByRole('button', { name: 'Open sign-in page' })).toBeEnabled();
  });

  it('custom website: address, name, email and password in the same simple form', async () => {
    const started = { ...signIn, label: 'Carrier portal' };
    computerLogins.mockResolvedValueOnce(state({ passwords: ADMIN }));
    computerLogins.mockResolvedValue(state({ passwords: ADMIN, signingIn: started }));
    computerStartSignIn.mockResolvedValue({
      signIn: { ...started, autoSignIn: { outcome: 'two_factor', message: 'The saved password worked. The portal is asking for a verification code.' } },
    });
    const user = renderPage();
    await user.click(await screen.findByTestId('logins-catalog-custom'));
    expect(where()).toBe('/logins?add=custom');
    expect(screen.getByLabelText('Website address')).toHaveFocus();
    await user.type(screen.getByLabelText('Website address'), 'portal.carrier.example');
    await user.type(screen.getByLabelText('Name (optional)'), 'Carrier portal');
    await user.type(screen.getByLabelText('Email or username'), 'estimates@example.test');
    await user.type(screen.getByLabelText('Password'), PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(computerStartSignIn).toHaveBeenCalledWith({
      url: 'portal.carrier.example',
      label: 'Carrier portal',
      credential: { username: 'estimates@example.test', password: PASSWORD, loginUrl: null },
    });
    expect(await screen.findByTestId('logins-auto-sign-in')).toHaveTextContent('asking for a verification code');
    expect(document.body.innerHTML).not.toContain(PASSWORD);
  });

  it('Cancel and Esc return to the list and scroll to the top', async () => {
    computerLogins.mockResolvedValue(state({ passwords: ADMIN }));
    const user = renderPage();
    await user.type(await screen.findByLabelText('Search sites'), 'gmail');
    await user.click(screen.getByTestId('logins-catalog-gmail'));
    scrollTo.mockClear();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(where()).toBe('/logins');
    expect(screen.queryByTestId('logins-add-form')).toBeNull();
    expect(scrollTo).toHaveBeenCalledWith({ top: 0 });
    // Cancel goes back, so what you searched for is still there.
    expect(screen.getByLabelText('Search sites')).toHaveValue('gmail');
    await user.click(screen.getByTestId('logins-catalog-gmail'));
    await user.keyboard('{Escape}');
    expect(screen.queryByTestId('logins-add-form')).toBeNull();
    expect(where()).toBe('/logins');
  });

  it('the sidebar Logins link always resets to the site list (form or panel open), and Back closes too', async () => {
    computerLogins.mockResolvedValue(state({ logins: [outlook], passwords: ADMIN }));
    const user = renderPage();
    await user.type(await screen.findByLabelText('Search sites'), 'g');
    await user.click(screen.getByTestId('logins-catalog-gmail'));
    expect(screen.getByTestId('logins-add-form')).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Sidebar Logins' }));
    expect(where()).toBe('/logins');
    expect(screen.queryByTestId('logins-add-form')).toBeNull();
    expect(screen.getByTestId('logins-catalog')).toBeInTheDocument();
    expect(screen.getByLabelText('Search sites')).toHaveValue('');
    // Same for a saved site's panel.
    await user.click(screen.getByTestId('logins-catalog-outlook'));
    expect(screen.getByTestId('logins-manage')).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Sidebar Logins' }));
    expect(screen.queryByTestId('logins-manage')).toBeNull();
    // The rail's navigate('/logins') does the same.
    await user.click(screen.getByTestId('logins-catalog-outlook'));
    await user.click(screen.getByRole('button', { name: 'Rail Logins' }));
    expect(screen.queryByTestId('logins-manage')).toBeNull();
    expect(screen.getByTestId('logins-catalog')).toBeInTheDocument();
    // Browser Back from an open site returns to the list too.
    await user.click(screen.getByTestId('logins-catalog-gmail'));
    expect(screen.getByTestId('logins-add-form')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Browser Back' }));
    expect(where()).toBe('/logins');
    expect(screen.queryByTestId('logins-add-form')).toBeNull();
    // Clicking it on the list itself clears the search.
    await user.type(screen.getByLabelText('Search sites'), 'slack');
    await user.click(screen.getByRole('link', { name: 'Sidebar Logins' }));
    expect(screen.getByLabelText('Search sites')).toHaveValue('');
  });

  it('opens a site straight from the URL', async () => {
    computerLogins.mockResolvedValue(state({ logins: [outlook], passwords: ADMIN }));
    renderPage('/logins?site=outlook');
    // Outlook is saved, so its saved panel opens.
    expect(await screen.findByTestId('logins-manage')).toHaveAttribute('data-login-id', 'l1');
  });

  it('resumes your sign-in after a reload', async () => {
    computerLogins.mockResolvedValue(state({ signingIn: signIn }));
    renderPage();
    expect(await screen.findByTestId('logins-signing-in')).toBeInTheDocument();
    expect(await screen.findByTestId('computer-live-iframe')).toBeInTheDocument();
  });

  it('busy: new sites are disabled; a saved site still opens to manage it', async () => {
    computerLogins.mockResolvedValue(
      state({ logins: [outlook], busy: 'Computer is working on a task for your company right now.' }),
    );
    const user = renderPage();
    expect(await screen.findByTestId('logins-busy')).toHaveTextContent('working on a task');
    expect(screen.getByTestId('logins-catalog-section')).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByTestId('logins-catalog-gmail')).toBeDisabled();
    expect(screen.getByTestId('logins-catalog-custom')).toBeDisabled();
    await user.click(screen.getByTestId('logins-catalog-outlook'));
    expect(screen.getByRole('button', { name: 'Sign in again' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeEnabled();
  });

  it('saved panel: logo, name, email; Sign in again starts with the saved login', async () => {
    computerLogins.mockResolvedValue(state({ logins: [xactimate], passwords: ADMIN }));
    computerStartSignIn.mockResolvedValue({ signIn: { ...signIn, loginId: 'l2' } });
    const user = renderPage();
    await user.click(await screen.findByTestId('logins-saved-l2'));
    expect(where()).toBe('/logins?login=l2');
    const panel = screen.getByTestId('logins-manage');
    expect(within(panel).getByRole('heading', { name: /Xactimate/ })).toBeInTheDocument();
    expect(within(panel).getByTestId('login-credential')).toHaveTextContent('estimates@example.test');
    expect(within(panel).getByRole('button', { name: 'Change password' })).toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: 'Delete password (keep the site)' })).toBeNull();
    await user.click(within(panel).getByRole('button', { name: 'Sign in again' }));
    expect(computerStartSignIn).toHaveBeenCalledWith({ loginId: 'l2' });
    expect(await screen.findByTestId('logins-signing-in')).toBeInTheDocument();
  });

  it('Change password: email prefilled, saves, and Delete password sits under More options', async () => {
    computerLogins.mockResolvedValue(state({ logins: [xactimate], passwords: ADMIN }));
    computerSaveCredential.mockResolvedValue({ login: xactimate });
    computerDeleteCredential.mockResolvedValue({ deleted: true });
    const user = renderPage();
    await user.click(await screen.findByTestId('logins-saved-l2'));
    const panel = screen.getByTestId('logins-manage');
    await user.click(within(panel).getByRole('button', { name: 'Change password' }));
    const email = within(panel).getByLabelText('Email or username');
    expect(email).toHaveValue('estimates@example.test');
    await user.clear(email);
    await user.type(email, 'new@example.test');
    await user.type(within(panel).getByLabelText('Password'), PASSWORD);
    await user.click(within(panel).getByRole('button', { name: 'Save' }));
    expect(computerSaveCredential).toHaveBeenCalledWith('l2', { username: 'new@example.test', password: PASSWORD, loginUrl: null });
    expect(await screen.findByText('Password saved for Xactimate. Computer will sign in on its own.')).toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain(PASSWORD);

    await user.click(within(panel).getByRole('button', { name: 'More options' }));
    await user.click(within(panel).getByRole('button', { name: 'Delete password (keep the site)' }));
    await user.click(within(panel).getByRole('button', { name: 'Delete password' }));
    expect(computerDeleteCredential).toHaveBeenCalledWith('l2');
  });

  it('removes after a confirm, returns to the list and the check is gone without a reload', async () => {
    computerLogins.mockResolvedValueOnce(state({ logins: [outlook] }));
    computerRemoveLogin.mockResolvedValue({ removed: true, cookiesCleared: true, message: 'Removed Outlook. Computer is signed out of it.' });
    const user = renderPage();
    await user.click(await screen.findByTestId('logins-catalog-outlook'));
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(screen.getByText('Remove and sign Computer out of this site?')).toBeInTheDocument();
    computerLogins.mockResolvedValue(state());
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(computerRemoveLogin).toHaveBeenCalledWith('l1');
    expect(await screen.findByText('Removed Outlook. Computer is signed out of it.')).toBeInTheDocument();
    expect(where()).toBe('/logins');
    await waitFor(() => expect(screen.queryByTestId('logins-yours')).toBeNull());
    expect(within(screen.getByTestId('logins-catalog-outlook')).queryByRole('img', { name: 'Saved' })).toBeNull();
  });

  it('members see "Password saved" but no username, and cannot change or remove it', async () => {
    computerLogins.mockResolvedValue(state({ logins: [outlook, { ...xactimate, credential: { ...xactimate.credential!, username: null } }], passwords: MEMBER }));
    computerStartSignIn.mockResolvedValue({ signIn: { ...signIn, loginId: 'l2' } });
    const user = renderPage();
    await user.click(await screen.findByTestId('logins-catalog-outlook'));
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'All sites' }));
    await user.click(screen.getByTestId('logins-saved-l2'));
    const panel = screen.getByTestId('logins-manage');
    expect(within(panel).getByTestId('login-credential')).toHaveTextContent('Password saved');
    expect(within(panel).queryByText(/estimates@/)).toBeNull();
    expect(within(panel).queryByRole('button', { name: /password/i })).toBeNull();
    expect(within(panel).queryByRole('button', { name: 'More options' })).toBeNull();
    expect(within(panel).queryByRole('button', { name: 'Remove' })).toBeNull();
    await user.click(within(panel).getByRole('button', { name: 'Sign in again' }));
    expect(computerStartSignIn).toHaveBeenCalledWith({ loginId: 'l2' });
  });

  it('"Password needs attention" only when the saved password stopped working', async () => {
    computerLogins.mockResolvedValue(
      state({
        logins: [outlook, { ...xactimate, credential: { ...xactimate.credential!, status: 'needs_attention', attentionReason: 'The saved password didn’t work on Oct 3.' } }],
        passwords: ADMIN,
      }),
    );
    const user = renderPage();
    const tile = await screen.findByTestId('logins-saved-l2');
    expect(within(tile).getByTestId('logins-tile-attention')).toHaveTextContent('Password needs attention');
    expect(within(screen.getByTestId('logins-catalog-outlook')).queryByTestId('logins-tile-attention')).toBeNull();
    await user.click(tile);
    expect(screen.getByTestId('login-needs-attention')).toHaveTextContent(
      'Password needs attention. The saved password didn’t work on Oct 3. Change the password or sign in again.',
    );
  });

  it('catalog unavailable: says so; saved sites and Custom website still work', async () => {
    computerLoginCatalog.mockRejectedValue(new Error('offline'));
    computerLogins.mockResolvedValue(state({ logins: [outlook] }));
    const user = renderPage();
    expect(await screen.findByTestId('logins-catalog-failed')).toBeInTheDocument();
    expect(within(screen.getByTestId('logins-saved-l1')).getByRole('img', { name: 'Saved' })).toBeInTheDocument();
    await user.click(screen.getByTestId('logins-catalog-custom'));
    expect(await screen.findByLabelText('Website address')).toBeInTheDocument();
  });
});
