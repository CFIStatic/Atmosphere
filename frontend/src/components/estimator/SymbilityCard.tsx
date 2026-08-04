import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError, type SymbilityScope, type SymbilityStatus } from '../../lib/api';
import { SpinnerIcon, CheckIcon } from '../icons';

/**
 * The Symbility (Claims Connect) connection card.
 *
 * The second estimating platform, presented under the same contract as the
 * Xactimate card beside it: web sign-in as the user, permissions individually
 * checkable and read-only by default, session-only recommended and first, and
 * what happens to the password stated in plain words. Someone connecting their
 * second platform should not have to learn a second set of rules.
 *
 * The card covers the connection lifecycle only — estimate push into Symbility
 * arrives when the estimator's Symbility export does, and the card does not
 * pretend otherwise.
 */

const WRITE_SCOPES = new Set<SymbilityScope>(['write_estimate']);

export function SymbilityCard() {
  const [status, setStatus] = useState<SymbilityStatus | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [mfaRequired, setMfaRequired] = useState(false);
  const [scopes, setScopes] = useState<SymbilityScope[]>([]);
  const [storageMode, setStorageMode] = useState<'session' | 'stored'>('session');
  const [acknowledged, setAcknowledged] = useState(false);

  const refresh = async () => {
    try {
      const next = await api.symbilityStatus();
      setStatus(next);
      if (scopes.length === 0) {
        setScopes(next.availableScopes.filter((s) => s.defaultGranted).map((s) => s.scope));
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not read the Symbility connection.');
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function connect(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api.symbilityConnect({
        username: username.trim(),
        password,
        mfaCode: mfaCode.trim() || undefined,
        scopes,
        storageMode,
        consentDays: 30,
        acknowledgedTerms: true,
      });
      if (result.status === 'mfa_required') {
        setMfaRequired(true);
        setNotice(result.message);
      } else {
        setExpanded(false);
        setMfaRequired(false);
        setPassword('');
        setMfaCode('');
        setNotice(
          `Connected as ${result.profile.displayName ?? result.profile.username}` +
            (result.profile.companyName ? ` — ${result.profile.companyName}` : '') +
            '.',
        );
        await refresh();
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not connect to Claims Connect.');
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    setError(null);
    try {
      await api.symbilityDisconnect();
      setNotice('Disconnected. The stored credential, if any, was destroyed with the grant.');
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not disconnect.');
    } finally {
      setBusy(false);
    }
  }

  if (!status) {
    return (
      <div className="rounded-xl glass-card p-5">
        <SpinnerIcon className="animate-spin text-brand-300" width={18} height={18} />
      </div>
    );
  }

  return (
    <div className="rounded-xl glass-card p-5 backdrop-blur">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
            Symbility · Claims Connect
          </p>
          <p className="mt-1 flex items-center gap-2 text-lg font-semibold text-ink-900">
            {status.connected ? (
              <>
                <CheckIcon className="text-success-600" width={18} height={18} />
                {status.username}
              </>
            ) : (
              'Not connected'
            )}
          </p>
          {status.connected && status.expiresAt && (
            <p className="mt-1 text-xs text-ink-500">
              Permission expires {new Date(status.expiresAt).toLocaleDateString()} ·{' '}
              {status.storageMode === 'session'
                ? 'password not stored'
                : 'password stored, encrypted'}
              {!status.sessionActive && ' · session ended, sign in again to work'}
            </p>
          )}
        </div>

        <div className="flex gap-2">
          {status.connected ? (
            <button
              onClick={() => void disconnect()}
              disabled={busy}
              className="rounded-lg border border-line bg-paper-200 px-3 py-1.5 text-sm text-ink-800 transition hover:bg-paper-300 disabled:opacity-60"
            >
              Disconnect
            </button>
          ) : (
            <button
              onClick={() => setExpanded((value) => !value)}
              className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-brand-500"
            >
              {expanded ? 'Cancel' : 'Connect account'}
            </button>
          )}
        </div>
      </div>

      {status.driver === 'mock' && (
        <p className="mt-3 rounded-lg border border-caution-200 bg-caution-50 px-3 py-2 text-xs text-caution-600">
          This server is running the <strong>demo driver</strong> — it does not reach Symbility at
          all. Any username and password will "connect". Set{' '}
          <code className="font-mono">SYMBILITY_DRIVER</code> to <code className="font-mono">web</code>{' '}
          and enable <code className="font-mono">SYMBILITY_WEB_AUTOMATION</code> for a real web
          sign-in.
        </p>
      )}

      {error && (
        <p className="mt-3 rounded-lg border border-danger-200 bg-danger-50 px-3 py-2 text-sm text-danger-600">
          {error}
        </p>
      )}
      {notice && !error && (
        <p className="mt-3 rounded-lg border border-success-200 bg-success-50 px-3 py-2 text-sm text-success-600">
          {notice}
        </p>
      )}

      {expanded && !status.connected && (
        <form onSubmit={connect} className="mt-4 space-y-4 border-t border-line pt-4">
          <div className="rounded-lg border border-line bg-paper-100/50 p-3 text-xs leading-relaxed text-ink-600">
            <p className="font-medium text-ink-700">What happens when you connect</p>
            <ul className="mt-1.5 list-disc space-y-1 pl-4">
              <li>
                Atmosphere signs in to <strong>your</strong> Claims Connect account through its web
                login and acts as you, only within the permissions you tick below.
              </li>
              <li>
                In session-only mode your password is used for this sign-in and never written to
                disk. Nothing is kept that a database leak could expose.
              </li>
              <li>
                Permission lapses after 30 days, and you can revoke it at any moment — revoking also
                destroys any stored credential in the same act.
              </li>
              <li>If your account asks for a verification code, you will be prompted for it here.</li>
            </ul>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Symbility username"
              autoComplete="off"
              required
              className="rounded-lg glass-field px-3 py-2 text-sm text-ink-900 outline-none placeholder:text-ink-400 focus:ring-2 focus:ring-brand-200"
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              autoComplete="off"
              required
              className="rounded-lg glass-field px-3 py-2 text-sm text-ink-900 outline-none placeholder:text-ink-400 focus:ring-2 focus:ring-brand-200"
            />
          </div>

          {mfaRequired && (
            <input
              value={mfaCode}
              onChange={(e) => setMfaCode(e.target.value)}
              placeholder="Verification code"
              inputMode="numeric"
              autoComplete="one-time-code"
              className="w-full rounded-lg glass-field px-3 py-2 text-sm text-ink-900 outline-none placeholder:text-ink-400 focus:ring-2 focus:ring-brand-200"
            />
          )}

          <fieldset className="space-y-1.5">
            <legend className="text-xs font-medium text-ink-700">Permissions</legend>
            {status.availableScopes.map((entry) => (
              <label
                key={entry.scope}
                className={`flex items-start gap-2 rounded-lg px-2 py-1.5 text-xs ${
                  WRITE_SCOPES.has(entry.scope) ? 'border border-caution-200 bg-caution-50/40' : ''
                }`}
              >
                <input
                  type="checkbox"
                  checked={scopes.includes(entry.scope)}
                  onChange={(e) =>
                    setScopes((prev) =>
                      e.target.checked
                        ? [...prev, entry.scope]
                        : prev.filter((s) => s !== entry.scope),
                    )
                  }
                  className="mt-0.5"
                />
                <span>
                  <span className="font-medium text-ink-800">{entry.label}</span>
                  <span className="block text-ink-500">{entry.description}</span>
                </span>
              </label>
            ))}
          </fieldset>

          <fieldset className="space-y-1.5">
            <legend className="text-xs font-medium text-ink-700">Your password</legend>
            <label className="flex items-start gap-2 text-xs text-ink-600">
              <input
                type="radio"
                name="symbility-storage"
                checked={storageMode === 'session'}
                onChange={() => setStorageMode('session')}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium text-ink-800">Session only (recommended)</span> — used
                for this sign-in, never stored.
              </span>
            </label>
            <label className="flex items-start gap-2 text-xs text-ink-600">
              <input
                type="radio"
                name="symbility-storage"
                checked={storageMode === 'stored'}
                onChange={() => setStorageMode('stored')}
                disabled={!status.storageAvailable}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium text-ink-800">Store encrypted</span> — sealed with a
                server-only key so future syncs can run without re-typing it.
                {!status.storageAvailable && ' Not available on this server.'}
              </span>
            </label>
          </fieldset>

          <label className="flex items-start gap-2 text-xs text-ink-600">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
              className="mt-0.5"
              required
            />
            <span>
              I confirm automated access is permitted under my CoreLogic account terms. Whether it
              is depends on your agreement with them — it is genuinely your call, not ours.
            </span>
          </label>

          <button
            type="submit"
            disabled={busy || !acknowledged || scopes.length === 0}
            className="flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-500 disabled:opacity-50"
          >
            {busy && <SpinnerIcon className="animate-spin" width={14} height={14} />}
            {mfaRequired ? 'Verify and connect' : 'Sign in and connect'}
          </button>
        </form>
      )}
    </div>
  );
}
