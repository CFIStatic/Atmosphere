import { useState } from 'react';
import {
  usd,
  type MitigationEstimate,
  type ProfitFinding,
  type StandardReference,
} from '../../lib/api';
import { CompliancePanel, formatLocation } from './CompliancePanel';
import { SlaPanel } from './SlaPanel';

/**
 * The finished estimate.
 *
 * Ordered the way it is defended, not the way it is computed: the classification
 * and its reasoning first, then what needs fixing, then the money, then the
 * lines. An estimator hands this to an adjuster, so the reasoning behind every
 * line is one click away rather than buried in a tooltip.
 */

export function EstimateResult({
  estimate,
  onPush,
  pushing,
  canPush,
  jobId,
  onDeviationAccepted,
}: {
  estimate: MitigationEstimate;
  onPush?: () => void;
  pushing?: boolean;
  canPush?: boolean;
  /** The saved job id, needed before a deviation can be recorded against it. */
  jobId?: string | null;
  onDeviationAccepted?: () => void;
}) {
  const { assessment, profitability, lineItems } = estimate;
  const unverified = lineItems.filter((line) => !line.priceVerified).length;

  return (
    <div className="space-y-6">
      {/* ---- Classification ---- */}
      <section className="rounded-xl border border-line bg-paper-0 p-5 backdrop-blur">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={assessment.category === 3 ? 'danger' : assessment.category === 2 ? 'warn' : 'ok'}>
            Category {assessment.category}
          </Badge>
          <Badge tone="neutral">Class {assessment.class}</Badge>
          {assessment.category > assessment.sourceCategory && (
            <Badge tone="warn">Degraded from Cat {assessment.sourceCategory}</Badge>
          )}
          {assessment.microbialGrowthPresent && <Badge tone="danger">Microbial growth</Badge>}
          <span className="ml-auto text-xs text-ink-500">
            {assessment.sourcesUsed.join(' · ') || 'no sources'}
          </span>
        </div>

        <p className="mt-3 text-sm leading-relaxed text-ink-700">{estimate.narrative}</p>

        <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Rooms" value={String(assessment.rooms.length)} />
          <Stat
            label="Affected floor"
            value={`${Math.round(
              assessment.rooms.reduce(
                (sum, r) => sum + r.geometry.floorSF * r.affectedFloorFraction,
                0,
              ),
            )} SF`}
          />
          <Stat label="Drying days" value={String(assessment.dryingDays)} />
          <Stat label="Monitoring visits" value={String(assessment.monitoringVisits)} />
        </dl>
      </section>

      {/* ---- Carrier program terms ----
          Above everything else on purpose: an estimate that breaches its
          agreement does not get paid however well it is scoped. */}
      <SlaPanel sla={estimate.sla} jobId={jobId} onDeviationAccepted={onDeviationAccepted} />

      {/* ---- Findings ---- */}
      {profitability.findings.length > 0 && (
        <section>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold text-ink-900">
              Review — {profitability.findings.length} finding
              {profitability.findings.length === 1 ? '' : 's'}
            </h2>
            {profitability.recoverableRevenue > 0 && (
              <p className="text-sm text-success-600">
                {usd(profitability.recoverableRevenue)} of documented work is not yet billed
              </p>
            )}
          </div>
          <ul className="mt-3 space-y-2">
            {profitability.findings.map((finding) => (
              <FindingRow key={finding.id} finding={finding} />
            ))}
          </ul>
        </section>
      )}

      {/* ---- Standards ---- */}
      <CompliancePanel compliance={estimate.compliance} references={estimate.references} />

      {/* ---- Money ---- */}
      <section className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-line bg-paper-0 p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Estimate</p>
          <table className="mt-2 w-full text-sm">
            <tbody className="text-ink-700">
              <Row label="Subtotal" value={usd(profitability.subtotal)} />
              <Row label="Overhead &amp; profit" value={usd(profitability.overheadAndProfit)} />
              <Row label="Tax" value={usd(profitability.tax)} />
            </tbody>
            <tfoot>
              <tr className="border-t border-line">
                <td className="pt-2 font-semibold text-ink-900">Total</td>
                <td className="pt-2 text-right font-semibold text-ink-900">
                  {usd(profitability.total)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="rounded-xl border border-line bg-paper-0 p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Profitability</p>
          <div className="mt-2 flex items-baseline gap-2">
            <span
              className={`text-3xl font-bold ${
                profitability.grossMargin >= profitability.targetMargin
                  ? 'text-success-600'
                  : 'text-caution-600'
              }`}
            >
              {(profitability.grossMargin * 100).toFixed(1)}%
            </span>
            <span className="text-sm text-ink-500">
              gross margin · target {(profitability.targetMargin * 100).toFixed(0)}%
            </span>
          </div>
          <table className="mt-3 w-full text-sm">
            <tbody className="text-ink-700">
              <Row label="Cost basis" value={usd(profitability.totalCost)} />
              <Row label="Gross profit" value={usd(profitability.grossProfit)} />
              {profitability.marginGap > 0 && (
                <Row
                  label="Revenue needed for target"
                  value={usd(profitability.marginGap)}
                  tone="warn"
                />
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ---- Line items ---- */}
      <section>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold text-ink-900">
            Line items ({lineItems.length})
          </h2>
          {unverified > 0 && (
            <p className="text-xs text-caution-600">
              {unverified} priced from placeholders — sync a price list before submitting
            </p>
          )}
        </div>

        <div className="mt-3 overflow-hidden rounded-xl border border-line">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[52rem] text-sm">
              <thead className="bg-paper-200/60 text-left text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Code</th>
                  <th className="px-3 py-2 font-medium">Room</th>
                  <th className="px-3 py-2 font-medium">Description</th>
                  <th className="px-3 py-2 text-right font-medium">Qty</th>
                  <th className="px-3 py-2 text-right font-medium">Unit price</th>
                  <th className="px-3 py-2 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {lineItems.map((line) => (
                  <LineRow key={line.id} line={line} references={estimate.references} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ---- Open questions ---- */}
      {estimate.openQuestions.length > 0 && (
        <section className="rounded-xl border border-caution-200 bg-caution-50 p-5">
          <h2 className="text-sm font-semibold text-caution-600">Before you submit this</h2>
          <ul className="mt-2 space-y-1.5 text-sm text-caution-600">
            {estimate.openQuestions.map((question) => (
              <li key={question} className="flex gap-2">
                <span aria-hidden className="text-caution-600">
                  •
                </span>
                <span>{question}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {onPush && (
        <button
          onClick={onPush}
          disabled={pushing || !canPush || estimate.sla.blocksSubmission}
          className="w-full rounded-lg bg-brand-600 px-4 py-3 text-sm font-medium text-white transition hover:bg-brand-500 disabled:opacity-50"
          title={
            estimate.sla.blocksSubmission
              ? 'Resolve the program breaches, or document a deviation for each'
              : canPush
                ? undefined
                : 'Connect Xactimate with write permission first'
          }
        >
          {pushing
            ? 'Writing to Xactimate…'
            : estimate.sla.blocksSubmission
              ? 'Blocked — this estimate breaches its program terms'
              : 'Write this estimate into Xactimate'}
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function LineRow({
  line,
  references,
}: {
  line: MitigationEstimate['lineItems'][number];
  references: StandardReference[];
}) {
  const [open, setOpen] = useState(false);
  const cited = line.citations
    .map((id) => references.find((reference) => reference.id === id))
    .filter((reference): reference is StandardReference => Boolean(reference));

  return (
    <>
      <tr
        onClick={() => setOpen((value) => !value)}
        className="cursor-pointer bg-paper-0 transition hover:bg-paper-200"
      >
        <td className="px-3 py-2 font-mono text-xs text-brand-300">
          {line.code}
          {!line.priceVerified && (
            <span title="Placeholder price" className="ml-1 text-caution-600">
              ~
            </span>
          )}
        </td>
        <td className="px-3 py-2 text-ink-600">{line.roomName ?? 'Job-wide'}</td>
        <td className="px-3 py-2 text-ink-700">
          {line.description}
          {line.evidenceGap && (
            <span className="ml-2 rounded bg-danger-50 px-1.5 py-0.5 text-[11px] text-danger-600">
              {line.evidenceGap}
            </span>
          )}
        </td>
        <td className="px-3 py-2 text-right tabular-nums text-ink-700">
          {line.quantity} {line.unit}
        </td>
        <td className="px-3 py-2 text-right tabular-nums text-ink-600">{usd(line.unitPrice)}</td>
        <td className="px-3 py-2 text-right tabular-nums font-medium text-ink-900">
          {usd(line.rcv)}
        </td>
      </tr>
      {open && (
        <tr className="bg-paper-100/60">
          <td colSpan={6} className="px-3 py-3 text-xs leading-relaxed text-ink-600">
            <p className="text-ink-700">{line.justification}</p>

            {cited.length > 0 && (
              <ul className="mt-2 space-y-1.5">
                {cited.map((reference) => (
                  <li key={reference.id} className="border-l-2 border-brand-500/30 pl-2.5">
                    <p className="text-ink-700">
                      {reference.title}
                      {reference.confidence === 'convention' && (
                        <span className="ml-1.5 text-caution-600">(industry practice)</span>
                      )}
                    </p>
                    <p className="text-ink-500">{reference.requirement}</p>
                    <p className="text-ink-500">{formatLocation(reference)}</p>
                  </li>
                ))}
              </ul>
            )}

            <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-ink-500">
              <span>
                Evidence: {line.evidenceIds.length > 0 ? `${line.evidenceIds.length} item(s)` : 'none attached'}
              </span>
              <span>Cost basis: {usd(line.totalCost)}</span>
            </p>
          </td>
        </tr>
      )}
    </>
  );
}

function FindingRow({ finding }: { finding: ProfitFinding }) {
  const tone =
    finding.severity === 'critical'
      ? 'border-danger-200 bg-danger-50'
      : finding.severity === 'warning'
        ? 'border-caution-200 bg-caution-50'
        : 'border-line bg-paper-0';

  return (
    <li className={`rounded-xl border p-4 ${tone}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-medium text-ink-900">{finding.title}</p>
        {finding.revenueImpact !== 0 && (
          <span
            className={`text-sm font-medium ${
              finding.revenueImpact > 0 ? 'text-success-600' : 'text-danger-600'
            }`}
          >
            {finding.revenueImpact > 0 ? '+' : ''}
            {usd(finding.revenueImpact)}
          </span>
        )}
      </div>
      <p className="mt-1 text-sm leading-relaxed text-ink-600">{finding.detail}</p>
      {finding.actionRequired && (
        <p className="mt-2 text-sm text-brand-300">→ {finding.actionRequired}</p>
      )}
    </li>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-ink-500">{label}</dt>
      <dd className="mt-0.5 text-lg font-semibold text-ink-900">{value}</dd>
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: 'warn' }) {
  return (
    <tr>
      <td className="py-0.5">{label}</td>
      <td className={`py-0.5 text-right tabular-nums ${tone === 'warn' ? 'text-caution-600' : ''}`}>
        {value}
      </td>
    </tr>
  );
}

function Badge({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: 'ok' | 'warn' | 'danger' | 'neutral';
}) {
  const tones = {
    ok: 'bg-success-50 text-success-600',
    warn: 'bg-caution-50 text-caution-600',
    danger: 'bg-danger-50 text-danger-600',
    neutral: 'bg-paper-300 text-ink-700',
  } as const;
  return (
    <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>
  );
}
