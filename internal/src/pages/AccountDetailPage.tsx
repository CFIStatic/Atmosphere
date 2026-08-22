import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError, defaultRange } from '../lib/api';
import type { AccountDetail } from '../lib/types';
import { count, dateTime, hours, money } from '../lib/format';
import { SectionHeading, StatTile, StatusPill } from '../components/ui';

export function AccountDetailPage() {
  const { orgId } = useParams();
  const range = useMemo(() => defaultRange(), []);
  const [data, setData] = useState<AccountDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!orgId) return;
      setLoading(true);
      setError(null);
      try {
        const detail = await api.account(orgId, range);
        if (!cancelled) setData(detail);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Could not load account');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId, range]);

  if (loading) return <p className="text-ink-500">Loading account…</p>;
  if (error || !data) {
    return (
      <div>
        <p className="text-sm text-danger-600">{error ?? 'Not found'}</p>
        <Link to="/accounts" className="mt-3 inline-block text-sm text-brand-600 hover:underline">
          Back to accounts
        </Link>
      </div>
    );
  }

  const { account } = data;

  return (
    <div>
      <p className="text-sm text-ink-500">
        <Link to="/accounts" className="hover:text-brand-600">
          Accounts
        </Link>
        <span className="mx-2">/</span>
        {account.orgName}
      </p>
      <div className="mt-2 flex items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{account.orgName}</h1>
        <StatusPill status={account.status} />
      </div>
      <p className="mt-1 text-sm text-ink-500">
        {account.planName} · {account.billingInterval} · created {dateTime(account.createdAt)}
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="MRR" value={money(account.mrrCents)} footnote={`ARR ${money(account.arrCents)}`} />
        <StatTile
          label="Seats"
          value={`${count(account.members)}/${count(account.seats)}`}
          footnote="members / licensed"
        />
        <StatTile label="Hours" value={hours(account.activeHours)} footnote={account.topFeature ?? 'No usage'} />
        <StatTile
          label="Collected"
          value={money(account.revenueInRangeCents)}
          footnote={`Last active ${dateTime(account.lastActiveAt)}`}
        />
      </div>

      <SectionHeading title="Members" hint={`${count(data.members.length)} people`} />
      <div className="overflow-hidden rounded-xl border border-line bg-paper-0">
        <table className="w-full text-sm">
          <thead className="bg-paper-50 text-left text-[11px] uppercase tracking-wide text-ink-500">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Work</th>
              <th className="px-4 py-3">Joined</th>
            </tr>
          </thead>
          <tbody>
            {data.members.map((member) => (
              <tr key={member.userId} className="border-t border-line">
                <td className="px-4 py-3 font-medium">{member.fullName ?? '—'}</td>
                <td className="px-4 py-3 font-mono text-ink-600">{member.email ?? '—'}</td>
                <td className="px-4 py-3">{member.role.replaceAll('_', ' ')}</td>
                <td className="px-4 py-3 text-ink-600">{member.workType ?? '—'}</td>
                <td className="px-4 py-3 text-ink-500">{dateTime(member.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <SectionHeading title="Jobs" hint={`${count(data.jobs.total)} on file`} />
      <div className="mb-4 flex flex-wrap gap-2">
        {data.jobs.byStatus.map((row) => (
          <span key={row.status} className="rounded-full border border-line px-3 py-1 text-xs text-ink-600">
            {row.status} · {row.count}
          </span>
        ))}
      </div>
      <div className="overflow-hidden rounded-xl border border-line bg-paper-0">
        <table className="w-full text-sm">
          <thead className="bg-paper-50 text-left text-[11px] uppercase tracking-wide text-ink-500">
            <tr>
              <th className="px-4 py-3">Job</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3 text-right">Opened</th>
            </tr>
          </thead>
          <tbody>
            {data.jobs.recent.map((job) => (
              <tr key={job.id} className="border-t border-line">
                <td className="px-4 py-3">
                  {job.jobNumber != null && (
                    <span className="mr-2 font-mono text-xs text-ink-500">#{job.jobNumber}</span>
                  )}
                  {job.title}
                </td>
                <td className="px-4 py-3">
                  <StatusPill status={job.status} />
                </td>
                <td className="px-4 py-3 text-ink-600">{job.workType ?? '—'}</td>
                <td className="px-4 py-3 text-right text-ink-500">{dateTime(job.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <SectionHeading title="Product time" hint="This period" />
      <div className="overflow-hidden rounded-xl border border-line bg-paper-0">
        <table className="w-full text-sm">
          <thead className="bg-paper-50 text-left text-[11px] uppercase tracking-wide text-ink-500">
            <tr>
              <th className="px-4 py-3">Tool</th>
              <th className="px-4 py-3 text-right">Hours</th>
              <th className="px-4 py-3 text-right">Sessions</th>
            </tr>
          </thead>
          <tbody>
            {data.features.map((feature) => (
              <tr key={feature.featureKey} className="border-t border-line">
                <td className="px-4 py-3">{feature.label}</td>
                <td className="px-4 py-3 text-right font-mono">{hours(feature.activeHours)}</td>
                <td className="px-4 py-3 text-right font-mono">{count(feature.sessions)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
