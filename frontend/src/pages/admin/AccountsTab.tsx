import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  adminApi,
  AdminError,
  formatWhen,
  type AdminOrgDetail,
  type AdminOrgSummary,
} from '../../lib/adminApi';
import { AdminErrorState } from './AdminShell';
import { SpinnerIcon } from '../../components/icons';

export function AccountsTab() {
  const [q, setQ] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [orgs, setOrgs] = useState<AdminOrgSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AdminOrgDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async (query: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await adminApi.listOrgs({ q: query || undefined, limit: 50 });
      setOrgs(result.orgs);
      setTotal(result.total);
    } catch (err) {
      setError(err instanceof AdminError ? err.message : 'Failed to load accounts');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(submitted);
  }, [load, submitted]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    adminApi
      .getOrg(selectedId)
      .then(({ org }) => {
        if (!cancelled) setDetail(org);
      })
      .catch(() => {
        if (!cancelled) setDetail(null);
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_minmax(280px,380px)]">
      <div>
        <form
          className="mb-4 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setSubmitted(q.trim());
          }}
        >
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search org name or paste UUID"
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
            <SpinnerIcon className="animate-spin" width={14} height={14} /> Loading accounts…
          </div>
        )}
        {error && <AdminErrorState message={error} onRetry={() => void load(submitted)} />}
        {!loading && !error && (
          <>
            <p className="mb-2 text-xs text-gray-500">{total.toLocaleString()} organizations</p>
            <div className="overflow-x-auto rounded-xl border border-white/10">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="bg-ink-800/80 text-xs uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-3 py-2 font-medium">Organization</th>
                    <th className="px-3 py-2 font-medium">Plan</th>
                    <th className="px-3 py-2 font-medium">Members</th>
                    <th className="px-3 py-2 font-medium">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {orgs.map((org) => (
                    <tr
                      key={org.id}
                      onClick={() => setSelectedId(org.id)}
                      className={[
                        'cursor-pointer border-t border-white/5 transition',
                        selectedId === org.id ? 'bg-white/10' : 'hover:bg-white/5',
                      ].join(' ')}
                    >
                      <td className="px-3 py-2.5">
                        <div className="font-medium text-white">{org.name}</div>
                        <div className="font-mono text-[11px] text-gray-600">{org.id}</div>
                      </td>
                      <td className="px-3 py-2.5 text-gray-300">
                        {org.planCode ?? '—'}
                        {org.billingStatus ? (
                          <span className="ml-1 text-xs text-gray-500">({org.billingStatus})</span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2.5 text-gray-300">{org.memberCount}</td>
                      <td className="px-3 py-2.5 text-gray-400">{formatWhen(org.createdAt)}</td>
                    </tr>
                  ))}
                  {orgs.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-3 py-8 text-center text-gray-500">
                        No organizations match.
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
        {!selectedId && (
          <p className="text-sm text-gray-500">Select an organization to inspect membership, billing, and usage.</p>
        )}
        {selectedId && detailLoading && (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <SpinnerIcon className="animate-spin" width={14} height={14} /> Loading…
          </div>
        )}
        {detail && !detailLoading && (
          <div className="space-y-4 text-sm">
            <div>
              <h2 className="text-lg font-semibold text-white">{detail.name}</h2>
              <p className="mt-0.5 font-mono text-[11px] text-gray-600">{detail.id}</p>
            </div>
            <dl className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <dt className="text-gray-500">Join code</dt>
                <dd className="font-mono text-gray-200">{detail.joinCode}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Plan</dt>
                <dd className="text-gray-200">
                  {detail.planCode ?? '—'} / {detail.billingStatus ?? '—'}
                </dd>
              </div>
              <div>
                <dt className="text-gray-500">Seats</dt>
                <dd className="text-gray-200">{detail.seats ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Type</dt>
                <dd className="text-gray-200">{detail.contractorType ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Job briefs</dt>
                <dd className="text-gray-200">{detail.jobBriefCount}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Proofs</dt>
                <dd className="text-gray-200">{detail.jobProofCount}</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-gray-500">Stripe customer</dt>
                <dd className="font-mono text-gray-200">{detail.stripeCustomerId ?? '—'}</dd>
              </div>
            </dl>
            <div>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">
                Members ({detail.members.length})
              </h3>
              <ul className="max-h-80 space-y-2 overflow-y-auto">
                {detail.members.map((m) => (
                  <li key={m.userId} className="rounded-lg border border-white/5 bg-ink-900/50 px-2.5 py-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-medium text-gray-100">{m.fullName || m.email || 'Unknown'}</p>
                        <p className="text-xs text-gray-500">{m.email}</p>
                      </div>
                      <Link
                        to={`/admin/users?q=${encodeURIComponent(m.email || m.userId)}`}
                        className="text-xs text-brand-300 hover:text-brand-200"
                      >
                        Open
                      </Link>
                    </div>
                    <p className="mt-1 text-xs text-gray-400">
                      {m.role} · {m.status}
                      {m.bannedUntil ? ' · banned' : ''}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}
