import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, ApiError, timeAgo } from '../lib/api';
import {
  LOGIN_QUICK_PICKS,
  type ComputerLogin,
  type ComputerLoginsState,
  type ComputerSignIn,
} from '../lib/computer';
import { ComputerLiveView } from '../components/computer/ComputerLiveView';
import { ErrorNote, PanelSpinner } from '../components/AppShell';

const PASSWORD_LINE = 'We never see or store your passwords. You type them into the site yourself.';

function errorText(err: unknown, fallback: string): string {
  if (err instanceof ApiError || err instanceof Error) return err.message || fallback;
  return fallback;
}

/**
 * Logins: sign the company's Computer browser in to outside sites ahead of
 * time (Outlook, carrier portals, Xactimate, permit sites). The person signs
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
  const othersBusy = Boolean(state && (state.busy || (state.signingIn && !state.signingIn.startedByYou)));
  useEffect(() => {
    if (!othersBusy) return;
    const id = window.setInterval(() => void load(), 15_000);
    return () => window.clearInterval(id);
  }, [othersBusy, load]);

  const mySignIn: ComputerSignIn | null = state?.signingIn?.startedByYou ? state.signingIn : null;

  async function start(input: { url?: string; label?: string; loginId?: string }) {
    setActionError(null);
    setNotice(null);
    setWorking('start');
    try {
      const { signIn } = await api.computerStartSignIn(input);
      setState((prev) => (prev ? { ...prev, signingIn: signIn, busy: null } : prev));
      setAdding(false);
      setUrl('');
      setLabel('');
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

  function submitAdd(e: FormEvent) {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) {
      setActionError('Enter the web address of the site to sign in to.');
      return;
    }
    void start({ url: trimmed, label: label.trim() || undefined });
  }

  if (!state && !loadError) {
    return (
      <div className="flex justify-center py-16">
        <PanelSpinner label="Loading logins" />
      </div>
    );
  }

  const canStart = Boolean(state?.configured) && !state?.busy && !state?.signingIn && working === null;
  const logins = state?.logins ?? [];

  return (
    <div className="mx-auto w-full max-w-4xl" data-testid="logins-page">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink-900">Logins</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-600">
            Sign in once to the websites your company uses, like Outlook, carrier portals or Xactimate. Computer
            stays signed in, so Chat tasks on those sites start ready to go.
          </p>
          <p className="mt-2 text-sm font-medium text-ink-800" data-testid="logins-password-line">
            {PASSWORD_LINE}
          </p>
        </div>
        {state?.configured && !adding && !mySignIn ? (
          <button
            type="button"
            onClick={() => {
              setAdding(true);
              setActionError(null);
              setNotice(null);
            }}
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
        <p className="mt-4 rounded-xl border border-line bg-paper-50 px-4 py-3 text-sm text-ink-700" data-testid="logins-not-set-up">
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
        <p className="mt-4 rounded-xl border border-success-200 bg-success-50 px-4 py-3 text-sm text-ink-800" role="status">
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
          <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Quick picks">
            {LOGIN_QUICK_PICKS.map((pick) => (
              <button
                key={pick.url}
                type="button"
                onClick={() => {
                  setUrl(pick.url);
                  setLabel(pick.label);
                }}
                aria-pressed={url === pick.url}
                className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                  url === pick.url
                    ? 'border-brand-600 bg-brand-50 text-ink-900'
                    : 'border-line bg-paper-0 text-ink-700 hover:border-brand-200'
                }`}
              >
                {pick.label}
              </button>
            ))}
          </div>
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
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="submit"
              disabled={working !== null}
              className="rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-semibold text-ink-900 transition hover:bg-brand-700 disabled:opacity-50"
            >
              {working === 'start' ? 'Opening…' : 'Open sign-in page'}
            </button>
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="rounded-lg border border-line bg-paper-0 px-3.5 py-2 text-sm font-medium text-ink-700 transition hover:border-brand-200"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      {mySignIn ? (
        <section className="mt-5 rounded-xl border border-brand-200 bg-paper-0 p-4" data-testid="logins-signing-in">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-ink-900">Signing in to {mySignIn.label}</h2>
              <p className="mt-1 text-sm text-ink-600">
                Sign in below the way you normally do. When you see your inbox or home page, press Done.
              </p>
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
              controlHint={`You have control of the browser. ${PASSWORD_LINE} The browser closes on its own at ${new Date(
                mySignIn.expiresAt,
              ).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`}
            />
          </div>
        </section>
      ) : null}

      <section className="mt-6" aria-label="Saved logins">
        {logins.length === 0 ? (
          state?.configured && !mySignIn ? (
            <div className="rounded-xl border border-dashed border-line bg-paper-50 px-4 py-8 text-center" data-testid="logins-empty">
              <p className="text-sm font-medium text-ink-800">No logins yet</p>
              <p className="mt-1 text-sm text-ink-600">
                Add the sites Computer should be signed in to, like Outlook or a carrier portal.
              </p>
            </div>
          ) : null
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-paper-0" data-testid="logins-list">
            {logins.map((login) => (
              <li key={login.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink-900">{login.label}</p>
                  <p className="truncate text-xs text-ink-600">{login.host}</p>
                  <p className="mt-0.5 text-xs text-ink-500">
                    Added by {login.addedBy ?? 'a former teammate'} · Last signed in{' '}
                    {timeAgo(login.lastSignedInAt)}
                    {login.lastSignedInBy ? ` by ${login.lastSignedInBy}` : ''}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {confirmRemove === login.id ? (
                    <>
                      <span className="text-xs text-ink-700">
                        {login.canClearCookies
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
                        onClick={() => void start({ loginId: login.id })}
                        disabled={!canStart}
                        className="rounded-lg border border-line bg-paper-0 px-3 py-1.5 text-xs font-semibold text-ink-800 transition hover:border-brand-200 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Sign in again
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmRemove(login.id)}
                        disabled={working !== null}
                        className="rounded-lg border border-line bg-paper-0 px-3 py-1.5 text-xs font-medium text-ink-600 transition hover:border-danger-200 hover:text-danger-700 disabled:opacity-50"
                      >
                        Remove
                      </button>
                    </>
                  )}
                </div>
              </li>
            ))}
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
