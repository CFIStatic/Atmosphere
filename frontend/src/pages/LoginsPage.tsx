import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, ApiError, timeAgo } from '../lib/api';
import {
  type ComputerCredentialInput,
  type ComputerLogin,
  type ComputerLoginsState,
  type ComputerSignIn,
  type LoginCatalog,
  type LoginCatalogEntry,
} from '../lib/computer';
import {
  LoginCatalogPicker,
  SiteBadges,
  SiteLogo,
  SSO_LINE,
  TWO_STEP_LINE,
} from '../components/computer/LoginCatalogPicker';
import { ComputerLiveView } from '../components/computer/ComputerLiveView';
import { ErrorNote, PanelSpinner } from '../components/AppShell';

const PASSWORD_LINE =
  'Passwords are encrypted and only used to sign Computer in. Atmosphere’s AI never sees them.';

const inputClass =
  'mt-1 w-full rounded-lg border border-line bg-paper-0 px-3 py-2 text-sm text-ink-900 outline-none focus:border-brand-600';

interface CredentialDraft {
  save: boolean;
  username: string;
  password: string;
  loginUrl: string;
}
const EMPTY_DRAFT: CredentialDraft = { save: false, username: '', password: '', loginUrl: '' };

/** What the page shows about saving passwords: the option (admins), why it's off, or nothing. */
function CredentialFields({
  draft,
  onChange,
  passwords,
  alwaysOn = false,
  existingUsername,
}: {
  draft: CredentialDraft;
  onChange: (next: CredentialDraft) => void;
  passwords: ComputerLoginsState['passwords'];
  /** Password-only form: no checkbox, the fields are always shown. */
  alwaysOn?: boolean;
  existingUsername?: string | null;
}) {
  if (!passwords?.canManage) {
    return passwords?.enabled ? (
      <p className="mt-3 text-xs text-ink-600" data-testid="logins-password-admin-only">
        Only a Global Admin can save a username and password for a site.
      </p>
    ) : null;
  }
  if (!passwords.enabled) {
    return (
      <p
        className="mt-3 rounded-lg bg-paper-50 px-3 py-2 text-xs text-ink-700"
        data-testid="logins-password-off"
      >
        {passwords.message ?? 'Saving passwords isn’t turned on yet.'}
      </p>
    );
  }
  const show = alwaysOn || draft.save;
  return (
    <div
      className="mt-3 rounded-lg border border-line bg-paper-50 p-3"
      data-testid="logins-password-option"
    >
      {alwaysOn ? null : (
        <label className="flex items-start gap-2 text-sm font-medium text-ink-800">
          <input
            type="checkbox"
            checked={draft.save}
            onChange={(e) => onChange({ ...draft, save: e.target.checked })}
            className="mt-0.5 h-4 w-4 rounded border-line"
          />
          <span>
            Save a username and password
            <span className="block text-xs font-normal text-ink-600">
              Computer signs back in on its own when this site asks. If the site sends a code, it
              asks you.
            </span>
          </span>
        </label>
      )}
      {show ? (
        <div className={`${alwaysOn ? '' : 'mt-3 '}grid gap-3 sm:grid-cols-2`}>
          <label className="block text-xs font-medium text-ink-700">
            Username or email
            <input
              type="text"
              value={draft.username}
              onChange={(e) => onChange({ ...draft, username: e.target.value })}
              placeholder={existingUsername ?? 'name@company.com'}
              maxLength={256}
              className={inputClass}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <label className="block text-xs font-medium text-ink-700">
            Password
            <input
              type="password"
              value={draft.password}
              onChange={(e) => onChange({ ...draft, password: e.target.value })}
              maxLength={512}
              className={inputClass}
              autoComplete="new-password"
            />
          </label>
          <label className="block text-xs font-medium text-ink-700 sm:col-span-2">
            Sign-in page (optional)
            <input
              type="url"
              inputMode="url"
              value={draft.loginUrl}
              onChange={(e) => onChange({ ...draft, loginUrl: e.target.value })}
              placeholder="https://portal.example.com/login"
              className={inputClass}
              autoComplete="off"
            />
          </label>
          <p className="text-xs text-ink-600 sm:col-span-2">{PASSWORD_LINE}</p>
        </div>
      ) : null}
    </div>
  );
}

