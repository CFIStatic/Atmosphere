import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  api,
  ApiError,
  FINANCE_DOC_KIND_LABELS,
  FINANCE_SHARE_PURPOSE_LABELS,
  formatMoneyCents,
  type FinancePublicShare,
} from '../lib/api';
import { Logo } from '../components/Logo';
import { SpinnerIcon } from '../components/icons';

/**
 * Public third-party view of a financial dataroom.
 * No login — the share token in the URL is the credential.
 */

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export function FinanceSharePage() {
  const { token = '' } = useParams();
  const [share, setShare] = useState<FinancePublicShare | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { share: payload } = await api.financeOpenPublicShare(token);
        if (!cancelled) {
          setShare(payload);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Could not open this share.');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (!share && !error) {
    return (
      <div className="grid min-h-screen place-items-center bg-paper-100 text-brand-600">
        <SpinnerIcon className="animate-spin" width={28} height={28} />
      </div>
    );
  }

  if (error || !share) {
    return (
      <div className="cx-aurora min-h-screen bg-paper-100">
        <div className="mx-auto max-w-xl px-6 py-20 text-center">
          <Logo />
          <h1 className="mt-8 text-2xl font-semibold text-ink-900">Share unavailable</h1>
          <p className="mt-3 text-ink-600">{error ?? 'This link is not valid.'}</p>
        </div>
      </div>
    );
  }

  const report = asRecord(share.report);
  const company = asRecord(share.companyProfile);
  const sections = share.sections ?? {};
  const cash = asRecord(report.cash);
  const receivables = asRecord(report.receivables);
  const jobCosting = asRecord(report.jobCosting);
  const backlog = asRecord(report.backlog);
  const team = asArray<Record<string, unknown>>(company.team);
  const howWeWork = asArray<string>(company.howWeWork);
  const roleSummary = asArray<Record<string, unknown>>(company.roleSummary);
  const agingBuckets = asArray<Record<string, unknown>>(receivables.agingBuckets);
  const jobs = asArray<Record<string, unknown>>(jobCosting.jobs);
  const alerts = asArray<Record<string, unknown>>(report.alerts);
  const topAged = asArray<Record<string, unknown>>(receivables.topAged);

  return (
    <div className="cx-aurora min-h-screen bg-paper-100">
      <header className="border-b border-line bg-paper-0/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-6 py-5">
          <div className="flex items-center gap-4">
            <Logo />
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-brand-600">
                Financial dataroom
              </p>
              <h1 className="text-lg font-semibold text-ink-900">{share.orgName}</h1>
            </div>
          </div>
          <div className="text-right text-sm text-ink-600">
            <p>{FINANCE_SHARE_PURPOSE_LABELS[share.purpose] ?? share.purpose}</p>
            <p className="text-xs">
              Expires {new Date(share.expiresAt).toLocaleDateString()} · view #{share.viewCount}
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-8 px-6 py-8">
        <section className="rounded-xl border border-line bg-paper-0 p-6">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">{share.title}</p>
          {share.recipientOrg || share.recipientName ? (
            <p className="mt-1 text-sm text-ink-600">
              Prepared for {[share.recipientName, share.recipientOrg].filter(Boolean).join(' · ')}
            </p>
          ) : null}
          {share.coverNote ? (
            <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-ink-800">
              {share.coverNote}
            </p>
          ) : null}
          <p className="mt-4 text-xs text-ink-500">
            Figures in this package were frozen at publish. Bank and accounting connections are
            observed read-only by Atmosphere; this link does not grant write access to any system.
          </p>
        </section>

        {sections.executiveSummary !== false && (
          <Section title="Executive summary">
            <p className="text-sm leading-relaxed text-ink-800">
              {String(report.executiveSummary ?? '')}
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <Metric label="Cash on hand" value={formatMoneyCents(Number(cash.onHandCents ?? 0))} />
              <Metric
                label="Open AR"
                value={formatMoneyCents(Number(receivables.openArCents ?? 0))}
              />
              <Metric
                label="Blended margin"
                value={
                  jobCosting.blendedMarginPct == null
                    ? '—'
                    : `${Number(jobCosting.blendedMarginPct).toFixed(1)}%`
                }
              />
            </div>
          </Section>
        )}

        {sections.companyOverview !== false && (
          <Section title="Company overview">
            <p className="text-sm leading-relaxed text-ink-800">
              {String(company.overview ?? '')}
            </p>
            {company.contractorTypeLabel ? (
              <p className="mt-2 text-sm text-ink-600">
                Type: {String(company.contractorTypeLabel)}
              </p>
            ) : null}
          </Section>
        )}

        {sections.howWeWork !== false && howWeWork.length > 0 && (
          <Section title="How the company works">
            <ul className="list-disc space-y-2 pl-5 text-sm text-ink-800">
              {howWeWork.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </Section>
        )}

        {sections.teamAndRoles !== false && (
          <Section title="Who does what">
            {roleSummary.length > 0 && (
              <div className="mb-4 grid gap-3 sm:grid-cols-2">
                {roleSummary.map((role) => (
                  <div key={String(role.role)} className="rounded-lg border border-line p-3">
                    <p className="text-sm font-semibold text-ink-900">
                      {String(role.role)} · {Number(role.count)}
                    </p>
                    <p className="mt-1 text-xs text-ink-600">{String(role.description)}</p>
                  </div>
                ))}
              </div>
            )}
            <ul className="divide-y divide-line rounded-lg border border-line">
              {team.map((member) => (
                <li key={String(member.userId)} className="px-4 py-3 text-sm">
                  <p className="font-medium text-ink-900">
                    {String(member.fullName || member.email || 'Team member')}
                  </p>
                  <p className="text-ink-600">
                    {String(member.roleLabel)} · {String(member.workTypeLabel)}
                  </p>
                  <p className="mt-1 text-xs text-ink-500">{String(member.responsibilities)}</p>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {sections.cashPosition !== false && (
          <Section title="Cash position">
            <p className="text-sm text-ink-700">
              On hand {formatMoneyCents(Number(cash.onHandCents ?? 0))} (floor{' '}
              {formatMoneyCents(Number(cash.floorCents ?? 0))}).
            </p>
            <ul className="mt-3 divide-y divide-line rounded-lg border border-line">
              {asArray<Record<string, unknown>>(cash.accounts).map((a, i) => (
                <li key={i} className="flex justify-between px-4 py-2 text-sm">
                  <span>
                    {String(a.name)}{' '}
                    <span className="text-ink-500">({String(a.accountType)})</span>
                  </span>
                  <span className="font-medium">
                    {formatMoneyCents(a.balanceCents == null ? null : Number(a.balanceCents))}
                  </span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {sections.accountsReceivable !== false && (
          <Section title="Accounts receivable">
            <p className="text-sm text-ink-700">
              Open AR {formatMoneyCents(Number(receivables.openArCents ?? 0))} across{' '}
              {Number(receivables.jobCountWithAr ?? 0)} job(s).
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-5">
              {agingBuckets.map((b) => (
                <div key={String(b.label)} className="rounded-lg border border-line p-3 text-center">
                  <p className="text-xs uppercase tracking-wide text-ink-500">{String(b.label)}d</p>
                  <p className="mt-1 text-sm font-semibold">
                    {formatMoneyCents(Number(b.cents ?? 0))}
                  </p>
                  <p className="text-xs text-ink-500">{Number(b.jobs ?? 0)} jobs</p>
                </div>
              ))}
            </div>
            {topAged.length > 0 && (
              <ul className="mt-4 divide-y divide-line rounded-lg border border-line">
                {topAged.map((j, i) => (
                  <li key={i} className="flex justify-between px-4 py-2 text-sm">
                    <span>
                      {j.jobNumber != null ? `#${j.jobNumber} · ` : ''}
                      {String(j.title)}
                    </span>
                    <span>
                      {formatMoneyCents(Number(j.openArCents ?? 0))} · {Number(j.agingDays ?? 0)}d
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        )}

        {sections.jobCosting !== false && (
          <Section title="Job costing">
            <p className="text-sm text-ink-700">
              Contract {formatMoneyCents(Number(jobCosting.totalContractCents ?? 0))} · cost{' '}
              {formatMoneyCents(Number(jobCosting.totalCostCents ?? 0))}
              {jobCosting.blendedMarginPct != null
                ? ` · margin ${Number(jobCosting.blendedMarginPct).toFixed(1)}%`
                : ''}
            </p>
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-line text-xs uppercase text-ink-500">
                  <tr>
                    <th className="px-2 py-2">Job</th>
                    <th className="px-2 py-2">Contract</th>
                    <th className="px-2 py-2">Cost</th>
                    <th className="px-2 py-2">Margin</th>
                    <th className="px-2 py-2">AR</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((j, i) => (
                    <tr key={i} className="border-b border-line/70">
                      <td className="px-2 py-2">
                        {j.jobNumber != null ? `#${j.jobNumber} · ` : ''}
                        {String(j.title)}
                      </td>
                      <td className="px-2 py-2">
                        {formatMoneyCents(
                          j.contractCents == null ? null : Number(j.contractCents),
                        )}
                      </td>
                      <td className="px-2 py-2">{formatMoneyCents(Number(j.costCents ?? 0))}</td>
                      <td className="px-2 py-2">
                        {j.marginPct == null ? '—' : `${Number(j.marginPct).toFixed(1)}%`}
                      </td>
                      <td className="px-2 py-2">{formatMoneyCents(Number(j.openArCents ?? 0))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        )}

        {sections.backlog !== false && (
          <Section title="Backlog">
            <div className="grid gap-3 sm:grid-cols-3">
              <Metric label="Active jobs" value={String(Number(backlog.activeJobs ?? 0))} />
              <Metric
                label="Contract backlog"
                value={formatMoneyCents(Number(backlog.contractBacklogCents ?? 0))}
              />
              <Metric
                label="Unbilled cost"
                value={formatMoneyCents(Number(backlog.unbilledCostCents ?? 0))}
              />
            </div>
          </Section>
        )}

        {sections.alerts !== false && alerts.length > 0 && (
          <Section title="Open financial alerts">
            <ul className="space-y-2">
              {alerts.map((a, i) => (
                <li key={i} className="rounded-lg border border-line px-4 py-3 text-sm">
                  <p className="font-medium text-ink-900">
                    [{String(a.severity)}] {String(a.title)}
                  </p>
                  {a.detail ? <p className="mt-1 text-ink-600">{String(a.detail)}</p> : null}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {sections.documents !== false && (
          <Section title="Documents">
            {share.documents.length === 0 ? (
              <p className="text-sm text-ink-500">No supporting documents were attached.</p>
            ) : (
              <ul className="divide-y divide-line rounded-lg border border-line">
                {share.documents.map((doc) => (
                  <li key={doc.id} className="flex items-start justify-between gap-4 px-4 py-3 text-sm">
                    <div>
                      <p className="font-medium text-ink-900">{doc.title}</p>
                      <p className="text-ink-500">
                        {FINANCE_DOC_KIND_LABELS[doc.kind] ?? doc.kind}
                        {doc.periodLabel ? ` · ${doc.periodLabel}` : ''}
                      </p>
                      {doc.description ? (
                        <p className="mt-1 text-ink-600">{doc.description}</p>
                      ) : null}
                    </div>
                    {doc.externalRef ? (
                      <a
                        href={doc.externalRef}
                        target="_blank"
                        rel="noreferrer"
                        className="shrink-0 text-brand-700 hover:underline"
                      >
                        Open
                      </a>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Section>
        )}

        <p className="pb-10 text-center text-xs text-ink-500">
          Shared via Atmosphere Financial Agent · read-only dataroom
        </p>
      </main>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-paper-0 p-6">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line p-3">
      <p className="text-xs uppercase tracking-wide text-ink-500">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums text-ink-900">{value}</p>
    </div>
  );
}
