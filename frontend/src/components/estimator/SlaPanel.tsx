import { useState } from 'react';
import { api, ApiError, usd, type SlaCheck, type SlaComplianceReport, type SlaDeviation } from '../../lib/api';

/**
 * The carrier program review.
 *
 * Leads the estimate, above the scope and the money, because an estimate that
 * breaches its agreement does not get paid however well it is scoped. The three
 * things a user needs from this panel, in order:
 *
 *   1. **Who this is for**, and whether the agent was told or guessed. A wrong
 *      carrier applies the wrong price list and the wrong terms to the whole job,
 *      so an inferred identification is offered for correction rather than
 *      presented as settled.
 *   2. **What is out of terms**, and what it would take to fix.
 *   3. **The deviations the agent found grounds for** — and an explicit act to
 *      accept one. The agent assembles the argument; agreeing to exceed a
 *      carrier's terms is a commercial decision with a relationship behind it,
 *      so a human makes it.
 */

const STATUS = {
  met: { chip: 'bg-emerald-500/15 text-emerald-300', card: 'border-white/10 bg-ink-800/60', mark: '✓' },
  violated: { chip: 'bg-red-500/15 text-red-300', card: 'border-red-500/30 bg-red-500/5', mark: '✕' },
  deviation_documented: { chip: 'bg-sky-500/15 text-sky-300', card: 'border-sky-500/25 bg-sky-500/5', mark: '≠' },
  approval_required: { chip: 'bg-amber-500/15 text-amber-300', card: 'border-amber-500/25 bg-amber-500/5', mark: '!' },
  undetermined: { chip: 'bg-amber-500/15 text-amber-300', card: 'border-amber-500/20 bg-amber-500/5', mark: '?' },
  not_applicable: { chip: 'bg-white/5 text-gray-500', card: 'border-white/5 bg-ink-800/30', mark: '–' },
} as const;