/** The draft as a request body, or an error to show. Never logs or echoes the password. */
function credentialFrom(
  draft: CredentialDraft,
  required: boolean,
): { credential?: ComputerCredentialInput; error?: string } {
  if (!required && !draft.save) return {};
  const username = draft.username.trim();
  if (!username || !draft.password) return { error: 'Enter the username and password to save.' };
  return {
    credential: { username, password: draft.password, loginUrl: draft.loginUrl.trim() || null },
  };
}

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
 * Logins: sign the company's Computer browser in to outside sites ahead of
 * time (Outlook, Gmail, QuickBooks, CRMs, carrier and permit portals). The person signs
 * in themselves in the live browser; the sign-in is kept in the company's
 * browser profile so Chat's Computer tasks start signed in. No AI runs here.
 */
export function LoginsPage() {
  const [state, setState] = useState<ComputerLoginsState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState('');
  const [label, setLabel] = useState('');
  const [working, setWorking] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [draft, setDraft] = useState<CredentialDraft>(EMPTY_DRAFT);
  /** A row's open panel: Sign in again (with the save-password option) or Save/Replace password. */
  const [rowPanel, setRowPanel] = useState<{ id: string; mode: 'sign_in' | 'password' } | null>(
    null,
  );
  const [confirmForget, setConfirmForget] = useState<string | null>(null);
  /** The Add-a-login site catalog (loaded when Add login opens). */
  const [catalog, setCatalog] = useState<LoginCatalog | null>(null);
  const [catalogFailed, setCatalogFailed] = useState(false);
  /** What the person picked in the catalog: a site, Custom website, or nothing yet. */
  const [picked, setPicked] = useState<LoginCatalogEntry | 'custom' | null>(null);
  /** The auto sign-in result for the sign-in you just started (by session). */
  const [autoNote, setAutoNote] = useState<{
    sessionId: string;
    outcome: string;
    text: string;
  } | null>(null);

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
    return () => {
      cancelled = true;
    };
  }, []);

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

  const mySignIn: ComputerSignIn | null = state?.signingIn?.startedByYou ? state.signingIn : null;

  const passwords = state?.passwords;
  const canManagePasswords = Boolean(passwords?.canManage && passwords.enabled);

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
      setAdding(false);
      setPicked(null);
      setRowPanel(null);
      setUrl('');
      setLabel('');
      setDraft(EMPTY_DRAFT);
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
      setConfirmRemove(null);
    } catch (err) {
      setActionError(errorText(err, 'Could not remove this login.'));
    } finally {
      setWorking(null);
      void load();
    }
  }

  async function savePassword(login: ComputerLogin) {
    const { credential, error } = credentialFrom(draft, true);
    if (!credential) {
      setActionError(error ?? 'Enter the username and password to save.');
      return;
    }
    setActionError(null);
    setNotice(null);
    setWorking(`password:${login.id}`);
    try {
      await api.computerSaveCredential(login.id, credential);
      setNotice(`Password saved for ${login.label}. Computer will sign in on its own.`);
      setRowPanel(null);
      setDraft(EMPTY_DRAFT);
    } catch (err) {
      setActionError(errorText(err, 'Could not save the password.'));
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
      setConfirmForget(null);
    } catch (err) {
      setActionError(errorText(err, 'Could not delete the password.'));
    } finally {
      setWorking(null);
      void load();
    }
  }

  function openAdd() {
    setAdding(true);
    setPicked(null);
    setRowPanel(null);
    setDraft(EMPTY_DRAFT);
    setUrl('');
    setLabel('');
    setActionError(null);
    setNotice(null);
    if (!catalog) {
      setCatalogFailed(false);
      api
        .computerLoginCatalog()
        .then(setCatalog)
        .catch(() => setCatalogFailed(true));
    }
  }

  function pickSite(site: LoginCatalogEntry) {
    setPicked(site);
    setUrl(site.signInUrl);
    setLabel(site.name);
    // Pick a site, enter a username and password, done: the password option starts checked.
    setDraft({ ...EMPTY_DRAFT, save: canManagePasswords, loginUrl: site.signInUrl });
    setActionError(null);
  }

  function pickCustom() {
    setPicked('custom');
    setUrl('');
    setLabel('');
    setDraft(EMPTY_DRAFT);
  }

  function submitAdd(e: FormEvent) {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) {
      setActionError('Enter the web address of the site to sign in to.');
      return;
    }
    const { credential, error } = canManagePasswords ? credentialFrom(draft, false) : {};
    if (error) {
      setActionError(error);
      return;
    }
    void start({
      url: trimmed,
      label: label.trim() || undefined,
      ...(credential ? { credential } : {}),
    });
  }

  function submitRow(e: FormEvent, login: ComputerLogin, mode: 'sign_in' | 'password') {
    e.preventDefault();
    if (mode === 'password') {
      void savePassword(login);
      return;
    }
    const { credential, error } = credentialFrom(draft, false);
    if (error) {
      setActionError(error);
      return;
    }
    void start({ loginId: login.id, ...(credential ? { credential } : {}) });
  }

  function openRow(login: ComputerLogin, mode: 'sign_in' | 'password') {
    setActionError(null);
    setNotice(null);
    setConfirmRemove(null);
    setConfirmForget(null);
    setDraft({ ...EMPTY_DRAFT, loginUrl: login.credential?.loginUrl ?? '' });
    setRowPanel({ id: login.id, mode });
  }

  if (!state && !loadError) {
    return (
      <div className="flex justify-center py-16">
        <PanelSpinner label="Loading logins" />
      </div>
    );
  }

  const canStart =
    Boolean(state?.configured) && !state?.busy && !state?.signingIn && working === null;
  const logins = state?.logins ?? [];

  return (
    <div className="mx-auto w-full max-w-4xl" data-testid="logins-page">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink-900">Logins</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-600">
            Sign in once to the websites your company uses, like Outlook, Gmail, QuickBooks or your
            CRM. Computer stays signed in, so Chat tasks on those sites start ready to go.
          </p>
          <p className="mt-2 text-sm font-medium text-ink-800" data-testid="logins-password-line">
            {PASSWORD_LINE}
          </p>
        </div>
        {state?.configured && !adding && !mySignIn ? (
          <button
            type="button"
            onClick={openAdd}
            disabled={!canStart}
            className="rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-semibold text-ink-900 transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Add login
          </button>
        ) : null}
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

      {adding && !mySignIn ? (
        <form
          onSubmit={submitAdd}
          className="mt-5 rounded-xl border border-line bg-paper-0 p-4"
          data-testid="logins-add-form"
          aria-label="Add login"
        >
          <h2 className="text-sm font-semibold text-ink-900">Add login</h2>
          {picked === null && !catalogFailed ? (
            <div className="mt-3">
              {catalog ? (
                <LoginCatalogPicker
                  catalog={catalog}
                  onPick={pickSite}
                  onCustom={pickCustom}
                  savedHosts={logins.map((l) => l.host)}
                />
              ) : (
                <PanelSpinner label="Loading sites" />
              )}
            </div>
          ) : null}
          {picked && picked !== 'custom' ? (
            <div
              className="mt-3 rounded-lg border border-line bg-paper-50 p-3"
              data-testid="logins-picked-site"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <SiteLogo site={picked} size="lg" />
                  <div>
                    <p className="text-sm font-semibold text-ink-900">{picked.name}</p>
                    <p className="text-xs text-ink-600">{picked.signInUrl}</p>
                    <SiteBadges site={picked} />
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setPicked(null)}
                  className="shrink-0 text-xs font-semibold text-brand-700 hover:underline"
                >
                  Change site
                </button>
              </div>
              {picked.signInSteps ? (
                <p
                  className="mt-2 rounded-md bg-success-50 px-2 py-1.5 text-xs text-ink-800"
                  data-testid="logins-ready-steps"
                >
                  <span className="font-semibold">Ready to go.</span> {picked.signInSteps}
                </p>
              ) : null}
              {picked.twoStep === 'likely' ? (
                <p
                  className="mt-2 text-xs font-medium text-ink-800"
                  data-testid="logins-two-step-note"
                >
                  {TWO_STEP_LINE} Computer asks you for it; it never guesses a code.
                </p>
              ) : null}
              {picked.sso ? (
                <p className="mt-1 text-xs text-ink-700">
                  {SSO_LINE} If yours does, you finish that step.
                </p>
              ) : null}
              {picked.termsNote ? (
                <p className="mt-1 text-xs text-ink-600">{picked.termsNote}</p>
              ) : null}
            </div>
          ) : null}
          {picked === 'custom' || (picked === null && catalogFailed) ? (
            <>
              {catalog ? (
                <button
                  type="button"
                  onClick={() => setPicked(null)}
                  className="mt-2 text-xs font-semibold text-brand-700 hover:underline"
                >
                  Back to the site list
                </button>
              ) : null}
              <div className="mt-3 grid gap-3 sm:grid-cols-[2fr_1fr]">
                <label className="block text-xs font-medium text-ink-700">
                  Website address
                  <input
                    type="url"
                    inputMode="url"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://portal.example.com"
                    className="mt-1 w-full rounded-lg border border-line bg-paper-0 px-3 py-2 text-sm text-ink-900 outline-none focus:border-brand-600"
                    autoComplete="off"
                  />
                </label>
                <label className="block text-xs font-medium text-ink-700">
                  Name (optional)
                  <input
                    type="text"
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder="Carrier portal"
                    maxLength={80}
                    className="mt-1 w-full rounded-lg border border-line bg-paper-0 px-3 py-2 text-sm text-ink-900 outline-none focus:border-brand-600"
                    autoComplete="off"
                  />
                </label>
              </div>
            </>
          ) : null}
          {picked !== null || catalogFailed ? (
            <CredentialFields draft={draft} onChange={setDraft} passwords={passwords} />
          ) : null}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {picked !== null || catalogFailed ? (
              <button
                type="submit"
                disabled={working !== null}
                className="rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-semibold text-ink-900 transition hover:bg-brand-700 disabled:opacity-50"
              >
                {working === 'start'
                  ? 'Opening…'
                  : draft.save && canManagePasswords
                    ? 'Save and sign in'
                    : 'Open sign-in page'}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => {
                setAdding(false);
                setPicked(null);
              }}
              className="rounded-lg border border-line bg-paper-0 px-3.5 py-2 text-sm font-medium text-ink-700 transition hover:border-brand-200"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}

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
                className="rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-semibold text-ink-900 transition hover:bg-brand-700 disabled:opacity-50"
              >
                {working === 'done' ? 'Saving…' : 'Done, I’m signed in'}
              </button>
              <button
                type="button"
                onClick={() => void cancel(mySignIn)}
                disabled={working !== null}
                className="rounded-lg border border-line bg-paper-0 px-3.5 py-2 text-sm font-medium text-ink-700 transition hover:border-brand-200 disabled:opacity-50"
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

      <section className="mt-6" aria-label="Saved logins">
        {logins.length === 0 ? (
          state?.configured && !mySignIn ? (
            <div
              className="rounded-xl border border-dashed border-line bg-paper-50 px-4 py-8 text-center"
              data-testid="logins-empty"
            >
              <p className="text-sm font-medium text-ink-800">No logins yet</p>
              <p className="mt-1 text-sm text-ink-600">
                Add the sites Computer should be signed in to, like Outlook or a carrier portal.
              </p>
            </div>
          ) : null
        ) : (
          <ul
            className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-paper-0"
            data-testid="logins-list"
          >
            {logins.map((login) => {
              const cred = login.credential;
              const attention = cred?.status === 'needs_attention';
              const panel = rowPanel?.id === login.id ? rowPanel.mode : null;
              // Removing a site deletes its saved password, so that takes a Global Admin.
              const canRemove = !cred || Boolean(passwords?.canManage);
              return (
                <li key={login.id} className="px-4 py-3" data-testid={`login-row-${login.id}`}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-ink-900">{login.label}</p>
                      <p className="truncate text-xs text-ink-600">{login.host}</p>
                      <p className="mt-0.5 text-xs text-ink-500">
                        Added by {login.addedBy ?? 'a former teammate'} · Last signed in{' '}
                        {login.lastSignedInAt ? timeAgo(login.lastSignedInAt) : 'not yet'}
                        {login.lastSignedInAt && login.lastSignedInBy
                          ? ` by ${login.lastSignedInBy}`
                          : ''}
                      </p>
                      {cred ? (
                        <p
                          className="mt-1 flex flex-wrap items-center gap-1.5 text-xs"
                          data-testid="login-credential"
                        >
                          {attention ? (
                            <span
                              className="rounded-full border border-danger-200 bg-danger-50 px-2 py-0.5 font-semibold text-danger-700"
                              data-testid="login-needs-attention"
                            >
                              Needs attention
                            </span>
                          ) : (
                            <span className="rounded-full border border-success-200 bg-success-50 px-2 py-0.5 font-semibold text-success-600">
                              Password saved
                            </span>
                          )}
                          {attention ? <span className="text-ink-700">Password saved</span> : null}
                          {cred.username ? (
                            <span className="text-ink-700">· {cred.username}</span>
                          ) : null}
                          {!attention && cred.lastUsedAt ? (
                            <span className="text-ink-500">· used {timeAgo(cred.lastUsedAt)}</span>
                          ) : null}
                        </p>
                      ) : null}
                      {attention ? (
                        <p className="mt-1 text-xs text-danger-700">
                          {cred?.attentionReason ?? 'The saved password needs a look.'}{' '}
                          {passwords?.canManage
                            ? 'Replace the password or sign in again.'
                            : 'Ask a Global Admin to update it.'}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {confirmForget === login.id ? (
                        <>
                          <span className="text-xs text-ink-700">
                            Delete the saved password? Computer stays signed in for now.
                          </span>
                          <button
                            type="button"
                            onClick={() => void forgetPassword(login)}
                            disabled={working !== null}
                            className="rounded-lg bg-danger-600 px-3 py-1.5 text-xs font-semibold text-paper-0 transition hover:bg-danger-700 disabled:opacity-50"
                          >
                            {working === `forget:${login.id}` ? 'Deleting…' : 'Delete password'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmForget(null)}
                            className="rounded-lg border border-line bg-paper-0 px-3 py-1.5 text-xs font-medium text-ink-700"
                          >
                            Keep
                          </button>
                        </>
                      ) : confirmRemove === login.id ? (
                        <>
                          <span className="text-xs text-ink-700">
                            {cred
                              ? 'Remove, delete its saved password and sign Computer out?'
                              : login.canClearCookies
                                ? 'Remove and sign Computer out of this site?'
                                : 'Remove from the list? Computer may stay signed in.'}
                          </span>
                          <button
                            type="button"
                            onClick={() => void remove(login)}
                            disabled={working !== null}
                            className="rounded-lg bg-danger-600 px-3 py-1.5 text-xs font-semibold text-paper-0 transition hover:bg-danger-700 disabled:opacity-50"
                          >
                            {working === `remove:${login.id}` ? 'Removing…' : 'Remove'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmRemove(null)}
                            className="rounded-lg border border-line bg-paper-0 px-3 py-1.5 text-xs font-medium text-ink-700"
                          >
                            Keep
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() =>
                              canManagePasswords
                                ? openRow(login, 'sign_in')
                                : void start({ loginId: login.id })
                            }
                            disabled={!canStart}
                            className="rounded-lg border border-line bg-paper-0 px-3 py-1.5 text-xs font-semibold text-ink-800 transition hover:border-brand-200 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Sign in again
                          </button>
                          {canManagePasswords ? (
                            <button
                              type="button"
                              onClick={() => openRow(login, 'password')}
                              disabled={working !== null}
                              className="rounded-lg border border-line bg-paper-0 px-3 py-1.5 text-xs font-medium text-ink-700 transition hover:border-brand-200 disabled:opacity-50"
                            >
                              {cred ? 'Replace password' : 'Save password'}
                            </button>
                          ) : null}
                          {cred && passwords?.canManage ? (
                            <button
                              type="button"
                              onClick={() => {
                                setConfirmRemove(null);
                                setConfirmForget(login.id);
                              }}
                              disabled={working !== null}
                              className="rounded-lg border border-line bg-paper-0 px-3 py-1.5 text-xs font-medium text-ink-600 transition hover:border-danger-200 hover:text-danger-700 disabled:opacity-50"
                            >
                              Delete password
                            </button>
                          ) : null}
                          {canRemove ? (
                            <button
                              type="button"
                              onClick={() => {
                                setConfirmForget(null);
                                setConfirmRemove(login.id);
                              }}
                              disabled={working !== null}
                              className="rounded-lg border border-line bg-paper-0 px-3 py-1.5 text-xs font-medium text-ink-600 transition hover:border-danger-200 hover:text-danger-700 disabled:opacity-50"
                            >
                              Remove
                            </button>
                          ) : null}
                        </>
                      )}
                    </div>
                  </div>
                  {panel ? (
                    <form
                      onSubmit={(e) => submitRow(e, login, panel)}
                      className="mt-3 rounded-lg border border-line bg-paper-0 p-3"
                      aria-label={
                        panel === 'password'
                          ? `Save password for ${login.label}`
                          : `Sign in again to ${login.label}`
                      }
                      data-testid="login-row-panel"
                    >
                      <CredentialFields
                        draft={draft}
                        onChange={setDraft}
                        passwords={passwords}
                        alwaysOn={panel === 'password'}
                        existingUsername={cred?.username}
                      />
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <button
                          type="submit"
                          disabled={working !== null || (panel === 'sign_in' && !canStart)}
                          className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-ink-900 transition hover:bg-brand-700 disabled:opacity-50"
                        >
                          {panel === 'password'
                            ? working === `password:${login.id}`
                              ? 'Saving…'
                              : 'Save password'
                            : working === 'start'
                              ? 'Opening…'
                              : draft.save
                                ? 'Save and sign in'
                                : 'Open sign-in page'}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setRowPanel(null);
                            setDraft(EMPTY_DRAFT);
                          }}
                          className="rounded-lg border border-line bg-paper-0 px-3 py-1.5 text-xs font-medium text-ink-700"
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {state?.signingIn && !state.signingIn.startedByYou ? (
        <p className="mt-4 text-xs text-ink-600">
          Someone on your team is signing in to {state.signingIn.label} right now.
        </p>
      ) : null}
    </div>
  );
}
