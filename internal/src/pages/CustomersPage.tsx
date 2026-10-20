import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, ExternalLink, Search } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { count, dateTime, money } from '../lib/format';
import {
  filterCounts,
  filterCustomers,
  humanize,
  initials,
  relativeDay,
  seatLabel,
  sortCustomers,
  type CustomerFilter,
  type CustomerOrg,
  type CustomerPerson,
  type CustomerSort,
  type CustomersResponse,
} from '../lib/customers';
import { ErrorLine, KpiStrip, Loading, PageHeader, Section } from '../components/report';

const FILTERS: Array<[CustomerFilter, string]> = [
  ['all', 'All'],
  ['paying', 'Paying'],
  ['trial', 'Trial'],
  ['comped', 'Comped'],
  ['test', 'Test / staff'],
];

const STATUS_TONE: Record<string, string> = {
  paying: 'border-success-600/40 bg-success-600/10 text-success-600',
  trial: 'border-brand-500/50 bg-brand-500/10 text-brand-600',
  comped: 'border-caution-600/40 bg-caution-600/10 text-caution-600',
  unpaid: 'border-danger-600/40 bg-danger-600/10 text-danger-600',
  none: 'border-line-strong text-ink-500',
};

function Pill({ label, tone }: { label: string; tone: string }) {
  return (
    <span className={`inline-block whitespace-nowrap border px-1.5 py-px text-[10px] font-semibold uppercase tracking-[0.06em] ${tone}`}>
      {label}
    </span>
  );
}

function Monogram({ name, round }: { name: string | null; round?: boolean }) {
  return (
    <span
      aria-hidden
      className={`inline-flex shrink-0 items-center justify-center border border-line bg-paper-100 font-semibold text-ink-700 ${
        round ? 'h-7 w-7 rounded-full text-[10.5px]' : 'h-8 w-8 text-[11px]'
      }`}
    >
      {initials(name)}
    </span>
  );
}

/** "Staff · Test name · Excluded: design partner" in quiet ink under the org name. */
function flagLabel(flag: string): string {
  const [head, ...rest] = flag.split(':');
  const label = humanize(head);
  return rest.length ? `${label}: ${rest.join(':').trim()}` : label;
}

function billingTone(org: CustomerOrg): string {
  const s = (org.billingStatus ?? '').toLowerCase();
  if (s === 'active') return 'bg-success-600';
  if (s === 'trialing' || s === 'trial') return 'bg-brand-500';
  if (s === 'past_due' || s === 'unpaid' || s === 'incomplete' || s === 'canceled') return 'bg-danger-600';
  return 'bg-ink-400';
}

function BillingCell({ org }: { org: CustomerOrg }) {
  if (!org.stripeCustomerId) return <span className="whitespace-nowrap text-ink-400">No Stripe</span>;
  return (
    <div className="whitespace-nowrap">
      <span className="inline-flex items-center gap-1.5 text-ink-800">
        <span className={`h-1.5 w-1.5 rounded-full ${billingTone(org)}`} aria-hidden />
        {humanize(org.billingStatus ?? 'customer')}
      </span>
      <div className="mt-0.5 text-[11.5px] text-ink-500">{org.stripeLive === false ? 'Test mode' : 'Live'}</div>
    </div>
  );
}

/** "FC 2 of 3" with a thin meter; amber when more seats are in use than the plan allows. */
function SeatsCell({ org }: { org: CustomerOrg }) {
  const allowed = org.includedFcSeats + org.extraFcSeats;
  const used = org.fcSeatsUsed;
  const over = used !== null && used > allowed;
  const pct = used === null || allowed === 0 ? 0 : Math.min(100, (used / allowed) * 100);
  return (
    <div className="whitespace-nowrap">
      <div className="text-ink-800">{org.planCode ? humanize(org.planCode, true) : <span className="text-ink-400">No plan</span>}</div>
      <div className="mt-1 flex items-center gap-2 text-[11.5px] text-ink-500">
        <span className="relative h-1 w-8 overflow-hidden bg-paper-200" aria-hidden>
          <span className={`absolute inset-y-0 left-0 ${over ? 'bg-caution-600' : 'bg-brand-500'}`} style={{ width: `${over ? 100 : pct}%` }} />
        </span>
        <span className={over ? 'font-medium text-caution-600' : undefined} title="Field Capture seats in use of seats on the plan">
          {used === null ? '—' : count(used)}/{count(allowed)} FC
        </span>
        {org.platformSeats > 0 && <span>· {count(org.platformSeats)} platform</span>}
      </div>
    </div>
  );
}

