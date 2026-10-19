import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, ExternalLink, Search } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { count, dateTime, money, shortDate } from '../lib/format';
import {
  filterCounts,
  filterCustomers,
  sortCustomers,
  type CustomerFilter,
  type CustomerOrg,
  type CustomerPerson,
  type CustomerSort,
  type CustomersResponse,
} from '../lib/customers';
import { ErrorLine, Loading, PageHeader, Section } from '../components/report';

const FILTERS: Array<[CustomerFilter, string]> = [
  ['all', 'All'],
  ['paying', 'Paying'],
  ['trial', 'Trial'],
  ['comped', 'Comped'],
  ['test', 'Test / staff'],
];

const STATUS_TONE: Record<string, string> = {
  paying: 'border-success-600/40 text-success-600',
  trial: 'border-brand-500/50 text-brand-600',
  comped: 'border-caution-600/40 text-caution-600',
  unpaid: 'border-danger-600/40 text-danger-600',
  none: 'border-line-strong text-ink-500',
};

function Pill({ label, tone }: { label: string; tone: string }) {
  return (
    <span className={`inline-block whitespace-nowrap border px-1.5 py-px text-[10px] font-semibold uppercase tracking-[0.06em] ${tone}`}>
      {label}
    </span>
  );
}

function stripeLabel(org: CustomerOrg): string {
  if (!org.stripeCustomerId) return 'No Stripe';
  const mode = org.stripeLive === false ? 'test mode' : 'live';
  return `${org.billingStatus ?? 'customer'} · ${mode}`;
}

function SortHead({
  label,
  k,
  sort,
  dir,
  onSort,
  num,
}: {
  label: string;
  k: CustomerSort;
  sort: CustomerSort;
  dir: 'asc' | 'desc';
  onSort: (k: CustomerSort) => void;
  num?: boolean;
}) {
  const active = sort === k;
  return (
    <th className={num ? 'num' : undefined} aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" onClick={() => onSort(k)} className={`uppercase tracking-[inherit] ${active ? 'text-ink-900' : ''}`}>
        {label}
        {active ? (dir === 'asc' ? ' ▲' : ' ▼') : ''}
      </button>
    </th>
  );
}

