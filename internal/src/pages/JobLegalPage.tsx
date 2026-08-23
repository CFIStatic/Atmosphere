import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import type { LegalHold, UserActivityEvent } from '../lib/types';
import { dateTime } from '../lib/format';
import { EmptyState, SectionHeading, StatTile, StatusPill } from '../components/ui';

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

  if (loading) return <p className="text-ink-500">Opening job legal portal…</p>;
  if (error || !data) {
    return (
      <div>
        <p className="text-sm text-danger-600">{error ?? 'Not found'}</p>
        <Link to="/legal" className="mt-3 inline-block text-sm text-brand-600 hover:underline">
          Back to Legal
        </Link>
      </div>
    );
  }

  return (
    <div>
      <p className="text-sm text-ink-500">
        <Link to="/legal" className="hover:text-brand-600">
          Legal
        </Link>
        <span className="mx-2">/</span>
        Job
      </p>
      <div className="mt-2 flex items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{data.job.title ?? data.job.id}</h1>
        {data.counts.jobOnHold && <StatusPill status="open" />}
      </div>
      <p className="mt-1 font-mono text-xs text-ink-500">{data.job.id}</p>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <StatTile label="Vaulted clips" value={String(data.counts.clips)} />
        <StatTile label="Customer deleted" value={String(data.counts.userDeleted)} footnote="Still produceable" />
        <StatTile label="On hold" value={String(data.counts.onHold)} />
      </div>

      <SectionHeading title="Open holds" hint="Staff, or a preservation rule that fired on its own." />
      {data.holds.length === 0 ? (
        <EmptyState
          title="No open hold"
          body="Open one from the Legal desk. The automatic rules will also freeze this job on their own if the record starts looking disputed."
        />
      ) : (
        <ul className="grid gap-3">
          {data.holds.map((hold) => (
            <li key={hold.id} className="rounded-xl border border-line bg-paper-0 p-4">
              <div className="flex flex-wrap items-center gap-3">
                <h3 className="font-medium">{hold.title}</h3>
                <StatusPill status={hold.status} />
                {hold.origin === 'automatic' && (
                  <span className="rounded-full bg-brand-500/10 px-2 py-0.5 text-[11px] font-semibold text-brand-600">
                    automatic · {hold.autoRule}
                  </span>
                )}
                <span className="font-mono text-xs text-ink-500">{hold.caseNumber}</span>
              </div>
              <p className="mt-2 text-sm text-ink-600">{hold.reason}</p>
              {hold.origin === 'automatic' && hold.reviewBy && (
                <p className="mt-1 text-xs text-ink-500">
                  Review by {dateTime(hold.reviewBy)} — it stays shut until somebody releases it.
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      <SectionHeading title="Vault" hint="Includes clips the customer hid." />
      {data.clips.length === 0 ? (
        <EmptyState title="No vaulted video" body="Uploads on this job land here automatically." />
      ) : (
        <ul className="grid gap-2">
          {data.clips.map((clip) => (
            <li key={clip.id} className="rounded-lg border border-line bg-paper-0 px-4 py-3 text-sm">
              <span>{clip.title ?? clip.id}</span>
              {clip.userDeleted && (
                <span className="ml-2 text-xs text-danger-600">customer deleted — still available</span>
              )}
              {clip.legalHold && <span className="ml-2 text-xs text-ink-500">on hold</span>}
            </li>
          ))}
        </ul>
      )}

      <SectionHeading title="Actions on this job" />
      {data.activity.length === 0 ? (
        <EmptyState title="No actions yet" body="The monitor writes a row after each signed-in request." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-paper-0">
          <table className="w-full text-left text-sm">
            <thead className="text-[11px] uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-4 py-2">When</th>
                <th className="px-4 py-2">Who</th>
                <th className="px-4 py-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {data.activity.slice(0, 80).map((row) => (
                <tr key={row.id} className="border-t border-line">
                  <td className="px-4 py-2 text-ink-500">{dateTime(row.occurredAt)}</td>
                  <td className="px-4 py-2">{row.actorEmail ?? row.actorLabel ?? '—'}</td>
                  <td className="px-4 py-2 font-mono text-xs">{row.action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
