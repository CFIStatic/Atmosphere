import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError, defaultRange } from '../lib/api';
import type { AccountDetail } from '../lib/types';
import { count, dateTime, hours, money } from '../lib/format';
import { StatusPill } from '../components/ui';
import { KpiStrip, Loading, PageHeader, Section } from '../components/report';
import { DownloadButton } from '../components/DownloadButton';
import { centsToUsd } from '../lib/excel';

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

  if (loading) return <Loading label="Loading account" />;
  if (error || !data) {
    return (
      <div>
        <p className="text-[13px] text-danger-600">{error ?? 'Not found'}</p>
        <Link to="/accounts" className="mt-3 inline-block text-[13px] text-brand-600 hover:underline">
          Back to organizations
        </Link>
      </div>
    );
  }

  const { account } = data;
  const slug = account.orgName || account.orgId;

  return (
    <div>
      <nav aria-label="Breadcrumb" className="mb-2 text-[12px] text-ink-500">
        <Link to="/accounts" className="hover:text-brand-600 hover:underline">
          Organizations
        </Link>
        <span className="mx-1.5" aria-hidden="true">
          /
        </span>
        <span>{account.orgName}</span>
      </nav>
      <PageHeader
        eyebrow="Growth & revenue · Organization"
        title={account.orgName}
        subtitle={
          <>
            <StatusPill status={account.status} /> <span className="ml-1">{account.planName} · {account.billingInterval} · created {dateTime(account.createdAt)}</span>
            {account.internal && (
              <span className="ml-2 text-[11px] font-semibold uppercase tracking-wide text-caution-600">
                internal{account.internalReason ? ` · ${account.internalReason}` : ''}
              </span>
            )}
          </>
        }
      />

      <KpiStrip
        download={{ table: `${slug}-summary`, label: 'organization summary' }}
        items={[
          { label: 'MRR', unit: `USD · ARR ${money(account.arrCents)}`, value: money(account.mrrCents), raw: centsToUsd(account.mrrCents), rawType: 'usd' },
          { label: 'Field Capture seats', unit: 'in use / licensed', value: `${count(account.seatsUsed ?? 0)}/${count(account.seats)}`, raw: account.seats, rawType: 'integer', note: `${count(account.members)} members` },
          { label: 'AI cost', unit: 'USD provider cost, period', value: money(account.aiCostCents ?? 0), raw: centsToUsd(account.aiCostCents ?? 0), rawType: 'usd' },
          { label: 'Hours', unit: account.topFeature ? `top tool: ${account.topFeature}` : 'no usage', value: hours(account.activeHours), raw: account.activeHours, rawUnit: 'hours' },
          { label: 'Collected', unit: `USD, last active ${dateTime(account.lastActiveAt)}`, value: money(account.revenueInRangeCents), raw: centsToUsd(account.revenueInRangeCents), rawType: 'usd' },
        ]}
      />

      <Section
        title="Members"
        note={`${count(data.members.length)} people`}
        actions={
          <DownloadButton
            table={`${slug}-members`}
            label="members"
            disabled={data.members.length === 0}
            sheets={() => [
              {
                name: 'Members',
                columns: [
                  { header: 'Name' },
                  { header: 'Email' },
                  { header: 'Role' },
                  { header: 'Work' },
                  { header: 'Status' },
                  { header: 'Joined', type: 'date' },
                  { header: 'User id' },
                ],
                rows: data.members.map((m) => [m.fullName, m.email, m.role.replaceAll('_', ' '), m.workType, m.status, m.createdAt, m.userId]),
              },
            ]}
          />
        }
      >
        <div className="overflow-x-auto">
          <table className="report-table min-w-[640px]">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Work</th>
                <th className="num">Joined</th>
              </tr>
            </thead>
            <tbody>
              {data.members.map((member) => (
                <tr key={member.userId}>
                  <td className="font-medium text-ink-900">{member.fullName ?? '—'}</td>
                  <td className="text-ink-600">{member.email ?? '—'}</td>
                  <td>{member.role.replaceAll('_', ' ')}</td>
                  <td className="text-ink-600">{member.workType ?? '—'}</td>
                  <td className="num whitespace-nowrap text-ink-600">{dateTime(member.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section
        title="Jobs"
        note={`${count(data.jobs.total)} live${data.jobs.deleted ? ` · ${count(data.jobs.deleted)} deleted, not counted` : ''} · most recent shown`}
        actions={
          <DownloadButton
            table={`${slug}-jobs`}
            label="jobs"
            sheets={() => [
              {
                name: 'Recent jobs',
                columns: [
                  { header: 'Job number', type: 'integer' },
                  { header: 'Title' },
                  { header: 'Status' },
                  { header: 'Type' },
                  { header: 'Opened', type: 'date' },
                  { header: 'Job id' },
                ],
                rows: data.jobs.recent.map((j) => [j.jobNumber, j.title, j.status, j.workType, j.createdAt, j.id]),
              },
              {
                name: 'Jobs by status',
                columns: [{ header: 'Status' }, { header: 'Jobs', type: 'integer' }],
                rows: [...data.jobs.byStatus.map((r) => [r.status, r.count]), ['Total', data.jobs.total]],
              },
            ]}
          />
        }
      >
        <div className="mb-3 flex flex-wrap gap-1.5">
          {data.jobs.byStatus.map((row) => (
            <span key={row.status} className="border border-line px-2 py-0.5 text-[11.5px] text-ink-600">
              {row.status} · <span className="tabular-nums">{row.count}</span>
            </span>
          ))}
        </div>
        <div className="overflow-x-auto">
          <table className="report-table min-w-[560px]">
            <thead>
              <tr>
                <th>Job</th>
                <th>Status</th>
                <th>Type</th>
                <th className="num">Opened</th>
              </tr>
            </thead>
            <tbody>
              {data.jobs.recent.map((job) => (
                <tr key={job.id}>
                  <td>
                    {job.jobNumber != null && <span className="mr-2 text-[11.5px] tabular-nums text-ink-500">#{job.jobNumber}</span>}
                    {job.title}
                  </td>
                  <td>
                    <StatusPill status={job.status} />
                  </td>
                  <td className="text-ink-600">{job.workType ?? '—'}</td>
                  <td className="num whitespace-nowrap text-ink-600">{dateTime(job.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section
        title="Product time"
        note="This period"
        actions={
          <DownloadButton
            table={`${slug}-product-time`}
            label="product time"
            disabled={data.features.length === 0}
            sheets={() => [
              {
                name: 'Product time',
                columns: [
                  { header: 'Tool' },
                  { header: 'Feature key' },
                  { header: 'Hours', type: 'number' },
                  { header: 'Sessions', type: 'integer' },
                ],
                rows: data.features.map((f) => [f.label, f.featureKey, f.activeHours, f.sessions]),
              },
            ]}
          />
        }
      >
        <div className="max-w-2xl overflow-x-auto">
          <table className="report-table">
            <thead>
              <tr>
                <th>Tool</th>
                <th className="num">Hours</th>
                <th className="num">Sessions</th>
              </tr>
            </thead>
            <tbody>
              {data.features.map((feature) => (
                <tr key={feature.featureKey}>
                  <td>{feature.label}</td>
                  <td className="num">{hours(feature.activeHours)}</td>
                  <td className="num">{count(feature.sessions)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}
