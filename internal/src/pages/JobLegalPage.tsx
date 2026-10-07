import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import type { LegalHold, UserActivityEvent } from '../lib/types';
import { count, dateTime } from '../lib/format';
import { EmptyState, StatusPill } from '../components/ui';
import { KpiStrip, Loading, PageHeader, Section } from '../components/report';
import { DownloadButton } from '../components/DownloadButton';
import { activitySheet } from '../lib/exportSheets';

interface StaffJobPortal {
  job: { id: string; title: string | null; jobNumber: number | null; orgId: string };
  hold: LegalHold | null;
  holds: LegalHold[];
  clips: Array<{
    id: string;
    title: string | null;
    userDeleted: boolean;
    legalHold: boolean;
    contentHash: string | null;
    receivedAt: string | null;
  }>;
  counts: { clips: number; onHold: number; userDeleted: number; jobOnHold: boolean };
  videos: Array<{ id: string; sourceId: string; userDeletedAt: string | null }>;
  activity: UserActivityEvent[];
}

export function JobLegalPage() {
  const { jobId } = useParams();
  const [data, setData] = useState<StaffJobPortal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    setLoading(true);
    api
      .staffJobLegal(jobId)
      .then((payload) => {
        if (!cancelled) setData(payload);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not open job portal');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  if (loading) return <Loading label="Opening job legal portal" />;
  if (error || !data) {
    return (
      <div>
        <p className="text-[13px] text-danger-600">{error ?? 'Not found'}</p>
        <Link to="/legal" className="mt-3 inline-block text-[13px] text-brand-600 hover:underline">
          Back to Legal
        </Link>
      </div>
    );
  }

  const jobSlug = `job-${data.job.id.slice(0, 8)}`;

  return (
    <div>
      <nav aria-label="Breadcrumb" className="mb-2 text-[12px] text-ink-500">
        <Link to="/legal" className="hover:text-brand-600 hover:underline">
          Legal holds
        </Link>
        <span className="mx-1.5" aria-hidden="true">
          /
        </span>
        <span>Job</span>
      </nav>
      <PageHeader
        eyebrow="System & access · Job legal portal"
        title={data.job.title ?? data.job.id}
        subtitle={
          <>
            {data.counts.jobOnHold && (
              <span className="mr-2">
                <StatusPill status="open" />
              </span>
            )}
            <span className="text-[12px]">{data.job.id}</span>
          </>
        }
      />

      <KpiStrip
        items={[
          { label: 'Vaulted clips', unit: 'count', value: String(data.counts.clips), raw: data.counts.clips, rawType: 'integer' },
          { label: 'Customer deleted', unit: 'still produceable', value: String(data.counts.userDeleted), raw: data.counts.userDeleted, rawType: 'integer' },
          { label: 'On hold', unit: 'count', value: String(data.counts.onHold), raw: data.counts.onHold, rawType: 'integer' },
        ]}
      />

      <Section title="Open holds" note={`${count(data.holds.length)} holds`}>
        {data.holds.length === 0 ? (
          <EmptyState title="No open hold" body="Open one from the job file or the Legal desk." />
        ) : (
          <ul className="divide-y divide-line border-y border-line">
            {data.holds.map((hold) => (
              <li key={hold.id} className="py-3">
                <div className="flex flex-wrap items-center gap-3">
                  <h3 className="text-[14px] font-semibold text-ink-900">{hold.title}</h3>
                  <StatusPill status={hold.status} />
                  <span className="text-[12px] text-ink-500">{hold.caseNumber}</span>
                </div>
                <p className="mt-1.5 text-[13px] text-ink-700">{hold.reason}</p>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        title="Vault"
        note="Includes clips the customer hid."
        actions={
          <DownloadButton
            table={`${jobSlug}-vault`}
            label="vaulted clips"
            disabled={data.clips.length === 0}
            sheets={() => [
              {
                name: 'Vault',
                columns: [
                  { header: 'Clip' },
                  { header: 'Clip id' },
                  { header: 'Received', type: 'datetime' },
                  { header: 'Customer deleted' },
                  { header: 'On hold' },
                  { header: 'Content hash' },
                ],
                rows: data.clips.map((c) => [c.title, c.id, c.receivedAt, c.userDeleted, c.legalHold, c.contentHash]),
              },
            ]}
          />
        }
      >
        {data.clips.length === 0 ? (
          <EmptyState title="No vaulted video" body="Uploads on this job land here automatically." />
        ) : (
          <ul className="divide-y divide-line border-y border-line">
            {data.clips.map((clip) => (
              <li key={clip.id} className="py-2.5 text-[13px]">
                <span>{clip.title ?? clip.id}</span>
                {clip.userDeleted && (
                  <span className="ml-2 text-[11.5px] text-danger-600">customer deleted — still available</span>
                )}
                {clip.legalHold && <span className="ml-2 text-[11.5px] text-ink-500">on hold</span>}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        title="Actions on this job"
        note={`${count(data.activity.length)} actions`}
        actions={
          <DownloadButton
            table={`${jobSlug}-actions`}
            label="actions on this job"
            disabled={data.activity.length === 0}
            sheets={() => [activitySheet('Actions on this job', data.activity)]}
          />
        }
      >
        {data.activity.length === 0 ? (
          <EmptyState title="No actions yet" body="The monitor writes a row after each signed-in request." />
        ) : (
          <div className="overflow-x-auto">
            <table className="report-table min-w-[560px]">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Who</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {data.activity.slice(0, 80).map((row) => (
                  <tr key={row.id}>
                    <td className="whitespace-nowrap text-ink-600">{dateTime(row.occurredAt)}</td>
                    <td>{row.actorEmail ?? row.actorLabel ?? '—'}</td>
                    <td className="text-[12px] text-ink-800">{row.action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}
