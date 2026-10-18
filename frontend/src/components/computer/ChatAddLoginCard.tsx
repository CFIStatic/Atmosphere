import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../../lib/api';
import { COMPUTER_RESUME_EVENT, type AddLoginPrompt, type ComputerSignIn } from '../../lib/computer';
import { ComputerLiveView } from './ComputerLiveView';

const inputClass =
  'mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink-900 outline-none focus:border-brand-500';
const labelClass = 'block text-xs font-medium text-ink-600';
const primary =
  'rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60';
const secondary = 'rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-ink-700 hover:bg-paper-100';

function errorText(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/**
 * Chat found the site but there is no saved Login: ask for it right here.
 * The fields post straight to Logins (encrypted, Global Admin), never into
 * the chat thread. Once it is saved, Chat sends the original request again
 * and Computer continues with the new login.
 */
export function ChatAddLoginCard({ prompt }: { prompt: AddLoginPrompt }) {
  const [canSave, setCanSave] = useState<boolean | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signIn, setSignIn] = useState<ComputerSignIn | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let live = true;
    api
      .computerLogins()
      .then((state) => {
        if (live) setCanSave(Boolean(state.passwords?.enabled && state.passwords?.canManage));
      })
      .catch(() => live && setCanSave(false));
    return () => {
      live = false;
    };
  }, []);

  function resume() {
    setDone(true);
    if (prompt.question) {
      window.dispatchEvent(new CustomEvent(COMPUTER_RESUME_EVENT, { detail: { text: prompt.question } }));
    }
  }

  async function finish(session: ComputerSignIn) {
    setBusy(true);
    setError(null);
    try {
      await api.computerSignInDone(session.sessionId);
      setSignIn(null);
      resume();
    } catch (err) {
      setError(errorText(err, 'Could not save this login.'));
    } finally {
      setBusy(false);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (canSave && (!username.trim() || !password)) {
      setError('Enter the username and password.');
      return;
    }
    setBusy(true);
    try {
      const { signIn: started } = await api.computerStartSignIn({
        url: prompt.url,
        label: prompt.name,
        ...(canSave
          ? { credential: { username: username.trim(), password, companyId: companyId.trim() || null } }
          : {}),
      });
      setPassword('');
      const outcome = started.autoSignIn?.outcome;
      if (outcome === 'signed_in' || outcome === 'already_signed_in') {
        await finish(started);
        return;
      }
      // Code, captcha, or no saved password: the person finishes in the live view.
      setSignIn(started);
    } catch (err) {
      setError(errorText(err, 'Could not open the sign-in page.'));
    } finally {
      setBusy(false);
    }
  }

  const where = prompt.host.replace(/^www\./, '');
  if (done) {
    return (
      <div data-testid="chat-add-login-saved" className="rounded-xl border border-line bg-paper-50 p-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">Logins</p>
        <p className="mt-0.5 text-[15px] font-semibold text-ink-900">Saved {prompt.name}</p>
        <p className="mt-1 text-sm text-ink-700">Continuing your request with the new login.</p>
      </div>
    );
  }
  return (
    <div data-testid="chat-add-login" className="rounded-xl border border-line bg-paper-50 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">Add a login</p>
      <p className="mt-0.5 text-[15px] font-semibold text-ink-900">{prompt.name}</p>
      <p className="text-xs text-ink-500">
        {where}
        {prompt.foundWithWebSearch ? ' · found with a web search' : ''}
      </p>
      {signIn ? (
        <div className="mt-3 space-y-2">
          <p className="text-sm text-ink-700">
            {signIn.autoSignIn?.message || `Finish signing in to ${prompt.name} below, then press Done.`}
          </p>
          <ComputerLiveView
            taskId={signIn.sessionId}
            mode="control"
            onClose={() => undefined}
            mint={() => api.computerSignInLive(signIn.sessionId)}
            controlHint="Enter any code the site asks for, then press Done."
          />
          <div className="flex gap-2">
            <button type="button" className={primary} disabled={busy} onClick={() => void finish(signIn)}>
              {busy ? 'Saving…' : "Done, I'm signed in"}
            </button>
          </div>
        </div>
      ) : (
        <form className="mt-3 grid gap-3" onSubmit={submit} noValidate aria-label={`Add ${prompt.name} login`}>
          {canSave ? (
            <>
              <label className={labelClass}>
                Email or username
                <input
                  className={inputClass}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  name="atm-login-username"
                />
              </label>
              <label className={labelClass}>
                Password
                <input
                  className={inputClass}
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  name="atm-login-password"
                />
              </label>
              <label className={labelClass}>
                Company ID <span className="font-normal text-ink-500">(if the site asks for one)</span>
                <input
                  className={inputClass}
                  value={companyId}
                  onChange={(e) => setCompanyId(e.target.value)}
                  autoComplete="off"
                  name="atm-login-company"
                />
              </label>
              <p className="text-xs text-ink-500">
                Saved encrypted to your Logins. It never appears in this chat, and Atmosphere's AI never sees the password.
              </p>
            </>
          ) : canSave === false ? (
            <p className="text-sm text-ink-700">
              Open the sign-in page and sign in yourself. Computer keeps the session in your Logins (only a Global Admin can save a password).
            </p>
          ) : null}
          {error ? (
            <p className="text-sm text-danger-600" role="alert">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button type="submit" className={primary} disabled={busy || canSave === null}>
              {busy ? 'Saving…' : canSave ? 'Save and continue' : 'Open sign-in page'}
            </button>
            <a className={secondary} href="/logins">
              Open Logins
            </a>
          </div>
        </form>
      )}
    </div>
  );
}