export function CustomersPage() {
  const [data, setData] = useState<CustomersResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<CustomerFilter>('all');
  const [sort, setSort] = useState<CustomerSort>('activity');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<{ org: CustomerOrg; person: CustomerPerson } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.customers());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load customers.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    let alive = true;
    api
      .customers()
      .then((d) => alive && setData(d))
      .catch((err: unknown) => alive && setError(err instanceof ApiError ? err.message : 'Could not load customers.'))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  const all = useMemo(() => data?.customers ?? [], [data]);
  const counts = useMemo(() => filterCounts(all), [all]);
  const rows = useMemo(() => sortCustomers(filterCustomers(all, query, filter), sort, dir), [all, query, filter, sort, dir]);
  const people = useMemo(() => all.reduce((n, o) => n + o.memberCount, 0), [all]);
  const mrr = useMemo(() => all.reduce((n, o) => n + (o.status === 'paying' ? o.mrrCents : 0), 0), [all]);

  const onSort = (k: CustomerSort) => {
    if (k === sort) setDir(dir === 'asc' ? 'desc' : 'asc');
    else {
      setSort(k);
      setDir(k === 'name' ? 'asc' : 'desc');
    }
  };
  const toggle = (id: string) => {
    const next = new Set(open);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setOpen(next);
  };

  if (loading && !data) return <Loading label="Loading customers" />;

  return (
    <div>
      <PageHeader
        eyebrow="Growth & revenue"
        title="Customers"
        subtitle="Every workspace and everyone in it. Internal staff only. Opening an account is logged."
        asOfValue={data?.generatedAt ?? null}
      />

      <div className="mb-5 border border-line bg-paper-0 p-4">
        <label htmlFor="customer-search" className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">
          Find an organization
        </label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500" aria-hidden />
          <input
            id="customer-search"
            type="search"
            autoFocus
            placeholder="Organization, owner, person, email, plan, or org id"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="field w-full py-2.5 pl-9 text-[15px]"
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-1" role="group" aria-label="Filter">
          {FILTERS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              aria-pressed={filter === key}
              onClick={() => setFilter(key)}
              className={`btn-quiet ${filter === key ? 'border-ink-900 bg-ink-900 text-paper-0 hover:text-paper-0' : ''}`}
            >
              {label} <span className="ml-1 tabular-nums opacity-70">{count(counts[key])}</span>
            </button>
          ))}
          <span className="ml-auto text-[12px] text-ink-500">
            {count(all.length)} organizations · {count(people)} people · {money(mrr)} paying MRR
          </span>
        </div>
      </div>

      {error && <ErrorLine message={error} onRetry={() => void load()} />}

      <Section title={`${count(rows.length)} organizations`} note={query ? `Matching “${query.trim()}”` : 'Click a row to see its people'}>
        <div className="overflow-x-auto">
          <table className="report-table min-w-[1080px]">
            <thead>
              <tr>
                <SortHead label="Organization" k="name" sort={sort} dir={dir} onSort={onSort} />
                <th>Owner</th>
                <th>Plan · seats</th>
                <th>Stripe</th>
                <SortHead label="MRR" k="mrr" sort={sort} dir={dir} onSort={onSort} num />
                <SortHead label="Members" k="members" sort={sort} dir={dir} onSort={onSort} num />
                <SortHead label="Jobs" k="jobs" sort={sort} dir={dir} onSort={onSort} num />
                <SortHead label="Created" k="created" sort={sort} dir={dir} onSort={onSort} num />
                <SortHead label="Last activity" k="activity" sort={sort} dir={dir} onSort={onSort} num />
              </tr>
            </thead>
            <tbody>
              {rows.map((org) => {
                const expanded = open.has(org.orgId);
                return (
                  <Fragment key={org.orgId}>
                    <tr className="cursor-pointer hover:bg-paper-50" onClick={() => toggle(org.orgId)} aria-expanded={expanded}>
                      <td>
                        <span className="inline-flex items-center gap-1.5">
                          {expanded ? <ChevronDown className="h-3.5 w-3.5 text-ink-500" /> : <ChevronRight className="h-3.5 w-3.5 text-ink-500" />}
                          <span className="font-medium text-ink-900">{org.name}</span>
                        </span>
                        <span className="ml-2">
                          <Pill label={org.status} tone={STATUS_TONE[org.status] ?? STATUS_TONE.none!} />
                        </span>
                        {org.flags.map((f) => (
                          <span key={f} className="ml-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-caution-600" title={f}>
                            {f.split(':')[0]}
                          </span>
                        ))}
                      </td>
                      <td className="text-ink-600">{org.ownerEmail ?? '—'}</td>
                      <td className="text-ink-600">
                        {org.planCode ?? '—'}
                        <span className="ml-1 text-[11.5px] text-ink-500">
                          {count(org.platformSeats)} platform · {count(org.includedFcSeats + org.extraFcSeats)} FC
                        </span>
                      </td>
                      <td className="text-ink-600">{stripeLabel(org)}</td>
                      <td className="num">{money(org.mrrCents)}</td>
                      <td className="num">{count(org.memberCount)}</td>
                      <td className="num">{count(org.jobsCount)}</td>
                      <td className="num whitespace-nowrap text-ink-600">{shortDate(org.createdAt)}</td>
                      <td className="num whitespace-nowrap text-ink-600">{dateTime(org.lastActivityAt)}</td>
                    </tr>
                    {expanded && (
                      <tr className="bg-paper-50">
                        <td colSpan={9} className="!p-0">
                          <table className="report-table ml-8 w-[calc(100%-2rem)]">
                            <thead>
                              <tr>
                                <th>Person</th>
                                <th>Email</th>
                                <th>Role · seat</th>
                                <th className="num">Last sign-in</th>
                                <th className="num">Support</th>
                              </tr>
                            </thead>
                            <tbody>
                              {org.people.map((p) => (
                                <tr key={p.userId}>
                                  <td className="font-medium text-ink-900">
                                    {p.name ?? '—'}
                                    {p.isOwner && <span className="ml-1.5 text-[10.5px] font-semibold uppercase text-brand-600">owner</span>}
                                  </td>
                                  <td className="text-ink-600">{p.email ?? '—'}</td>
                                  <td className="text-ink-600">
                                    {p.role ?? '—'}
                                    {p.seatType && <span className="ml-1 text-[11.5px] text-ink-500">· {p.seatType}</span>}
                                  </td>
                                  <td className="num whitespace-nowrap text-ink-600">{dateTime(p.lastSignInAt)}</td>
                                  <td className="num">
                                    <button
                                      type="button"
                                      className="btn-quiet inline-flex items-center gap-1"
                                      onClick={() => setPending({ org, person: p })}
                                    >
                                      Open account <ExternalLink className="h-3 w-3" />
                                    </button>
                                  </td>
                                </tr>
                              ))}
                              {org.people.length === 0 && (
                                <tr>
                                  <td colSpan={5} className="py-4 text-center text-ink-500">
                                    No members.
                                  </td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-ink-500">
                    No organizations match.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Section>

      {pending && <OpenAccountDialog org={pending.org} person={pending.person} onClose={() => setPending(null)} />}
    </div>
  );
}

function OpenAccountDialog({ org, person, onClose }: { org: CustomerOrg; person: CustomerPerson; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const who = person.name ?? person.email ?? 'this person';

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const created = await api.openSupportSession({ orgId: org.orgId, userId: person.userId, reason: reason.trim() || undefined });
      window.open(created.openUrl, '_blank', 'noopener');
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not open the account.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/40 p-4" role="dialog" aria-modal="true" aria-labelledby="open-account-title">
      <div className="w-full max-w-md border border-line bg-paper-0 p-5 shadow-xl">
        <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">Staff support</div>
        <h2 id="open-account-title" className="mt-1 text-lg font-semibold text-ink-900">
          View Platform as {who}
        </h2>
        <p className="mt-2 text-[13px] text-ink-600">
          Opens {org.name} in a new tab exactly as {who} sees it ({person.role ?? 'member'}), for 30 minutes. Your name, the time and the
          reason are recorded. Billing, seat and account changes are blocked.
        </p>
        <label htmlFor="support-reason" className="mt-4 block text-[12px] font-medium text-ink-700">
          Reason (optional)
        </label>
        <input
          id="support-reason"
          className="field mt-1 w-full"
          placeholder="e.g. Ticket 1042: upload stuck on a job"
          value={reason}
          maxLength={500}
          onChange={(e) => setReason(e.target.value)}
        />
        {error && <p className="mt-3 text-[12.5px] text-danger-600">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn-quiet" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-quiet border-ink-900 bg-ink-900 text-paper-0 hover:text-paper-0"
            onClick={() => void submit()}
            disabled={busy}
          >
            {busy ? 'Opening…' : 'Open account'}
          </button>
        </div>
      </div>
    </div>
  );
}