export function SlaPanel({
  sla,
  jobId,
  onDeviationAccepted,
}: {
  sla: SlaComplianceReport;
  /** Needed to record a deviation. Absent until the estimate is saved. */
  jobId?: string | null;
  onDeviationAccepted?: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { identification: id, agreement } = sla;

  const applicable = sla.checks.filter((c) => c.status !== 'not_applicable');
  const ordered = [...applicable].sort((a, b) => rank(a.status) - rank(b.status));

  async function accept(proposal: SlaDeviation) {
    if (!jobId) {
      setError('Save the estimate first — a deviation is recorded against the job.');
      return;
    }
    setBusy(proposal.ruleId);
    setError(null);
    try {
      await api.acceptDeviation(jobId, {
        ruleId: proposal.ruleId,
        reason: proposal.reason,
        evidenceIds: proposal.evidenceIds,
      });
      onDeviationAccepted?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not record the deviation.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold text-white">Carrier program</h2>
        {sla.blocksSubmission && (
          <span className="rounded-md bg-red-500/15 px-2 py-0.5 text-xs font-medium text-red-300">
            submission blocked
          </span>
        )}
      </div>

      {/* ---- Who this is for ---- */}
      <div className="mt-3 rounded-xl border border-white/10 bg-ink-800/60 p-4">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <p className="text-base font-semibold text-white">
            {id.carrierName ?? 'Carrier not identified'}
          </p>
          {id.programName && <span className="text-sm text-gray-400">via {id.programName}</span>}
          <span
            className={`rounded px-1.5 py-0.5 text-[11px] ${
              id.confidence === 'stated'
                ? 'bg-emerald-500/15 text-emerald-300'
                : id.confidence === 'inferred'
                  ? 'bg-amber-500/15 text-amber-300'
                  : 'bg-red-500/15 text-red-300'
            }`}
          >
            {id.confidence}
          </span>
        </div>

        {id.basis.length > 0 && (
          <p className="mt-1 text-xs text-gray-500">{id.basis.join(' · ')}</p>
        )}

        {id.confidence === 'inferred' && (
          <p className="mt-2 text-xs text-amber-300">
            Read out of the sources rather than stated. Confirm it — the carrier selects the price
            list and the terms for the whole job.
          </p>
        )}
        {id.alternatives.length > 0 && (
          <p className="mt-1 text-xs text-amber-300">
            Also mentioned: {id.alternatives.map((a) => a.carrierName).join(', ')}.
          </p>
        )}

        <p className="mt-2 text-sm text-gray-400">{sla.summary}</p>

        {agreement && (
          <p className="mt-1 text-xs text-gray-600">
            {agreement.programName} · agreement {agreement.version} · terms{' '}
            {agreement.source.kind === 'manual' ? 'entered by hand' : `from ${agreement.source.kind}`}
          </p>
        )}
      </div>

      {error && (
        <p className="mt-2 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {error}
        </p>
      )}

      {/* ---- Terms ---- */}
      {ordered.length > 0 && (
        <ul className="mt-3 space-y-2">
          {ordered.map((check) => (
            <CheckRow key={check.ruleId} check={check} />
          ))}
        </ul>
      )}

      {/* ---- Deviations the agent found grounds for ---- */}
      {sla.proposedDeviations.length > 0 && (
        <div className="mt-4 rounded-xl border border-sky-500/25 bg-sky-500/5 p-4">
          <p className="text-sm font-medium text-sky-200">
            {sla.proposedDeviations.length} documented deviation
            {sla.proposedDeviations.length === 1 ? '' : 's'} available
          </p>
          <p className="mt-1 text-xs text-gray-400">
            The job's own documentation supports exceeding these terms. Accepting one puts the
            reasoning and its evidence on the estimate that goes to the carrier — the agent will
            not agree to exceed a carrier's terms on your behalf.
          </p>
          <ul className="mt-3 space-y-3">
            {sla.proposedDeviations.map((proposal) => (
              <li key={proposal.ruleId} className="rounded-lg bg-ink-900/50 p-3">
                <p className="text-xs font-medium text-gray-300">
                  {sla.agreement?.rules.find((r) => r.id === proposal.ruleId)?.title ?? proposal.ruleId}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-gray-400">{proposal.reason}</p>
                <p className="mt-1 text-[11px] text-gray-600">
                  Evidence: {proposal.evidenceIds.join(', ')}
                </p>
                <button
                  onClick={() => accept(proposal)}
                  disabled={busy === proposal.ruleId || !jobId}
                  title={jobId ? undefined : 'Save the estimate first'}
                  className="mt-2 rounded-md bg-sky-600 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-sky-500 disabled:opacity-50"
                >
                  {busy === proposal.ruleId ? 'Recording…' : 'Accept and document'}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!agreement && (
        <p className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">
          No program agreement is loaded, so this estimate follows your own settings rather than the
          carrier's. If this came through a national account, load the terms before submitting.
        </p>
      )}
    </section>
  );
}

function CheckRow({ check }: { check: SlaCheck }) {
  const style = STATUS[check.status];

  return (
    <li className={`rounded-xl border p-4 ${style.card}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="flex items-center gap-2 font-medium text-white">
          <span className={`grid h-5 w-5 shrink-0 place-items-center rounded text-xs ${style.chip}`}>
            {style.mark}
          </span>
          {check.title}
          {check.severity === 'soft' && (
            <span className="text-[11px] font-normal text-gray-500">advisory</span>
          )}
        </p>
        {typeof check.revenueImpact === 'number' && check.revenueImpact !== 0 && (
          <span className={check.revenueImpact < 0 ? 'text-sm text-red-400' : 'text-sm text-emerald-400'}>
            {usd(check.revenueImpact)}
          </span>
        )}
      </div>
      <p className="mt-1.5 text-sm leading-relaxed text-gray-400">{check.detail}</p>
      {check.remedy && <p className="mt-1.5 text-sm text-brand-300">→ {check.remedy}</p>}
      {check.deviation && (
        <p className="mt-1.5 text-xs text-sky-300">
          Authorised by {check.deviation.authorizedBy ?? 'unrecorded'} ·{' '}
          {check.deviation.evidenceIds.length} piece(s) of evidence
        </p>
      )}
      {check.sourceRef && <p className="mt-1.5 text-xs text-gray-600">{check.sourceRef}</p>}
    </li>
  );
}

function rank(status: SlaCheck['status']): number {
  return {
    violated: 0,
    approval_required: 1,
    undetermined: 2,
    deviation_documented: 3,
    met: 4,
    not_applicable: 5,
  }[status];
}
