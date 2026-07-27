import { useState } from 'react';
import {
  api,
  VERDICT_LABELS,
  VERIFICATION_LABELS,
  type Expectation,
  type Finding,
  type Verdict,
  type Verification,
  type VerificationStatus,
} from '../lib/api';
import { SpinnerIcon, CheckIcon } from './icons';

/**
 * What the second agent found when it went and looked.
 *
 * The design goal is that a reader can disagree with the verdict. Every
 * expectation is shown with the page text the verifier read and the address it
 * read it at, so "verified" is a claim with its working attached rather than a
 * badge to be taken on faith — which is the same standard the verifier exists
 * to hold the first agent to.
 */

const STATUS_STYLES: Record<VerificationStatus, string> = {
  queued: 'border-white/10 bg-ink-700/60 text-gray-300',
  running: 'border-brand-500/30 bg-brand-600/15 text-brand-200',
  verified: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
  repaired: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
  escalated: 'border-amber-500/40 bg-amber-500/10 text-amber-200',
  rejected: 'border-red-500/30 bg-red-500/10 text-red-200',
  failed: 'border-white/10 bg-ink-700/60 text-gray-400',
  cancelled: 'border-white/10 bg-ink-700/60 text-gray-500',
};

const VERDICT_STYLES: Record<Verdict, string> = {
  satisfied: 'text-emerald-300',
  violated: 'text-red-300',
  indeterminate: 'text-amber-300',
};

const VERDICT_MARK: Record<Verdict, string> = {
  satisfied: '✓',
  violated: '✗',
  indeterminate: '?',
};

function FindingRow({ finding, expectation }: { finding: Finding; expectation?: Expectation }) {
  const [open, setOpen] = useState(false);

  return (
    <li className="border-t border-white/5 py-2.5 first:border-t-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start gap-2.5 text-left"
      >
        <span className={`mt-0.5 font-mono text-sm ${VERDICT_STYLES[finding.verdict]}`}>
          {VERDICT_MARK[finding.verdict]}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs text-gray-300">
            {expectation?.description ?? finding.expectationId}
          </span>
          <span className={`block text-[11px] ${VERDICT_STYLES[finding.verdict]}`}>
            {VERDICT_LABELS[finding.verdict]}
            {expectation && !expectation.critical && (
              <span className="text-gray-500"> · incidental</span>
            )}
          </span>
        </span>
        <span className="mt-0.5 text-[11px] text-gray-500">{open ? 'Hide' : 'Evidence'}</span>
      </button>

      {open && (
        <div className="mt-2 space-y-2 pl-6">
          {finding.reasoning && <p className="text-[11px] text-gray-400">{finding.reasoning}</p>}
          {finding.evidence ? (
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-ink-900/70 p-2.5 text-[11px] text-gray-300">
              {finding.evidence}
            </pre>
          ) : (
            <p className="text-[11px] text-gray-500">
              Nothing was read off the page for this one.
            </p>
          )}
          {finding.url && (
            <p className="truncate font-mono text-[10px] text-gray-500">{finding.url}</p>
          )}
          {finding.repair?.instruction && (
            <p className="text-[11px] text-amber-200/80">
              Proposed fix: {finding.repair.instruction}
            </p>
          )}
        </div>
      )}
    </li>
  );
}

export function VerificationPanel({
  runId,
  verification,
  onStarted,
}: {
  runId: string;
  verification: Verification | null;
  onStarted?: () => void;
}) {
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  async function check() {
    setStarting(true);
    setError(null);
    try {
      await api.verifyRun(runId);
      onStarted?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start that check.');
    } finally {
      setStarting(false);
    }
  }

  const inFlight = verification?.status === 'queued' || verification?.status === 'running';
  const byId = new Map((verification?.expectations ?? []).map((exp) => [exp.id, exp]));
  const findings = verification?.findings ?? [];
  const unsettled = findings.filter((f) => f.verdict !== 'satisfied');
  const visible = showAll ? findings : unsettled.length > 0 ? unsettled : findings;

  return (
    <div className="mt-3 rounded-lg border border-white/10 bg-ink-900/40 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
            Independent check
          </span>
          {verification && (
            <span
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${STATUS_STYLES[verification.status]}`}
            >
              {inFlight && <SpinnerIcon className="animate-spin" width={10} height={10} />}
              {(verification.status === 'verified' || verification.status === 'repaired') && (
                <CheckIcon width={10} height={10} />
              )}
              {VERIFICATION_LABELS[verification.status]}
            </span>
          )}
        </div>

        {!inFlight && (
          <button
            onClick={check}
            disabled={starting}
            className="text-[11px] font-medium text-brand-300 transition hover:text-brand-200 disabled:opacity-60"
          >
            {starting ? 'Starting…' : verification ? 'Check again' : 'Check this run'}
          </button>
        )}
      </div>

      {error && <p className="mt-2 text-[11px] text-red-200">{error}</p>}

      {!verification && !error && (
        <p className="mt-2 text-[11px] text-gray-500">
          This run reported success but nobody has confirmed it against the site yet.
        </p>
      )}

      {verification?.summary && (
        <p className="mt-2 text-xs text-gray-300">{verification.summary}</p>
      )}
      {verification?.error && <p className="mt-2 text-xs text-amber-200">{verification.error}</p>}

      {verification?.repairAttempts ? (
        <p className="mt-1 text-[11px] text-gray-500">
          Corrected {verification.repairAttempts === 1 ? 'once' : `${verification.repairAttempts} times`},
          then re-checked.
        </p>
      ) : null}

      {visible.length > 0 && (
        <ul className="mt-2">
          {visible.map((finding) => (
            <FindingRow
              key={finding.expectationId}
              finding={finding}
              expectation={byId.get(finding.expectationId)}
            />
          ))}
        </ul>
      )}

      {findings.length > visible.length && (
        <button
          onClick={() => setShowAll(true)}
          className="mt-2 text-[11px] font-medium text-brand-300 transition hover:text-brand-200"
        >
          Show the {findings.length - visible.length} that checked out
        </button>
      )}
    </div>
  );
}