function DateCell({ value, relative }: { value: string | null; relative?: boolean }) {
  const ago = relative ? relativeDay(value) : null;
  return (
    <div className="whitespace-nowrap">
      <div className={value ? 'text-ink-800' : 'text-ink-400'}>{dateTime(value)}</div>
      {ago && <div className="mt-0.5 text-[11.5px] text-ink-500">{ago}</div>}
    </div>
  );
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

      <KpiStrip
        items={[
          { label: 'Organizations', unit: 'workspaces, all statuses', value: count(all.length) },
          { label: 'People', unit: 'accounts in a workspace', value: count(people) },
          { label: 'Paying', unit: 'organizations', value: count(counts.paying) },
          { label: 'Paying MRR', unit: 'USD / month, live Stripe', value: money(mrr) },
          { label: 'On trial', unit: 'organizations', value: count(counts.trial) },
          { label: 'Comped', unit: 'organizations', value: count(counts.comped) },
        ]}
      />

      <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-3">
        <label htmlFor="customer-search" className="sr-only">
          Find an organization
        </label>
        <div className="relative min-w-[240px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500" aria-hidden />
          <input
            id="customer-search"
            type="search"
            autoFocus
            placeholder="Find an organization, owner, person, email, plan, or org id"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="field w-full py-2 pl-9 text-[14px]"
          />
        </div>
        <div className="flex flex-wrap" role="group" aria-label="Filter">
          {FILTERS.map(([key, label]) => {
            const on = filter === key;
            return (
              <button
                key={key}
                type="button"
                aria-pressed={on}
                onClick={() => setFilter(key)}
                className={`-ml-px inline-flex items-center gap-1.5 border px-3 py-[7px] text-[12.5px] font-medium transition first:ml-0 focus-visible:z-10 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500 ${
                  on ? 'z-[1] border-ink-900 bg-ink-900 text-paper-0' : 'border-line-strong bg-paper-0 text-ink-700 hover:text-ink-900'
                }`}
              >
                {label}
                <span className={`tabular-nums text-[11px] ${on ? 'opacity-70' : 'text-ink-500'}`}>{count(counts[key])}</span>
              </button>
            );
          })}
        </div>
      </div>

      {error && <ErrorLine message={error} onRetry={() => void load()} />}

      <Section
        title={`${count(rows.length)} ${rows.length === 1 ? 'organization' : 'organizations'}`}
        note={query ? `Matching “${query.trim()}”` : 'Click a row to see its people'}
      >
        <div className="overflow-x-auto">
          <table className="report-table min-w-[1080px]">
            <thead>
              <tr>
                <SortHead label="Organization" k="name" sort={sort} dir={dir} onSort={onSort} />
                <th>Owner</th>
                <th>Plan · seats</th>
                <th>Billing</th>
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
                    <tr
                      className={`cursor-pointer [&>td]:!py-2.5 ${expanded ? '[&>td]:!border-b-0 [&>td]:!bg-paper-50' : ''}`}
                      onClick={() => toggle(org.orgId)}
                      aria-expanded={expanded}
                    >
                      <td>
                        <div className="flex items-start gap-2.5">
                          {expanded ? (
                            <ChevronDown className="mt-2 h-3.5 w-3.5 shrink-0 text-ink-500" />
                          ) : (
                            <ChevronRight className="mt-2 h-3.5 w-3.5 shrink-0 text-ink-500" />
                          )}
                          <Monogram name={org.name} />
                          <div className="min-w-[136px]">
                            <div className="font-semibold text-ink-900">{org.name}</div>
                            <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1">
                              <Pill label={org.status} tone={STATUS_TONE[org.status] ?? STATUS_TONE.none!} />
                              {org.flags.length > 0 && (
                                <span className="text-[11.5px] text-ink-500" title={org.flags.join(', ')}>
                                  {org.flags.map(flagLabel).join(' · ')}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td>
                        {org.ownerEmail || org.ownerName ? (
                          <div className="max-w-[200px]" title={org.ownerEmail ?? undefined}>
                            <div className="truncate text-ink-800">{org.ownerName ?? org.ownerEmail}</div>
                            {org.ownerName && org.ownerEmail && <div className="mt-0.5 truncate text-[11.5px] text-ink-500">{org.ownerEmail}</div>}
                          </div>
                        ) : (
                          <span className="text-ink-400">No owner</span>
                        )}
                      </td>
                      <td>
                        <SeatsCell org={org} />
                      </td>
                      <td>
                        <BillingCell org={org} />
                      </td>
                      <td className={`num font-medium ${org.mrrCents > 0 ? 'text-ink-900' : '!text-ink-400'}`}>{money(org.mrrCents)}</td>
                      <td className="num">{count(org.memberCount)}</td>
                      <td className="num">{count(org.jobsCount)}</td>
                      <td className="num">
                        <DateCell value={org.createdAt} />
                      </td>
                      <td className="num">
                        <DateCell value={org.lastActivityAt} relative />
                      </td>
                    </tr>
                    {expanded && (
                      <tr className="[&>td]:!bg-paper-50">
                        <td colSpan={9} className="!px-3 !pb-4 !pt-0">
                          <div className="ml-[22px] border-l-2 border-brand-500 bg-paper-0">
                            <div className="flex items-baseline justify-between border-b border-line px-4 py-2">
                              <p className="eyebrow">People in {org.name}</p>
                              <p className="text-[11.5px] text-ink-500">
                                {count(org.people.length)} {org.people.length === 1 ? 'person' : 'people'}
                              </p>
                            </div>
                            {org.people.length === 0 ? (
                              <p className="px-4 py-5 text-center text-[13px] text-ink-500">No members.</p>
                            ) : (
                              <ul className="divide-y divide-line">
                                {org.people.map((p) => (
                                  <li key={p.userId} className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,0.9fr)_auto] items-center gap-4 px-4 py-2.5">
                                    <div className="flex min-w-0 items-center gap-2.5">
                                      <Monogram name={p.name ?? p.email} round />
                                      <div className="min-w-0">
                                        <div className="flex items-center gap-1.5">
                                          <span className="truncate font-medium text-ink-900">{p.name ?? p.email ?? '—'}</span>
                                          {p.isOwner && <Pill label="Owner" tone="border-brand-500/50 bg-brand-500/10 text-brand-600" />}
                                        </div>
                                        <div className="truncate text-[11.5px] text-ink-500">{p.email ?? '—'}</div>
                                      </div>
                                    </div>
                                    <div className="min-w-0">
                                      <div className="text-ink-800">{humanize(p.role)}</div>
                                      {seatLabel(p.seatType) && <div className="text-[11.5px] text-ink-500">{seatLabel(p.seatType)} seat</div>}
                                    </div>
                                    <div className="min-w-0">
                                      <div className="text-[11px] uppercase tracking-[0.06em] text-ink-500">Last sign-in</div>
                                      <div className="text-ink-800">
                                        {p.lastSignInAt ? dateTime(p.lastSignInAt) : <span className="text-ink-400">Never</span>}
                                        {relativeDay(p.lastSignInAt) && <span className="ml-1.5 text-[11.5px] text-ink-500">{relativeDay(p.lastSignInAt)}</span>}
                                      </div>
                                    </div>
                                    <button
                                      type="button"
                                      className="btn-quiet inline-flex items-center gap-1"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setPending({ org, person: p });
                                      }}
                                    >
                                      Open account <ExternalLink className="h-3 w-3" />
                                    </button>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
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
