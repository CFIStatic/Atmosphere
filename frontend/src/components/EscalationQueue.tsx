import { useCallback, useEffect, useState } from 'react';
import { api, type Escalation, type EscalationOption } from '../lib/api';
import { SpinnerIcon } from './icons';

/**
 * The questions the verifier could not answer on its own.
 *
 * This is the part of the design that makes "fix it automatically" safe to
 * offer at all. The verifier repairs only what is additive and unambiguous;
 * everything else — anything needing a deletion, anything it could not see
 * clearly, anything a correction failed to settle — stops here and waits for a
 * person, with the evidence attached so the answer takes seconds rather than a
 * trip to the portal.
 *
 * It renders nothing when the queue is empty, so a healthy dashboard stays
 * quiet and a question is unmistakable when one appears.
 */

const REASON_LABELS: Record<Escalation['reason'], string> = {
  indeterminate: 'Could not tell',
  unsafe_repair: 'Needs your say-so',
  repair_exhausted: 'Correction did not take',
  repair_failed: 'Correction failed',
};

function OptionButton({
  option,
  busy,
  onPick,
}: {
  option: EscalationOption;
  busy: boolean;
  onPick: (option: EscalationOption) => void;
}) {
  const emphasis =
    option.action === 'repair'
      ? 'border-brand-500/40 bg-brand-600/15 text-brand-100 hover:bg-brand-600/25'
      : option.action === 'reject'
        ? 'border-red-500/30 bg-red-500/10 text-red-200 hover:bg-red-500/20'
        : 'border-white/10 bg-ink-700/60 text-gray-200 hover:bg-ink-600';

  return (
    <button
      onClick={() => onPick(option)}
      disabled={busy}
      title={option.detail}
      className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition disabled:opacity-60 ${emphasis}`}
    >
      {option.label}
    </button>
  );
}

function EscalationCard({
  escalation,
  onResolved,
}: {
  escalation: Escalation;
  onResolved: (id: string, message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const unsettled = escalation.context.unsettled ?? [];

  async function pick(option: EscalationOption) {
    setBusy(true);
    setError(null);
    try {
      const result = await api.resolveEscalation(escalation.id, option.id, note.trim() || undefined);
      onResolved(
        escalation.id,
        result.status === 'queued'
          ? 'Checking again now.'
          : result.status === 'verified'
            ? 'Recorded as done.'
            : result.status === 'rejected'
              ? 'Recorded as not done.'
              : 'Answered.',
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that answer.');
      setBusy(false);
    }
  }

  return (
    <li className="rounded-xl border border-amber-500/25 bg-amber-500/[0.06] px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-sm font-medium text-white">{escalation.question}</p>
        <span className="shrink-0 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-[11px] font-medium text-amber-200">
          {REASON_LABELS[escalation.reason]}
        </span>
      </div>

      {escalation.context.runInstruction && (
        <p className="mt-1.5 text-xs text-gray-400">
          <span className="text-gray-500">Task: </span>
          {escalation.context.runInstruction}
          {escalation.context.siteLabel && (
            <span className="text-gray-500"> · {escalation.context.siteLabel}</span>
          )}
        </p>
      )}

      {unsettled.length > 0 && (
        <div className="mt-3">
          <button
            onClick={() => setExpanded((v) => !v)}
            className="text-[11px] font-medium text-amber-200/90 transition hover:text-amber-100"
          >
            {expanded ? 'Hide' : 'Show'} what it saw
          </button>
          {expanded && (
            <ul className="mt-2 space-y-2.5">
              {unsettled.map((item, index) => (
                <li key={index} className="rounded-lg bg-ink-900/50 p-2.5">
                  <p className="text-[11px] text-gray-300">{item.expectation}</p>
                  {item.reasoning && (
                    <p className="mt-1 text-[11px] text-gray-500">{item.reasoning}</p>
                  )}
                  {item.evidence && (
                    <pre className="mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-ink-900/80 p-2 text-[10px] text-gray-400">
                      {item.evidence}
                    </pre>
                  )}
                  {item.url && (
                    <p className="mt-1 truncate font-mono text-[10px] text-gray-600">{item.url}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <input
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="Add a note (optional)"
        maxLength={2000}
        className="mt-3 w-full rounded-lg border border-white/10 bg-ink-900/60 px-3 py-2 text-xs text-gray-200 placeholder-gray-600 outline-none transition focus:border-brand-500/50"
      />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {busy && <SpinnerIcon className="animate-spin text-brand-300" width={14} height={14} />}
        {escalation.options.map((option) => (
          <OptionButton key={option.id} option={option} busy={busy} onPick={pick} />
        ))}
      </div>

      {error && <p className="mt-2 text-[11px] text-red-200">{error}</p>}
    </li>
  );
}

export function EscalationQueue() {
  const [escalations, setEscalations] = useState<Escalation[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .getEscalations()
      .then(({ escalations }) => setEscalations(escalations))
      // A dashboard that cannot reach the verifier should stay usable and say
      // nothing, rather than show an error nobody can act on.
      .catch(() => setEscalations([]));
  }, []);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, 20000);
    return () => window.clearInterval(timer);
  }, [load]);

  function handleResolved(id: string, message: string) {
    setEscalations((current) => (current ?? []).filter((item) => item.id !== id));
    setNotice(message);
    window.setTimeout(() => setNotice(null), 4000);
  }

  if (!escalations || escalations.length === 0) {
    return notice ? <p className="mt-4 text-xs text-emerald-300">{notice}</p> : null;
  }

  return (
    <section className="mt-8">
      <div className="flex items-center gap-2.5">
        <h2 className="text-lg font-semibold text-white">The verifier needs you</h2>
        <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-xs font-medium text-amber-200">
          {escalations.length}
        </span>
      </div>
      <p className="mt-1 text-sm text-gray-400">
        Checks that could not be settled automatically. Answering one either closes it or sends the
        assistant back to the site.
      </p>

      {notice && <p className="mt-2 text-xs text-emerald-300">{notice}</p>}

      <ul className="mt-4 space-y-3">
        {escalations.map((escalation) => (
          <EscalationCard
            key={escalation.id}
            escalation={escalation}
            onResolved={handleResolved}
          />
        ))}
      </ul>
    </section>
  );
}
