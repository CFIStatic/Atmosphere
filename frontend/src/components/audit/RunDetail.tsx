import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type AuditRun, type AuditStep } from '../../lib/api';
import { CloseIcon, DownloadIcon, SpinnerIcon } from '../icons';
import { StepTrace } from './StepTrace';
import {
  ACCENT_STYLES,
  Field,
  JsonBlock,
  StatusChip,
  formatDateTime,
  formatDuration,
  formatNumber,
} from './shared';

/**
 * One run, in full: who asked for it, what it was asked to do, how it ended,
 * and every step in between.
 *
 * A run that is still going is polled rather than pushed. The ledger is written
 * by whichever process is doing the work — sometimes not this one — so there is
 * no socket to hang the update on, and asking for "steps after the last one I
 * hold" keeps the poll a constant cost however long the run gets.
 */

const POLL_MS = 2500;
const TERMINAL = ['succeeded', 'failed', 'cancelled'];

export function RunDetail({ runId, onClose }: { runId: string; onClose?: () => void }) {
  const [run, setRun] = useState<AuditRun | null>(null);
  const [steps, setSteps] = useState<AuditStep[]>([]);
  const [moreSteps, setMoreSteps] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  // Read inside the poll without making it a dependency, which would tear the
  // interval down and rebuild it on every arriving step.
  const stepsRef = useRef<AuditStep[]>([]);
  stepsRef.current = steps;

  const live = Boolean(run && !TERMINAL.includes(run.status));

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSteps([]);
    setRun(null);

    api
      .auditRun(runId)
      .then((data) => {
        if (cancelled) return;
        setRun(data.run);
        setSteps(data.steps);
        setMoreSteps(data.moreSteps);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load this run.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [runId]);

  useEffect(() => {
    if (!live) return;
    let cancelled = false;

    const timer = setInterval(async () => {
      const held = stepsRef.current;
      const afterSeq = held.length ? held[held.length - 1].seq : 0;
      try {
        const data = await api.auditRun(runId, afterSeq);
        if (cancelled) return;
        setRun(data.run);
        if (data.steps.length) setSteps((prev) => [...prev, ...data.steps]);
      } catch {
        // A failed poll is not worth a visible error: the next one is 2.5s
        // away, and tearing the trace down would lose the reader's place.
      }
    }, POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [live, runId]);

  const loadMore = useCallback(async () => {
    const held = stepsRef.current;
    if (!held.length) return;
    setLoadingMore(true);
    try {
      const data = await api.auditRun(runId, held[held.length - 1].seq);
      setSteps((prev) => [...prev, ...data.steps]);
      setMoreSteps(data.moreSteps);
    } catch {
      /* the button stays; the reader can try again */
    } finally {
      setLoadingMore(false);
    }
  }, [runId]);

  /** The whole trace as a file — what an auditor asks for by the second question. */
  function exportRun() {
    if (!run) return;
    const blob = new Blob([JSON.stringify({ run, steps }, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `atmosphere-run-${run.id}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  if (loading) {
    return (
      <div className="grid place-items-center py-20 text-brand-600">
        <SpinnerIcon className="animate-spin" width={24} height={24} />
        <span className="sr-only">Loading run…</span>
      </div>
    );
  }

  if (error || !run) {
    return (
      <div className="px-4 py-16 text-center">
        <p className="text-sm text-danger-600">{error ?? 'That run could not be loaded.'}</p>
      </div>
    );
  }

  const accent = ACCENT_STYLES[run.agent.accent] ?? ACCENT_STYLES.brand;
  const actor =
    run.actorEmail ??
    run.actorLabel ??
    (run.actorType === 'schedule'
      ? 'On a schedule'
      : run.actorType === 'system'
        ? 'System'
        : run.actorType === 'agent'
          ? 'Another agent'
          : 'Unknown');

  return (
    <div className="animate-fade-in-up">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-md px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${accent.soft} ${accent.text} ${accent.ring}`}
            >
              {run.agent.name}
            </span>
            {run.agentLabel && <span className="text-xs text-ink-500">{run.agentLabel}</span>}
            <StatusChip status={run.status} />
          </div>
          <h2 className="mt-2 break-words text-lg font-semibold text-ink-900">{run.title}</h2>
          {run.summary && <p className="mt-1 text-sm text-ink-600">{run.summary}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            onClick={exportRun}
            title="Download this run as JSON"
            className="rounded-lg border border-line p-2 text-ink-600 transition hover:bg-paper-100 hover:text-ink-800"
          >
            <DownloadIcon width={16} height={16} />
            <span className="sr-only">Download this run</span>
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="rounded-lg border border-line p-2 text-ink-600 transition hover:bg-paper-100 hover:text-ink-800 xl:hidden"
            >
              <CloseIcon width={16} height={16} />
              <span className="sr-only">Close run</span>
            </button>
          )}
        </div>
      </div>

      {run.error && (
        <p className="mt-3 rounded-lg border border-danger-200 bg-danger-50 px-3 py-2 text-sm text-danger-700">
          {run.error}
        </p>
      )}

      <div className="mt-4 grid grid-cols-2 gap-4 rounded-xl border border-line bg-paper-0 p-4 sm:grid-cols-3 lg:grid-cols-4">
        <Field label="Started by">{actor}</Field>
        <Field label="Started">{formatDateTime(run.startedAt ?? run.createdAt)}</Field>
        <Field label="Finished">{formatDateTime(run.finishedAt)}</Field>
        <Field label="Duration">{formatDuration(run.durationMs)}</Field>
        <Field label="Steps">{formatNumber(run.stepCount)}</Field>
        <Field label="Tokens">
          {run.inputTokens || run.outputTokens
            ? `${formatNumber(run.inputTokens)} in · ${formatNumber(run.outputTokens)} out`
            : '—'}
        </Field>
        <Field label="Recorded via">
          {run.sourceTable ? `mirrored from ${run.sourceTable}` : 'reported by the agent'}
        </Field>
        <Field label="Run id">
          <span className="font-mono text-xs text-ink-600">{run.id.slice(0, 8)}…</span>
        </Field>
      </div>

      {(run.input !== null || run.result !== null) && (
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <JsonBlock label="Input" value={run.input} />
          <JsonBlock label="Result" value={run.result} />
        </div>
      )}

      <div className="mt-6">
        <StepTrace steps={steps} live={live} />
        {moreSteps && (
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-line bg-paper-0 px-4 py-2 text-sm text-ink-700 transition hover:bg-paper-200 disabled:opacity-60"
          >
            {loadingMore && <SpinnerIcon className="animate-spin" width={15} height={15} />}
            Load more steps
          </button>
        )}
      </div>
    </div>
  );
}
