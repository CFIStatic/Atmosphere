import { useEffect, useState } from 'react';
import { api, type ProofResponse, type SharedJobRecord } from '../../lib/api';
import { ProofOfWork } from './ProofOfWork';
import { SpinnerIcon } from '../icons';

/**
 * Progress summary and work history for one job — scope completion plus
 * the day-by-day proof timeline from field capture.
 */
export function JobProgressPanel({
  jobId,
  record,
}: {
  jobId: string;
  record: SharedJobRecord;
}) {
  const [proof, setProof] = useState<ProofResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .jobProofs(jobId)
      .then((res) => {
        if (!cancelled) setProof(res);
      })
      .catch(() => {
        if (!cancelled) {
          setProof({
            days: [],
            counts: { days: 0, payable: 0, contradicted: 0, awaitingAfter: 0 },
            siteKnown: false,
          });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  const actionable = record.scope.filter((item) => item.state !== 'excluded');
  const scopeApproved = actionable.filter((item) => item.state === 'approved').length;
  const scopePct = actionable.length
    ? Math.round((scopeApproved / actionable.length) * 100)
    : 0;
  const daysLogged = proof?.counts.days ?? 0;
  const verifiedDays = proof?.days.filter((d) => d.payable || d.accepted).length ?? 0;
  const inProgress = proof?.days.filter((d) => d.hasBefore && !d.hasAfter).length ?? 0;

  return (
    <div className="space-y-4">
      <section className="rounded-xl glass-card p-5">
        <h2 className="text-base font-semibold text-ink-900">Work progress</h2>
        <p className="mt-1 text-xs text-ink-500">
          Scope completion and verified field days — built from daily before/after capture on site.
        </p>

        {loading ? (
          <div className="mt-4 flex items-center gap-2 text-sm text-ink-600">
            <SpinnerIcon className="animate-spin" width={16} height={16} />
            Loading progress…
          </div>
        ) : (
          <>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <ProgressStat label="Scope complete" value={`${scopePct}%`} hint={`${scopeApproved} of ${actionable.length} lines approved`} />
              <ProgressStat label="Work days logged" value={String(daysLogged)} hint="Days with field capture filed" />
              <ProgressStat label="Verified days" value={String(verifiedDays)} hint="Passed integrity checks" tone="success" />
              <ProgressStat
                label="In progress on site"
                value={String(inProgress)}
                hint="Before filmed, after still due"
                tone={inProgress > 0 ? 'caution' : undefined}
              />
            </div>

            {actionable.length > 0 && (
              <div className="mt-5">
                <div className="mb-1.5 flex items-center justify-between text-xs text-ink-500">
                  <span>Overall scope progress</span>
                  <span className="tabular-nums font-medium text-ink-700">{scopePct}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-paper-200">
                  <div
                    className="h-full rounded-full bg-brand-600 transition-all"
                    style={{ width: `${scopePct}%` }}
                  />
                </div>
              </div>
            )}
          </>
        )}
      </section>

      <ProofOfWork jobId={jobId} heading="Work history" />
    </div>
  );
}

function ProgressStat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  tone?: 'success' | 'caution';
}) {
  return (
    <div className="rounded-lg border border-line bg-paper-50/40 px-3 py-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-500">{label}</p>
      <p
        className={`mt-1 text-2xl font-semibold tabular-nums ${
          tone === 'success'
            ? 'text-success-600'
            : tone === 'caution' && value !== '0'
              ? 'text-caution-600'
              : 'text-ink-900'
        }`}
      >
        {value}
      </p>
      <p className="mt-0.5 text-[11px] text-ink-500">{hint}</p>
    </div>
  );
}
