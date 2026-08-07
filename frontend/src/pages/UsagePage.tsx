import { useEffect, useState } from 'react';
import { AppShell } from '../components/AppShell';
import { AlertIcon, SpinnerIcon } from '../components/icons';
import { api, ApiError, type CustomerMeteringSummary } from '../lib/api';
import { formatCents, formatDate } from '../lib/money';
import { useFeatureTimer } from '../hooks/useFeatureTimer';

export function UsagePage() {
  useFeatureTimer('usage_console');
  const [summary, setSummary] = useState<CustomerMeteringSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .getMeteringSummary()
      .then((s) => {
        if (!cancelled) {
          setSummary(s);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Could not load usage.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <AppShell>
        <div className="grid place-items-center py-24 text-brand-600">
          <SpinnerIcon className="animate-spin" width={28} height={28} />
        </div>
      </AppShell>
    );
  }

  const usagePct =
    summary && summary.includedJobs > 0
      ? Math.min(100, Math.round((summary.processedJobs / summary.includedJobs) * 100))
      : 0;

  return (
    <AppShell>
      <div className="animate-fade-in-up">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-ink-900">Usage</h1>
          <p className="mt-2 text-ink-600">
            Work Atmosphere performs for your organization — jobs processed, video verification,
            and exceptional compute. Billed as understandable units, not raw model tokens.
          </p>
        </div>

        {error && (
          <div
            role="alert"
            className="mt-6 flex items-start gap-2.5 rounded-xl border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-700"
          >
            <AlertIcon width={18} height={18} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {summary && (
          <>
            <p className="mt-4 text-sm text-ink-500">
              Billing period {formatDate(summary.periodStart)} – {formatDate(summary.periodEnd)} ·{' '}
              {summary.planName}
            </p>

            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatTile label="Jobs processed" value={summary.processedJobs.toLocaleString('en-US')} />
              <StatTile
                label="Included in plan"
                value={summary.includedJobs.toLocaleString('en-US')}
                hint={
                  summary.excessJobs > 0
                    ? `${summary.excessJobs} above plan`
                    : `${usagePct}% of allowance used`
                }
              />
              <StatTile
                label="Video verification"
                value={`${summary.videoVerificationHours.toFixed(1)} hrs`}
              />
              <StatTile
                label="Estimated upcoming bill"
                value={formatCents(summary.estimatedUpcomingBillCents)}
              />
            </div>

            <section className="mt-10 rounded-xl glass-card p-5">
              <h2 className="text-lg font-semibold text-ink-900">This period</h2>
              <ul className="mt-5 divide-y divide-line text-sm">
                <LineItem label="Platform fee" amountCents={summary.basePlatformChargeCents} />
                {summary.jobOverageChargeCents > 0 && (
                  <LineItem
                    label={`Additional jobs (${summary.excessJobs})`}
                    amountCents={summary.jobOverageChargeCents}
                  />
                )}
                {summary.videoProcessingChargeCents > 0 && (
                  <LineItem
                    label="Video processing"
                    amountCents={summary.videoProcessingChargeCents}
                  />
                )}
                {summary.computeOverage && (
                  <LineItem
                    label={`Compute overage (${summary.computeOverage.units.toFixed(1)} units)`}
                    amountCents={summary.computeOverage.chargeCents}
                  />
                )}
                <li className="flex items-baseline justify-between gap-4 py-3 font-semibold text-ink-900">
                  <span>Estimated total</span>
                  <span className="font-mono">{formatCents(summary.estimatedUpcomingBillCents)}</span>
                </li>
              </ul>
            </section>

            <section className="mt-8 rounded-xl border border-line bg-paper-200/30 p-5 text-sm text-ink-600">
              <h2 className="font-semibold text-ink-900">What you will not see here</h2>
              <p className="mt-2">
                Token counts, model names, and provider costs are tracked internally for
                Atmosphere&apos;s cost accounting. Your invoice is based on jobs processed and
                exceptional compute — the work performed, not the infrastructure underneath.
              </p>
            </section>
          </>
        )}
      </div>
    </AppShell>
  );
}

function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl glass-card p-5">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-500">{label}</p>
      <p className="mt-1.5 text-2xl font-bold tracking-tight text-ink-900">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-ink-500">{hint}</p>}
    </div>
  );
}

function LineItem({ label, amountCents }: { label: string; amountCents: number }) {
  return (
    <li className="flex items-baseline justify-between gap-4 py-3">
      <span className="text-ink-700">{label}</span>
      <span className="font-mono text-ink-800">{formatCents(amountCents)}</span>
    </li>
  );
}
