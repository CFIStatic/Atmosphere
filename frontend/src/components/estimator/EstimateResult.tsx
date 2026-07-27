import { useState } from 'react';
import { usd, type MitigationEstimate, type ProfitFinding } from '../../lib/api';

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
}: {
  estimate: MitigationEstimate;
  onPush?: () => void;
  pushing?: boolean;
  canPush?: boolean;
}) {
  const { assessment, profitability, lineItems } = estimate;
  const unverified = lineItems.filter((line) => !line.priceVerified).length;

  return (
    <div className="space-y-6">
      {/* ---- Classification ---- */}
      <section className="rounded-xl border border-white/10 bg-ink-800/60 p-5 backdrop-blur">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={assessment.category === 3 ? 'danger' : assessment.category === 2 ? 'warn' : 'ok'}>
            Category {assessment.category}
          </Badge>
          <Badge tone="neutral">Class {assessment.class}</Badge>
          {assessment.category > assessment.sourceCategory && (
            <Badge tone="warn">Degraded from Cat {assessment.sourceCategory}</Badge>
          )}
          {assessment.microbialGrowthPresent && <Badge tone="danger">Microbial growth</Badge>}
          <span className="ml-auto text-xs text-gray-500">
            {assessment.sourcesUsed.join(' · ') || 'no sources'}
          </span>
        </div>

        <p className="mt-3 text-sm leading-relaxed text-gray-300">{estimate.narrative}</p>

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

      {/* ---- Findings ---- */}
      {profitability.findings.length > 0 && (
        <section>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold text-white">
              Review — {profitability.findings.length} finding
              {profitability.findings.length === 1 ? '' : 's'}
            </h2>
            {profitability.recoverableRevenue > 0 && (
              <p className="text-sm text-emerald-400">
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

      {/* ---- Money ---- */}
      <section className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-white/10 bg-ink-800/60 p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Estimate</p>
          <table className="mt-2 w-full text-sm">
            <tbody className="text-gray-300">
              <Row label="Subtotal" value={usd(profitability.subtotal)} />
              <Row label="Overhead &amp; profit" value={usd(profitability.overheadAndProfit)} />
              <Row label="Tax" value={usd(profitability.tax)} />
            </tbody>
            <tfoot>
              <tr className="border-t border-white/10">
                <td className="pt-2 font-semibold text-white">Total</td>
                <td className="pt-2 text-right font-semibold text-white">
                  {usd(profitability.total)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="rounded-xl border border-white/10 bg-ink-800/60 p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Profitability</p>
          <div className="mt-2 flex items-baseline gap-2">
            <span
              className={`text-3xl font-bold ${
                profitability.grossMargin >= profitability.targetMargin
                  ? 'text-emerald-400'
                  : 'text-amber-400'
              }`}
            >
              {(profitability.grossMargin * 100).toFixed(1)}%
            </span>
            <span className="text-sm text-gray-500">
              gross margin · target {(profitability.targetMargin * 100).toFixed(0)}%
            </span>
          </div>
          <table className="mt-3 w-full text-sm">
            <tbody className="text-gray-300">
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
          <h2 className="text-lg font-semibold text-white">
            Line items ({lineItems.length})
          </h2>
          {unverified > 0 && (
            <p className="text-xs text-amber-300">
              {unverified} priced from placeholders — sync a price list before submitting
            </p>
          )}
        </div>

        <div className="mt-3 overflow-hidden rounded-xl border border-white/10">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[52rem] text-sm">
              <thead className="bg-ink-700/60 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Code</th>
                  <th className="px-3 py-2 font-medium">Room</th>
                  <th className="px-3 py-2 font-medium">Description</th>
                  <th className="px-3 py-2 text-right font-medium">Qty</th>
                  <th className="px-3 py-2 text-right font-medium">Unit price</th>
                  <th className="px-3 py-2 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {lineItems.map((line) => (
                  <LineRow key={line.id} line={line} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ---- Open questions ---- */}
      {estimate.openQuestions.length > 0 && (
        <section className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-5">
          <h2 className="text-sm font-semibold text-amber-200">Before you submit this</h2>
          <ul className="mt-2 space-y-1.5 text-sm text-amber-100/80">
            {estimate.openQuestions.map((question) => (
              <li key={question} className="flex gap-2">
                <span aria-hidden className="text-amber-400">
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
          disabled={pushing || !canPush}
          className="w-full rounded-lg bg-brand-600 px-4 py-3 text-sm font-medium text-white transition hover:bg-brand-500 disabled:opacity-50"
          title={canPush ? undefined : 'Connect Xactimate with write permission first'}
        >
          {pushing ? 'Writing to Xactimate…' : 'Write this estimate into Xactimate'}
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function LineRow({ line }: { line: MitigationEstimate['lineItems'][number] }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <tr
        onClick={() => setOpen((value) => !value)}
        className="cursor-pointer bg-ink-800/40 transition hover:bg-ink-700/40"
      >
        <td className="px-3 py-2 font-mono text-xs text-brand-300">
          {line.code}
          {!line.priceVerified && (
            <span title="Placeholder price" className="ml-1 text-amber-400">
              ~
            </span>
          )}
        </td>
        <td className="px-3 py-2 text-gray-400">{line.roomName ?? 'Job-wide'}</td>
        <td className="px-3 py-2 text-gray-300">
          {line.description}
          {line.evidenceGap && (
            <span className="ml-2 rounded bg-red-500/15 px-1.5 py-0.5 text-[11px] text-red-300">
              {line.evidenceGap}
            </span>
          )}
        </td>
        <td className="px-3 py-2 text-right tabular-nums text-gray-300">
          {line.quantity} {line.unit}
        </td>
        <td className="px-3 py-2 text-right tabular-nums text-gray-400">{usd(line.unitPrice)}</td>
        <td className="px-3 py-2 text-right tabular-nums font-medium text-white">
          {usd(line.rcv)}
        </td>
      </tr>
      {open && (
        <tr className="bg-ink-900/60">
          <td colSpan={6} className="px-3 py-3 text-xs leading-relaxed text-gray-400">
            <p className="text-gray-300">{line.justification}</p>
            <p className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-gray-500">
              {line.standardRef && <span>Standard: {line.standardRef}</span>}
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
      ? 'border-red-500/25 bg-red-500/5'
      : finding.severity === 'warning'
        ? 'border-amber-500/25 bg-amber-500/5'
        : 'border-white/10 bg-ink-800/60';

  return (
    <li className={`rounded-xl border p-4 ${tone}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-medium text-white">{finding.title}</p>
        {finding.revenueImpact !== 0 && (
          <span
            className={`text-sm font-medium ${
              finding.revenueImpact > 0 ? 'text-emerald-400' : 'text-red-400'
            }`}
          >
            {finding.revenueImpact > 0 ? '+' : ''}
            {usd(finding.revenueImpact)}
          </span>
        )}
      </div>
      <p className="mt-1 text-sm leading-relaxed text-gray-400">{finding.detail}</p>
      {finding.actionRequired && (
        <p className="mt-2 text-sm text-brand-300">→ {finding.actionRequired}</p>
      )}
    </li>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-gray-500">{label}</dt>
      <dd className="mt-0.5 text-lg font-semibold text-white">{value}</dd>
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: 'warn' }) {
  return (
    <tr>
      <td className="py-0.5">{label}</td>
      <td className={`py-0.5 text-right tabular-nums ${tone === 'warn' ? 'text-amber-400' : ''}`}>
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
    ok: 'bg-emerald-500/15 text-emerald-300',
    warn: 'bg-amber-500/15 text-amber-300',
    danger: 'bg-red-500/15 text-red-300',
    neutral: 'bg-white/10 text-gray-300',
  } as const;
  return (
    <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>
  );
}
