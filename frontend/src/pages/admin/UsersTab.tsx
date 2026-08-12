import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  adminApi,
  AdminError,
  formatWhen,
  scopeAtLeast,
  type AdminUserSummary,
  type PlatformStaffScope,
} from '../../lib/adminApi';
import { AdminErrorState } from './AdminShell';
import { SpinnerIcon } from '../../components/icons';

export function UsersTab({ scope }: { scope: PlatformStaffScope }) {
  const [params, setParams] = useSearchParams();
  const initialQ = params.get('q') ?? '';
  const [q, setQ] = useState(initialQ);
  const [submitted, setSubmitted] = useState(initialQ);
  const [users, setUsers] = useState<AdminUserSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<AdminUserSummary | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [actionLink, setActionLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (query: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await adminApi.listUsers({ q: query || undefined, limit: 50, page: 1 });
      setUsers(result.users);
      setTotal(result.total);
      if (query && result.users.length === 1) setSelected(result.users[0]);
    } catch (err) {
      setError(err instanceof AdminError ? err.message : 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(submitted);
  }, [load, submitted]);

  async function runReset(mode: 'email' | 'link') {
    if (!selected) return;
    setBusy(true);
    setActionMsg(null);
    setActionLink(null);
    try {
      const result = await adminApi.resetPassword(selected.id, mode);
      if (result.actionLink) {
        setActionLink(result.actionLink);
        setActionMsg(`One-time recovery link for ${result.email} (share securely, then discard).`);
      } else {
        setActionMsg(`Password reset email sent to ${result.email}.`);
      }
    } catch (err) {
      setActionMsg(err instanceof AdminError ? err.message : 'Reset failed');
    } finally {
      setBusy(false);
    }
  }

  async function toggleBan() {
    if (!selected) return;
    const banned = !selected.bannedUntil;
    setBusy(true);
    setActionMsg(null);
    try {
      await adminApi.setBanned(selected.id, banned);
      const { user } = await adminApi.getUser(selected.id);
      setSelected(user);
      setUsers((prev) => prev.map((u) => (u.id === user.id ? user : u)));
      setActionMsg(banned ? 'User banned.' : 'User unbanned.');
    } catch (err) {
      setActionMsg(err instanceof AdminError ? err.message : 'Ban update failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_minmax(280px,400px)]">
      <div>
        <form
          className="mb-4 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const next = q.trim();
            setSubmitted(next);
            setParams(next ? { q: next } : {});
          }}
        >
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search email, name, or user UUID"
            className="min-w-0 flex-1 rounded-lg border border-white/10 bg-ink-800 px-3 py-2 text-sm text-white placeholder:text-gray-600 focus:border-brand-500 focus:outline-none"
          />
          <button
            type="submit"
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500"
          >
            Search
          </button>
        </form>

        {loading && (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <SpinnerIcon className="animate-spin" width={14} height={14} /> Loading users…
          </div>
        )}
        {error && <AdminErrorState message={error} onRetry={() => void load(submitted)} />}
        {!loading && !error && (
          <>
            <p className="mb-2 text-xs text-gray-500">{total.toLocaleString()} users</p>
            <div className="overflow-x-auto rounded-xl border border-white/10">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead className="bg-ink-800/80 text-xs uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-3 py-2 font-medium">User</th>
                    <th className="px-3 py-2 font-medium">Orgs</th>
                    <th className="px-3 py-2 font-medium">Last sign-in</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <tr
                      key={user.id}
                      onClick={() => {
                        setSelected(user);
                        setActionMsg(null);
                        setActionLink(null);
                      }}
                      className={[
                        'cursor-pointer border-t border-white/5 transition',
                        selected?.id === user.id ? 'bg-white/10' : 'hover:bg-white/5',
                      ].join(' ')}
                    >
                      <td className="px-3 py-2.5">
                        <div className="font-medium text-white">
                          {user.fullName || user.email || 'Unknown'}
                          {user.bannedUntil ? (
                            <span className="ml-2 rounded bg-red-500/20 px-1.5 py-0.5 text-[10px] text-red-200">
                              banned
                            </span>
                          ) : null}
                        </div>
                        <div className="text-xs text-gray-500">{user.email}</div>
                      </td>
                      <td className="px-3 py-2.5 text-gray-300">
                        {user.memberships.length
                          ? user.memberships.map((m) => m.orgName).join(', ')
                          : '—'}
                      </td>
                      <td className="px-3 py-2.5 text-gray-400">{formatWhen(user.lastSignInAt)}</td>
                    </tr>
                  ))}
                  {users.length === 0 && (
                    <tr>
                      <td colSpan={3} className="px-3 py-8 text-center text-gray-500">
                        No users match.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      <aside className="rounded-xl border border-white/10 bg-ink-800/40 p-4">
        {!selected && (
          <p className="text-sm text-gray-500">Select a user for password reset and account actions.</p>
        )}
        {selected && (
          <div className="space-y-4 text-sm">
            <div>
              <h2 className="text-lg font-semibold text-white">
                {selected.fullName || selected.email || 'User'}
              </h2>
              <p className="text-gray-400">{selected.email}</p>
              <p className="mt-0.5 font-mono text-[11px] text-gray-600">{selected.id}</p>
            </div>
            <dl className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <dt className="text-gray-500">Created</dt>
                <dd className="text-gray-200">{formatWhen(selected.createdAt)}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Last sign-in</dt>
                <dd className="text-gray-200">{formatWhen(selected.lastSignInAt)}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Email confirmed</dt>
                <dd className="text-gray-200">{formatWhen(selected.emailConfirmedAt)}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Staff scope</dt>
                <dd className="text-gray-200">{selected.platformScope ?? '—'}</dd>
              </div>
            </dl>
            <div>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">
                Memberships
              </h3>
              <ul className="space-y-1.5">
                {selected.memberships.map((m) => (
                  <li key={`${m.orgId}-${m.role}`} className="text-xs text-gray-300">
                    {m.orgName}{' '}
                    <span className="text-gray-500">
                      · {m.role} · {m.status}
                    </span>
                  </li>
                ))}
                {selected.memberships.length === 0 && (
                  <li className="text-xs text-gray-500">No org memberships.</li>
                )}
              </ul>
            </div>

            <div className="space-y-2 border-t border-white/10 pt-4">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Support</p>
              <button
                type="button"
                disabled={busy}
                onClick={() => void runReset('email')}
                className="w-full rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50"
              >
                Send password reset email
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void runReset('link')}
                className="w-full rounded-lg border border-white/10 px-3 py-2 text-sm text-gray-200 hover:bg-white/5 disabled:opacity-50"
              >
                Generate recovery link
              </button>
              {scopeAtLeast(scope, 'admin') && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void toggleBan()}
                  className="w-full rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200 hover:bg-red-500/20 disabled:opacity-50"
                >
                  {selected.bannedUntil ? 'Unban user' : 'Ban user'}
                </button>
              )}
              {actionMsg && <p className="text-xs text-amber-200">{actionMsg}</p>}
              {actionLink && (
                <textarea
                  readOnly
                  value={actionLink}
                  className="h-24 w-full rounded-lg border border-white/10 bg-ink-900 p-2 font-mono text-[11px] text-gray-300"
                  onFocus={(e) => e.currentTarget.select()}
                />
              )}
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}
