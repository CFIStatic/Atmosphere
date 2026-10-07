import { ChevronDown, ChevronLeft, Eye, EyeOff } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { useLocation, useNavigate, useNavigationType, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import {
  type ComputerCredentialInput,
  type ComputerLogin,
  type ComputerLoginsState,
  type ComputerSignIn,
  type LoginCatalog,
  type LoginCatalogEntry,
  matchSavedLogins,
} from '../lib/computer';
import {
  CODE_LINE,
  HostLogo,
  LoginCatalogPicker,
  SavedCheck,
  SiteLogo,
  type SavedEntry,
} from '../components/computer/LoginCatalogPicker';
import { ComputerLiveView } from '../components/computer/ComputerLiveView';
import { ErrorNote, PanelSpinner } from '../components/AppShell';

const INTRO_LINE =
  'Save your sign-ins once and Computer uses them for you. Passwords are encrypted and never seen by the AI.';

const inputClass =
  'mt-1 w-full rounded-lg border border-line bg-paper-0 px-3 py-2.5 text-base text-ink-900 outline-none transition placeholder:text-ink-500 focus:border-brand-600 sm:text-sm';
const labelClass = 'block text-xs font-medium text-ink-700';
const primaryButton =
  'rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-ink-900 transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50';
const secondaryButton =
  'rounded-lg border border-line bg-paper-0 px-4 py-2 text-sm font-medium text-ink-700 transition hover:border-brand-200 disabled:cursor-not-allowed disabled:opacity-50';
const dangerButton =
  'rounded-lg bg-danger-600 px-4 py-2 text-sm font-semibold text-paper-0 transition hover:bg-danger-700 disabled:opacity-50';
const linkButton = 'text-xs font-semibold text-brand-700 hover:underline';

/** What happened when Computer typed the saved password in for this sign-in. */
function autoSignInNote(outcome: string, message: string): string {
  if (outcome === 'signed_in' || outcome === 'already_signed_in') {
    return `${message} Check the browser below, then press Done.`;
  }
  if (outcome === 'two_factor') return `${message} Enter it below, then press Done.`;
  if (outcome === 'captcha') return `${message} Complete it below, then press Done.`;
  if (outcome === 'failed')
    return `${message} Sign in yourself below. You can replace the saved password afterwards.`;
  return `${message} Finish signing in below, then press Done.`;
}

function errorText(err: unknown, fallback: string): string {
  if (err instanceof ApiError || err instanceof Error) return err.message || fallback;
  return fallback;
}

/**
 * Back to the top of the page. The page scrolls the window on desktop, but inside the phone
 * shell it scrolls an inner container, so reset every scrolled ancestor too.
 */
function scrollToTop(from?: HTMLElement | null) {
  for (let el = from?.parentElement ?? null; el; el = el.parentElement) {
    if (el.scrollTop > 0) el.scrollTop = 0;
  }
  try {
    window.scrollTo({ top: 0 });
  } catch {
    /* not available (tests) */
  }
}

/** Password field with a show/hide toggle. Autocomplete lets password managers fill it. */
function PasswordInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const [shown, setShown] = useState(false);
  return (
    <label className={labelClass}>
      Password
      <span className="relative block">
        <input
          type={shown ? 'text' : 'password'}
          name="password"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          maxLength={512}
          className={`${inputClass} pr-11`}
          autoComplete="current-password"
          spellCheck={false}
        />
        <button
          type="button"
          onClick={() => setShown((v) => !v)}
          aria-label={shown ? 'Hide password' : 'Show password'}
          className="absolute right-1.5 top-1/2 mt-0.5 -translate-y-1/2 rounded-md p-1.5 text-ink-500 hover:text-ink-900"
        >
          {shown ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </span>
    </label>
  );
}

function UsernameInput({
  value,
  onChange,
  autoFocus,
}: {
  value: string;
  onChange: (next: string) => void;
  autoFocus?: boolean;
}) {
  return (
    <label className={labelClass}>
      Email or username
      <input
        type="text"
        name="username"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={256}
        className={inputClass}
        autoComplete="username"
        autoCapitalize="none"
        spellCheck={false}
        autoFocus={autoFocus}
      />
    </label>
  );
}

/** "More options": a small disclosure for the rarely needed bits. */
function MoreOptions({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex items-center gap-1 text-xs font-medium text-ink-600 hover:text-ink-900"
      >
        More options
        <ChevronDown className={`h-3.5 w-3.5 transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open ? <div className="mt-2 space-y-3">{children}</div> : null}
    </div>
  );
}

function BackToList({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="-ml-1 inline-flex items-center gap-0.5 text-xs font-semibold text-ink-600 hover:text-ink-900"
    >
      <ChevronLeft className="h-4 w-4" />
      All sites
    </button>
  );
}

const cardClass = 'max-w-xl rounded-2xl border border-line bg-paper-0 p-4 sm:p-5';

interface Credentials {
  username: string;
  password: string;
  loginUrl: string;
}
const EMPTY_CREDS: Credentials = { username: '', password: '', loginUrl: '' };

function credentialOf(c: Credentials, fallbackLoginUrl: string | null) {
  const username = c.username.trim();
  if (!username || !c.password) return null;
  return {
    username,
    password: c.password,
    loginUrl: c.loginUrl.trim() || fallbackLoginUrl,
  } satisfies ComputerCredentialInput;
}

/** The compact add-login form for a catalog site, or (site = null) a custom website. */
function AddLoginForm({
  site,
  canSavePasswords,
  passwordsNote,
  busy,
  canStart,
  onStart,
  onCancel,
  onError,
}: {
  site: LoginCatalogEntry | null;
  canSavePasswords: boolean;
  passwordsNote: ReactNode;
  busy: boolean;
  canStart: boolean;
  onStart: (input: { url: string; label?: string; credential?: ComputerCredentialInput }) => void;
  onCancel: () => void;
  onError: (message: string) => void;
}) {
  const [creds, setCreds] = useState<Credentials>(EMPTY_CREDS);
  const [url, setUrl] = useState('');
  const [label, setLabel] = useState('');

  function target(): { url: string; label?: string } | null {
    if (site) return { url: site.signInUrl, label: site.name };
    const trimmed = url.trim();
    if (!trimmed) {
      onError('Enter the web address of the site.');
      return null;
    }
    return { url: trimmed, label: label.trim() || undefined };
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const t = target();
    if (!t) return;
    if (!canSavePasswords) {
      onStart(t);
      return;
    }
    const credential = credentialOf(creds, site ? site.signInUrl : null);
    if (!credential) {
      onError('Enter the email and password.');
      return;
    }
    onStart({ ...t, credential });
  }

  function withoutPassword() {
    const t = target();
    if (t) onStart(t);
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  }

  return (
    <form
      onSubmit={submit}
      onKeyDown={onKeyDown}
      noValidate
      className={cardClass}
      aria-label={site ? `Add ${site.name}` : 'Add a custom website'}
      data-testid="logins-add-form"
    >
      <BackToList onClick={onCancel} />
      <div className="mt-3 flex items-center gap-3">
        {site ? (
          <SiteLogo site={site} size="lg" />
        ) : (
          <span
            aria-hidden="true"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-paper-50 text-lg font-bold text-ink-700"
          >
            +
          </span>
        )}
        <h2 className="min-w-0 truncate text-base font-semibold text-ink-900">
          {site ? site.name : 'Custom website'}
        </h2>
      </div>

      <div className="mt-4 grid gap-3">
        {site ? null : (
          <>
            <label className={labelClass}>
              Website address
              <input
                type="text"
                inputMode="url"
                name="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="portal.example.com"
                className={inputClass}
                autoComplete="url"
                autoCapitalize="none"
                spellCheck={false}
                autoFocus
              />
            </label>
            <label className={labelClass}>
              Name (optional)
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Carrier portal"
                maxLength={80}
                className={inputClass}
                autoComplete="off"
              />
            </label>
          </>
        )}
        {canSavePasswords ? (
          <>
            <UsernameInput
              value={creds.username}
              onChange={(username) => setCreds({ ...creds, username })}
              autoFocus={Boolean(site)}
            />
            <PasswordInput
              value={creds.password}
              onChange={(password) => setCreds({ ...creds, password })}
            />
          </>
        ) : null}
      </div>

      {passwordsNote}
      {site?.twoStep === 'likely' ? (
        <p className="mt-3 text-xs text-ink-500" data-testid="logins-two-step-note">
          {CODE_LINE}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button type="submit" disabled={busy || !canStart} className={primaryButton}>
          {busy ? 'Opening…' : canSavePasswords ? 'Save' : 'Open sign-in page'}
        </button>
        <button type="button" onClick={onCancel} className={secondaryButton}>
          Cancel
        </button>
      </div>

      {canSavePasswords ? (
        <MoreOptions>
          <label className={labelClass}>
            Sign-in page
            <input
              type="text"
              inputMode="url"
              value={creds.loginUrl}
              onChange={(e) => setCreds({ ...creds, loginUrl: e.target.value })}
              placeholder={site?.signInUrl ?? 'https://portal.example.com/login'}
              className={inputClass}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
            />
          </label>
          <button
            type="button"
            onClick={withoutPassword}
            disabled={busy || !canStart}
            className={linkButton}
          >
            Sign in myself without saving a password
          </button>
        </MoreOptions>
      ) : null}
    </form>
  );
}

/** A saved site: who it signs in as, and the few things you can do with it. */
function ManageLogin({
  login,
  site,
  passwords,
  working,
  canStart,
  onBack,
  onSignIn,
  onSavePassword,
  onRemove,
  onForget,
  onError,
}: {
  login: ComputerLogin;
  site: LoginCatalogEntry | null;
  passwords: ComputerLoginsState['passwords'];
  working: string | null;
  canStart: boolean;
  onBack: () => void;
  onSignIn: () => void;
  onSavePassword: (credential: ComputerCredentialInput) => Promise<boolean>;
  onRemove: () => void;
  onForget: () => Promise<boolean>;
  onError: (message: string) => void;
}) {
  const cred = login.credential;
  const attention = cred?.status === 'needs_attention';
  const canManage = Boolean(passwords?.canManage);
  const canSavePasswords = Boolean(passwords?.canManage && passwords.enabled);
  // Removing a site deletes its saved password, so that takes a Global Admin.
  const canRemove = !cred || canManage;
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState<'remove' | 'forget' | null>(null);
  const [creds, setCreds] = useState<Credentials>(EMPTY_CREDS);

  function openEdit() {
    setConfirm(null);
    setCreds({ username: cred?.username ?? '', password: '', loginUrl: cred?.loginUrl ?? '' });
    setEditing(true);
  }

  async function submitEdit(e: FormEvent) {
    e.preventDefault();
    const credential = credentialOf(creds, null);
    if (!credential) {
      onError('Enter the email and password.');
      return;
    }
    if (await onSavePassword(credential)) setEditing(false);
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    if (editing) setEditing(false);
    else if (confirm) setConfirm(null);
    else onBack();
  }

  const who = cred ? (cred.username ?? 'Password saved') : 'No password saved';

  return (
    <section
      className={cardClass}
      aria-label={`Saved site: ${login.label}`}
      data-testid="logins-manage"
      data-login-id={login.id}
      onKeyDown={onKeyDown}
    >
      <BackToList onClick={onBack} />
      <div className="mt-3 flex items-center gap-3">
        {site ? (
          <SiteLogo site={site} size="lg" />
        ) : (
          <HostLogo host={login.host} name={login.label} size="lg" />
        )}
        <div className="min-w-0">
          <h2 className="flex items-center gap-1.5 text-base font-semibold text-ink-900">
            <span className="truncate">{site?.name ?? login.label}</span>
            <SavedCheck />
          </h2>
          <p className="truncate text-sm text-ink-600" data-testid="login-credential">
            {who}
          </p>
        </div>
      </div>
      {attention ? (
        <p className="mt-3 text-sm text-danger-700" data-testid="login-needs-attention">
          <span className="font-semibold">Password needs attention.</span>{' '}
          {cred?.attentionReason ?? ''}{' '}
          {canManage ? 'Change the password or sign in again.' : 'Ask a Global Admin to update it.'}
        </p>
      ) : null}

      {editing ? (
        <form
          onSubmit={(e) => void submitEdit(e)}
          noValidate
          className="mt-4 grid gap-3"
          aria-label={`Change password for ${login.label}`}
          data-testid="login-row-panel"
        >
          <UsernameInput
            value={creds.username}
            onChange={(username) => setCreds({ ...creds, username })}
            autoFocus={!creds.username}
          />
          <PasswordInput
            value={creds.password}
            onChange={(password) => setCreds({ ...creds, password })}
          />
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" disabled={working !== null} className={primaryButton}>
              {working === `password:${login.id}` ? 'Saving…' : 'Save'}
            </button>
            <button type="button" onClick={() => setEditing(false)} className={secondaryButton}>
              Cancel
            </button>
          </div>
          <MoreOptions>
            <label className={labelClass}>
              Sign-in page
              <input
                type="text"
                inputMode="url"
                value={creds.loginUrl}
                onChange={(e) => setCreds({ ...creds, loginUrl: e.target.value })}
                placeholder={site?.signInUrl ?? login.url}
                className={inputClass}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
              />
            </label>
          </MoreOptions>
        </form>
      ) : confirm ? (
        <div className="mt-4" role="group" aria-label="Confirm">
          <p className="text-sm text-ink-700">
            {confirm === 'forget'
              ? 'Delete the saved password? Computer stays signed in for now.'
              : cred
                ? 'Remove, delete its saved password and sign Computer out?'
                : login.canClearCookies
                  ? 'Remove and sign Computer out of this site?'
                  : 'Remove from the list? Computer may stay signed in.'}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() =>
                confirm === 'forget'
                  ? void onForget().then((ok) => ok && setConfirm(null))
                  : onRemove()
              }
              disabled={working !== null}
              className={dangerButton}
            >
              {confirm === 'forget'
                ? working === `forget:${login.id}`
                  ? 'Deleting…'
                  : 'Delete password'
                : working === `remove:${login.id}`
                  ? 'Removing…'
                  : 'Remove'}
            </button>
            <button type="button" onClick={() => setConfirm(null)} className={secondaryButton}>
              Keep
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button type="button" onClick={onSignIn} disabled={!canStart} className={primaryButton}>
              {working === 'start' ? 'Opening…' : 'Sign in again'}
            </button>
            {canSavePasswords ? (
              <button
                type="button"
                onClick={openEdit}
                disabled={working !== null}
                className={secondaryButton}
              >
                {cred ? 'Change password' : 'Save password'}
              </button>
            ) : null}
            {canRemove ? (
              <button
                type="button"
                onClick={() => setConfirm('remove')}
                disabled={working !== null}
                className={`${secondaryButton} hover:border-danger-200 hover:text-danger-700`}
              >
                Remove
              </button>
            ) : null}
          </div>
          {cred && canManage ? (
            <MoreOptions>
              <button
                type="button"
                onClick={() => setConfirm('forget')}
                disabled={working !== null}
                className="text-xs font-semibold text-danger-700 hover:underline disabled:opacity-50"
              >
                Delete password (keep the site)
              </button>
            </MoreOptions>
          ) : null}
        </>
      )}
    </section>
  );
}

/**
 * Logins: sign the company's Computer browser in to outside sites ahead of time. One site list:
 * saved sites first ("Your logins", checked), then the catalog, then Custom website. Picking a
 * site opens a compact form; the open site lives in the URL (?site= / ?login= / ?add=custom),
 * so the sidebar's Logins link and the browser's Back button return to the list. No AI runs here.
 */
export function LoginsPage() {
  const [state, setState] = useState<ComputerLoginsState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<LoginCatalog | null>(null);
  const [catalogFailed, setCatalogFailed] = useState(false);
  const [query, setQuery] = useState('');
  const [autoNote, setAutoNote] = useState<{
    sessionId: string;
    outcome: string;
    text: string;
  } | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigationType = useNavigationType();
  const navigate = useNavigate();
  const openSiteId = params.get('site');
  const openLoginId = params.get('login');
  const openCustom = params.get('add') === 'custom';
  const selectionKey = `${openSiteId ?? ''}|${openLoginId ?? ''}|${openCustom ? 'c' : ''}`;
  const hasSelection = Boolean(openSiteId || openLoginId || openCustom);

  const load = useCallback(async () => {
    try {
      const next = await api.computerLogins();
      setState(next);
      setLoadError(null);
    } catch (err) {
      setLoadError(errorText(err, 'Could not load your logins.'));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    api
      .computerLogins()
      .then((next) => {
        if (!cancelled) setState(next);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(errorText(err, 'Could not load your logins.'));
      });
    api
      .computerLoginCatalog()
      .then((next) => {
        if (!cancelled) {
          setCatalog(next);
          setCatalogFailed(false);
        }
      })
      .catch(() => {
        if (!cancelled) setCatalogFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Opening or closing a site starts at the top of the page.
  useEffect(() => {
    scrollToTop(rootRef.current);
  }, [selectionKey]);

  // A fresh visit to the list (the sidebar's Logins link, even when already here) starts clean.
  // Back (POP) keeps what you typed in the search.
  const [seenLocation, setSeenLocation] = useState(location.key);
  if (seenLocation !== location.key) {
    setSeenLocation(location.key);
    if (!hasSelection && navigationType !== 'POP') setQuery('');
  }

  // Someone else is signing in (or a task is running): check back so the
  // page frees up when they finish.
  const othersBusy = Boolean(
    state && (state.busy || (state.signingIn && !state.signingIn.startedByYou)),
  );
  useEffect(() => {
    if (!othersBusy) return;
    const id = window.setInterval(() => void load(), 15_000);
    return () => window.clearInterval(id);
  }, [othersBusy, load]);

  const logins = useMemo(() => state?.logins ?? [], [state]);
  const savedMatch = useMemo(() => matchSavedLogins(catalog, logins), [catalog, logins]);
  const savedEntries: SavedEntry[] = useMemo(() => {
    const siteOf = new Map<string, LoginCatalogEntry>();
    for (const [siteId, login] of savedMatch.bySite) {
      const site = catalog?.sites.find((s) => s.id === siteId);
      if (site) siteOf.set(login.id, site);
    }
    return logins.map((login) => ({ login, site: siteOf.get(login.id) ?? null }));
  }, [catalog, logins, savedMatch]);

  const mySignIn: ComputerSignIn | null = state?.signingIn?.startedByYou ? state.signingIn : null;
  const passwords = state?.passwords;
  const canSavePasswords = Boolean(passwords?.canManage && passwords.enabled);
  const canStart =
    Boolean(state?.configured) && !state?.busy && !state?.signingIn && working === null;

  function openParams(next: Record<string, string>) {
    setActionError(null);
    setNotice(null);
    setParams(next, { state: { fromList: true } });
  }

  /** Back to the list: undo the open (so Back doesn't reopen it), or replace when opened by link. */
  function goList() {
    const fromList = (location.state as { fromList?: boolean } | null)?.fromList;
    if (fromList && hasSelection) navigate(-1);
    else setParams({}, { replace: true });
    scrollToTop(rootRef.current);
  }

  function cancelToList() {
    setActionError(null);
    goList();
  }

  async function start(input: {
    url?: string;
    label?: string;
    loginId?: string;
    credential?: ComputerCredentialInput;
  }) {
    setActionError(null);
    setNotice(null);
    setWorking('start');
    try {
      const { signIn } = await api.computerStartSignIn(input);
      setState((prev) => (prev ? { ...prev, signingIn: signIn, busy: null } : prev));
      setAutoNote(
        signIn.autoSignIn
          ? {
              sessionId: signIn.sessionId,
              outcome: signIn.autoSignIn.outcome,
              text: autoSignInNote(signIn.autoSignIn.outcome, signIn.autoSignIn.message),
            }
          : null,
      );
      setParams({}, { replace: true });
      if (input.credential) void load();
    } catch (err) {
      setActionError(errorText(err, 'Could not open the sign-in page.'));
      void load();
    } finally {
      setWorking(null);
    }
  }

  async function done(signIn: ComputerSignIn) {
    setActionError(null);
    setWorking('done');
    try {
      const { login } = await api.computerSignInDone(signIn.sessionId);
      setNotice(`Saved. Computer is signed in to ${login.label}.`);
    } catch (err) {
      setActionError(errorText(err, 'Could not save this login.'));
    } finally {
      setWorking(null);
      void load();
    }
  }

  async function cancel(signIn: ComputerSignIn) {
    setActionError(null);
    setWorking('cancel');
    try {
      await api.computerSignInCancel(signIn.sessionId);
    } catch (err) {
      setActionError(errorText(err, 'Could not close the browser.'));
    } finally {
      setWorking(null);
      void load();
    }
  }

  async function remove(login: ComputerLogin) {
    setActionError(null);
    setNotice(null);
    setWorking(`remove:${login.id}`);
    try {
      const result = await api.computerRemoveLogin(login.id);
      setNotice(result.message);
      goList();
    } catch (err) {
      setActionError(errorText(err, 'Could not remove this login.'));
    } finally {
      setWorking(null);
      void load();
    }
  }

  async function savePassword(login: ComputerLogin, credential: ComputerCredentialInput) {
    setActionError(null);
    setNotice(null);
    setWorking(`password:${login.id}`);
    try {
      await api.computerSaveCredential(login.id, credential);
      setNotice(`Password saved for ${login.label}. Computer will sign in on its own.`);
      return true;
    } catch (err) {
      setActionError(errorText(err, 'Could not save the password.'));
      return false;
    } finally {
      setWorking(null);
      void load();
    }
  }

  async function forgetPassword(login: ComputerLogin) {
    setActionError(null);
    setNotice(null);
    setWorking(`forget:${login.id}`);
    try {
      await api.computerDeleteCredential(login.id);
      setNotice(`Deleted the saved password for ${login.label}.`);
      return true;
    } catch (err) {
      setActionError(errorText(err, 'Could not delete the password.'));
      return false;
    } finally {
      setWorking(null);
      void load();
    }
  }

  if (!state && !loadError) {
    return (
      <div className="flex justify-center py-16">
        <PanelSpinner label="Loading logins" />
      </div>
    );
  }

  // What's open, from the URL. A catalog site that's already saved opens its saved login.
  const openSite = openSiteId ? (catalog?.sites.find((s) => s.id === openSiteId) ?? null) : null;
  const openLogin =
    (openLoginId ? logins.find((l) => l.id === openLoginId) : null) ??
    (openSite ? savedMatch.bySite.get(openSite.id) : null) ??
    null;
  const openLoginSite = openLogin
    ? (savedEntries.find((e) => e.login.id === openLogin.id)?.site ?? null)
    : null;
  const waitingForCatalog = Boolean(openSiteId && !catalog && !catalogFailed);
  const showList = Boolean(state?.configured) && !mySignIn;

  const passwordsNote = !passwords?.canManage ? (
    passwords?.enabled ? (
      <p className="mt-3 text-xs text-ink-500" data-testid="logins-password-admin-only">
        Only a Global Admin can save passwords. You can still sign in yourself.
      </p>
    ) : null
  ) : !passwords.enabled ? (
    <p className="mt-3 text-xs text-ink-500" data-testid="logins-password-off">
      {passwords.message ?? 'Saving passwords isn’t turned on yet.'}
    </p>
  ) : null;

  let body: ReactNode = null;
  if (showList) {
    if (openLogin) {
      body = (
        <ManageLogin
          key={openLogin.id}
          login={openLogin}
          site={openLoginSite}
          passwords={passwords}
          working={working}
          canStart={canStart}
          onBack={cancelToList}
          onSignIn={() => void start({ loginId: openLogin.id })}
          onSavePassword={(credential) => savePassword(openLogin, credential)}
          onRemove={() => void remove(openLogin)}
          onForget={() => forgetPassword(openLogin)}
          onError={setActionError}
        />
      );
    } else if (openSite || openCustom) {
      body = (
        <AddLoginForm
          key={openSite?.id ?? 'custom'}
          site={openSite}
          canSavePasswords={canSavePasswords}
          passwordsNote={passwordsNote}
          busy={working === 'start'}
          canStart={canStart}
          onStart={(input) => void start(input)}
          onCancel={cancelToList}
          onError={setActionError}
        />
      );
    } else if (waitingForCatalog) {
      body = (
        <div className="flex justify-center py-10">
          <PanelSpinner label="Loading sites" />
        </div>
      );
    } else {
      body = (
        <section
          aria-label="Sites"
          data-testid="logins-catalog-section"
          aria-disabled={!canStart}
        >
          {catalogFailed ? (
            <p className="mb-3 text-sm text-ink-600" data-testid="logins-catalog-failed">
              Couldn’t load the site list. You can still add a custom website.
            </p>
          ) : null}
          {catalog || catalogFailed ? (
            <LoginCatalogPicker
              catalog={catalog}
              savedEntries={savedEntries}
              query={query}
              onQueryChange={setQuery}
              onPick={(site) => openParams({ site: site.id })}
              onPickLogin={(login) => openParams({ login: login.id })}
              onCustom={() => openParams({ add: 'custom' })}
              disabled={!canStart}
            />
          ) : (
            <div className="flex justify-center py-10">
              <PanelSpinner label="Loading sites" />
            </div>
          )}
        </section>
      );
    }
  }

  return (
    <div ref={rootRef} className="mx-auto w-full max-w-4xl" data-testid="logins-page">
      <header>
        <h1 className="text-xl font-semibold text-ink-900">Logins</h1>
        <p className="mt-1 text-sm text-ink-600" data-testid="logins-password-line">
          {INTRO_LINE}
        </p>
      </header>

      {loadError ? (
        <div className="mt-4">
          <ErrorNote message={loadError} />
        </div>
      ) : null}

      {state && !state.configured ? (
        <p
          className="mt-4 rounded-xl border border-line bg-paper-50 px-4 py-3 text-sm text-ink-700"
          data-testid="logins-not-set-up"
        >
          {state.message ?? 'Computer is not set up for your company yet.'}
        </p>
      ) : null}

      {state?.busy && !mySignIn ? (
        <p
          className="mt-4 rounded-xl border border-caution-200 bg-caution-50 px-4 py-3 text-sm text-ink-800"
          role="status"
          data-testid="logins-busy"
        >
          {state.busy}
        </p>
      ) : null}

      {notice ? (
        <p
          className="mt-4 rounded-xl border border-success-200 bg-success-50 px-4 py-3 text-sm text-ink-800"
          role="status"
        >
          {notice}
        </p>
      ) : null}

      {actionError ? (
        <div className="mt-4">
          <ErrorNote message={actionError} />
        </div>
      ) : null}

      {body ? <div className="mt-5">{body}</div> : null}

      {mySignIn ? (
        <section
          className="mt-5 rounded-xl border border-brand-200 bg-paper-0 p-4"
          data-testid="logins-signing-in"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-ink-900">Signing in to {mySignIn.label}</h2>
              {autoNote && autoNote.sessionId === mySignIn.sessionId ? (
                <p
                  className={`mt-1 text-sm ${autoNote.outcome === 'failed' ? 'text-danger-700' : 'text-ink-700'}`}
                  role="status"
                  data-testid="logins-auto-sign-in"
                >
                  {autoNote.text}
                </p>
              ) : (
                <p className="mt-1 text-sm text-ink-600">
                  Sign in below the way you normally do. When you see your inbox or home page, press
                  Done.
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void done(mySignIn)}
                disabled={working !== null}
                className={primaryButton}
              >
                {working === 'done' ? 'Saving…' : 'Done, I’m signed in'}
              </button>
              <button
                type="button"
                onClick={() => void cancel(mySignIn)}
                disabled={working !== null}
                className={secondaryButton}
              >
                Cancel
              </button>
            </div>
          </div>
          <div className="mt-3">
            <ComputerLiveView
              taskId={mySignIn.sessionId}
              mode="control"
              mint={() => api.computerSignInLive(mySignIn.sessionId)}
              onClose={() => void cancel(mySignIn)}
              controlHint={`You have control of the browser. What you type here goes to the site, not to Atmosphere’s AI. The browser closes on its own at ${new Date(
                mySignIn.expiresAt,
              ).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`}
            />
          </div>
        </section>
      ) : null}

      {state?.signingIn && !state.signingIn.startedByYou ? (
        <p className="mt-4 text-xs text-ink-600">
          Someone on your team is signing in to {state.signingIn.label} right now.
        </p>
      ) : null}
    </div>
  );
}
