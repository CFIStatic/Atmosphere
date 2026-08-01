import { useState } from 'react';
import type {
  ComplianceCheck,
  ComplianceReport,
  StandardReference,
} from '../../lib/api';

/**
 * The IICRC standards review.
 *
 * Sits alongside the profitability findings and answers the other question: the
 * findings ask what is unbilled, this asks what is indefensible. Unmet
 * requirements lead, because those are the ones that cost twice — once when the
 * work goes unbilled and again when the estimate is challenged.
 *
 * `not_applicable` checks are collapsed behind a toggle. Fifteen lines of "does
 * not apply" would bury the one that matters, but hiding them entirely would
 * leave the reader unsure whether the check ran at all.
 */

const STATUS_STYLES = {
  met: { chip: 'bg-success-50 text-success-600', card: 'glass-card', mark: '✓' },
  unmet: { chip: 'bg-danger-50 text-danger-600', card: 'border-danger-200 bg-danger-50', mark: '✕' },
  undetermined: { chip: 'bg-caution-50 text-caution-600', card: 'border-caution-200 bg-caution-50', mark: '?' },
  not_applicable: { chip: 'bg-paper-200 text-ink-500', card: 'glass-card', mark: '–' },
} as const;

export function CompliancePanel({
  compliance,
  references,
}: {
  compliance: ComplianceReport;
  references: StandardReference[];
}) {
  const [showNotApplicable, setShowNotApplicable] = useState(false);
  const [showReferences, setShowReferences] = useState(false);

  const byId = new Map(references.map((reference) => [reference.id, reference]));
  const applicable = compliance.checks.filter((check) => check.status !== 'not_applicable');
  const notApplicable = compliance.checks.filter((check) => check.status === 'not_applicable');

  // Unmet and undetermined first — the reader is here to find the gaps.
  const ordered = [...applicable].sort((a, b) => rank(a.status) - rank(b.status));

  const caveats = references.filter((reference) => reference.caveat);

  return (
    <section>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold text-ink-900">Standards review</h2>
        <p className="text-sm text-ink-600">{compliance.summary}</p>
      </div>

      <ul className="mt-3 space-y-2">
        {ordered.map((check) => (
          <CheckRow key={check.id} check={check} reference={byId.get(check.citation)} />
        ))}
      </ul>

      {notApplicable.length > 0 && (
        <>
          <button
            onClick={() => setShowNotApplicable((value) => !value)}
            className="mt-3 text-xs text-ink-500 transition hover:text-ink-700"
          >
            {showNotApplicable ? 'Hide' : 'Show'} {notApplicable.length} requirement
            {notApplicable.length === 1 ? '' : 's'} that don't apply to this loss
          </button>
          {showNotApplicable && (
            <ul className="mt-2 space-y-1.5">
              {notApplicable.map((check) => (
                <li
                  key={check.id}
                  className="rounded-lg glass-card px-3 py-2 text-xs text-ink-500"
                >
                  <span className="text-ink-600">{check.title}</span> — {check.detail}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {/* Caveats: where the industry says "the standard requires" about something
          the standard leaves to judgement. Worth knowing before an adjuster asks. */}
      {caveats.length > 0 && (
        <div className="mt-4 rounded-xl glass-card p-4">
          <p className="text-sm font-medium text-ink-900">What this estimate does not claim</p>
          <p className="mt-1 text-xs text-ink-500">
            These are places where common practice is often described as an S500 requirement.
            Knowing which of your citations is a clause and which is custom is what keeps the
            rest of them credible.
          </p>
          <ul className="mt-2.5 space-y-2">
            {caveats.map((reference) => (
              <li key={reference.id} className="text-xs leading-relaxed text-ink-600">
                <span className="text-ink-700">{reference.title}</span> — {reference.caveat}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Reference appendix. */}
      {references.length > 0 && (
        <div className="mt-4">
          <button
            onClick={() => setShowReferences((value) => !value)}
            className="text-xs text-ink-500 transition hover:text-ink-700"
          >
            {showReferences ? 'Hide' : 'Show'} the {references.length} standards this estimate cites
          </button>
          {showReferences && (
            <div className="mt-2 space-y-2">
              <p className="text-xs leading-relaxed text-ink-500">
                The ANSI/IICRC S500 and S520 are copyrighted publications of the IICRC and are
                not reproduced here. Each requirement below is paraphrased; the location is
                given so a reader with their own copy can turn to it.
              </p>
              {references.map((reference) => (
                <div
                  key={reference.id}
                  className="rounded-lg glass-card p-3"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-sm font-medium text-ink-800">{reference.title}</p>
                    <ConfidenceChip reference={reference} />
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-ink-600">
                    {reference.requirement}
                  </p>
                  <p className="mt-1 text-xs text-ink-500">{formatLocation(reference)}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function CheckRow({
  check,
  reference,
}: {
  check: ComplianceCheck;
  reference?: StandardReference;
}) {
  const style = STATUS_STYLES[check.status];

  return (
    <li className={`rounded-xl border p-4 ${style.card}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="flex items-center gap-2 font-medium text-ink-900">
          <span className={`grid h-5 w-5 shrink-0 place-items-center rounded text-xs ${style.chip}`}>
            {style.mark}
          </span>
          {check.title}
        </p>
        {check.affectsEstimate && check.status !== 'met' && (
          <span className="rounded bg-caution-50 px-1.5 py-0.5 text-[11px] text-caution-600">
            also unbilled work
          </span>
        )}
      </div>
      <p className="mt-1.5 text-sm leading-relaxed text-ink-600">{check.detail}</p>
      {check.remedy && <p className="mt-1.5 text-sm text-brand-300">→ {check.remedy}</p>}
      {reference && <p className="mt-1.5 text-xs text-ink-500">{formatLocation(reference)}</p>}
    </li>
  );
}

function ConfidenceChip({ reference }: { reference: StandardReference }) {
  if (reference.confidence === 'convention') {
    return (
      <span className="rounded bg-caution-50 px-1.5 py-0.5 text-[11px] text-caution-600">
        industry practice
      </span>
    );
  }
  return (
    <span className="rounded bg-paper-200 px-1.5 py-0.5 text-[11px] text-ink-500">
      {reference.standard}
    </span>
  );
}

/**
 * Render a citation's location.
 *
 * A `chapter` citation deliberately prints no number. Manufacturing a
 * clause-shaped reference to look authoritative is the exact failure this whole
 * feature was built to avoid.
 */
export function formatLocation(reference: StandardReference): string {
  if (reference.confidence === 'clause' && reference.section) {
    return `${reference.edition} §${reference.section}`;
  }
  if (reference.confidence === 'convention') {
    return `${reference.chapter} — industry practice, not a requirement of ${reference.standard}`;
  }
  return `${reference.edition}, ${reference.chapter}`;
}

function rank(status: ComplianceStatus): number {
  return { unmet: 0, undetermined: 1, met: 2, not_applicable: 3 }[status];
}

type ComplianceStatus = ComplianceCheck['status'];
