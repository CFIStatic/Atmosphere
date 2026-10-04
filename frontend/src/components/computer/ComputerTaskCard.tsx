import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import {
  COMPUTER_STATUS_LABEL,
  computerEventLabel,
  computerTaskIsActive,
  computerTaskRef,
  type ComputerTaskView,
} from '../../lib/computer';
import { SpinnerIcon } from '../icons';
import { ComputerApprovalCard } from './ComputerApprovalCard';
import { ComputerLiveView } from './ComputerLiveView';
import { ComputerNeedsYouCard } from './ComputerNeedsYouCard';

const POLL_MS = 1500;

function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

const TONE: Record<ComputerTaskView['status'], string> = {
  queued: 'bg-paper-200 text-ink-700',
  running: 'bg-success-50 text-success-600',
  awaiting_approval: 'bg-caution-50 text-caution-600',
  needs_you: 'bg-brand-50 text-brand-700',
  succeeded: 'bg-success-50 text-success-600',
  failed: 'bg-danger-50 text-danger-600',
  canceled: 'bg-paper-200 text-ink-600',
};

export function ComputerNotSetUpCard() {
  return (
    <div className="rounded-xl border border-line bg-paper-50 p-3" data-testid="computer-not-set-up">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">Computer</p>
      <p className="mt-0.5 text-[15px] font-semibold text-ink-900">Computer isn't set up</p>
      <p className="mt-1 text-sm text-ink-700">
        Chat can't open a browser for your company yet. Nothing was opened and nothing was filled in. Ask Atmosphere support to turn on
        Computer.
      </p>
    </div>
  );
}

/**
 * A Computer task in the Chat thread. Polls the task every 1.5 s while it is
 * active (that is the status stream), and shows the approval or Needs-you
 * card when the agent is waiting on the person.
 */
export function ComputerTaskCard({ path, summary }: { path?: string; summary?: string }) {
  const ref = computerTaskRef(path);
  if (!ref || ref.kind === 'not_set_up') return <ComputerNotSetUpCard />;
  if (ref.kind === 'error') {
    return (
      <div className="rounded-xl border border-line bg-paper-50 p-3 text-sm text-ink-700" data-testid="computer-error">
        {summary || 'Computer could not start this task.'}
      </div>
    );
  }
  return <ComputerTaskLive taskId={ref.id} />;
}

function ComputerTaskLive({ taskId }: { taskId: string }) {
  const [task, setTask] = useState<ComputerTaskView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState<'watch' | 'control' | null>(null);
  const [busy, setBusy] = useState(false);
  const [showSteps, setShowSteps] = useState(false);

  const load = useCallback(async () => {
    try {
      const { task: next } = await api.computerTask(taskId);
      setTask(next);
      setError(null);
      return next;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load this task.');
      return null;
    }
  }, [taskId]);

  useEffect(() => {
    let timer: number | null = null;
    let stopped = false;
    const tick = async () => {
      const next = await load();
      if (stopped) return;
      if (!next || computerTaskIsActive(next.status)) timer = window.setTimeout(tick, POLL_MS);
    };
    void tick();
    return () => {
      stopped = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [load]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  };

  if (!task) {
    return (
      <div className="rounded-xl border border-line bg-paper-50 p-3 text-sm text-ink-600" data-testid="computer-task-card">
        {error ?? 'Loading the browser task…'}
      </div>
    );
  }

  const active = computerTaskIsActive(task.status);
  const host = hostOf(task.currentUrl) ?? hostOf(task.startUrl);
  const takeControl = () => setLive('control');
  const handBack = () =>
    act(async () => {
      await api.computerHandBack(task.id);
      setLive('watch');
    });

  return (
    <div className="space-y-2.5 rounded-xl border border-line bg-paper-0 p-3" data-testid="computer-task-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">Computer</span>
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${TONE[task.status]}`}>
            {task.status === 'running' || task.status === 'queued' ? <SpinnerIcon className="h-3 w-3 animate-spin" /> : null}
            {COMPUTER_STATUS_LABEL[task.status]}
          </span>
        </div>
        <span className="text-[11px] text-ink-500">
          Step {task.stepCount} of {task.maxSteps}
        </span>
      </div>
      <p className="line-clamp-2 text-sm text-ink-800">{task.instructions}</p>
      {active ? (
        <p className="text-[12px] text-ink-600">
          {host ? <span className="font-medium text-ink-700">{host}</span> : null}
          {host && (task.lastAction || task.statusDetail) ? ' · ' : null}
          {task.statusDetail || task.lastAction || (task.status === 'queued' ? 'Waiting for a browser…' : 'Working…')}
        </p>
      ) : null}

      {task.status === 'awaiting_approval' && task.approval && task.approval.status === 'pending' ? (
        <ComputerApprovalCard
          approval={task.approval}
          busy={busy}
          onApprove={() => act(() => api.computerApprove(task.approval!.id))}
          onTakeControl={takeControl}
          onCancel={() => act(() => api.computerCancelApproval(task.approval!.id))}
        />
      ) : null}

      {task.status === 'needs_you' && task.needsYou ? (
        <ComputerNeedsYouCard
          needsYou={task.needsYou}
          busy={busy}
          onTakeControl={takeControl}
          onResume={() =>
            act(async () => {
              await api.computerResume(task.id);
              setLive(null);
            })
          }
          onCancel={() => act(() => api.computerCancel(task.id))}
        />
      ) : null}

      {live && task.canWatch ? (
        <ComputerLiveView
          taskId={task.id}
          mode={live}
          onClose={() => setLive(null)}
          onTakeControl={takeControl}
          onHandBack={task.status === 'running' || task.status === 'awaiting_approval' ? handBack : undefined}
        />
      ) : null}

      {task.status === 'succeeded' && task.resultSummary ? (
        <p className="rounded-lg bg-success-50 px-2.5 py-2 text-sm text-ink-800">{task.resultSummary}</p>
      ) : null}
      {(task.status === 'failed' || task.status === 'canceled') && (task.error || task.resultSummary) ? (
        <p className="rounded-lg bg-paper-100 px-2.5 py-2 text-sm text-ink-700">{task.error || task.resultSummary}</p>
      ) : null}
      {error ? <p className="text-[12px] text-danger-600">{error}</p> : null}

      <div className="flex flex-wrap items-center gap-1.5">
        {task.canWatch && live !== 'watch' ? (
          <button
            type="button"
            onClick={() => setLive('watch')}
            className="rounded-full border border-line bg-paper-0 px-3 py-1 text-[12px] font-semibold text-ink-800 transition hover:border-brand-200"
          >
            Watch
          </button>
        ) : null}
        {task.canWatch && live !== 'control' && task.status !== 'awaiting_approval' && task.status !== 'needs_you' ? (
          <button
            type="button"
            onClick={takeControl}
            className="rounded-full border border-line bg-paper-0 px-3 py-1 text-[12px] font-semibold text-ink-800 transition hover:border-brand-200"
          >
            Take control
          </button>
        ) : null}
        {active && task.status !== 'needs_you' ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => act(() => api.computerCancel(task.id))}
            className="rounded-full border border-line bg-paper-0 px-3 py-1 text-[12px] font-medium text-ink-600 transition hover:text-danger-600 disabled:opacity-50"
          >
            Stop
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => setShowSteps((v) => !v)}
          className="rounded-full px-2 py-1 text-[12px] font-medium text-ink-500 transition hover:text-ink-800"
          aria-expanded={showSteps}
        >
          {showSteps ? 'Hide steps' : `Steps (${task.events.length})`}
        </button>
      </div>

      {showSteps ? (
        <div className="space-y-2">
          <ol className="max-h-48 space-y-0.5 overflow-auto rounded-lg bg-paper-50 px-2.5 py-2 text-[12px] text-ink-700" data-testid="computer-steps">
            {task.events.map((e) => (
              <li key={e.id}>{computerEventLabel(e)}</li>
            ))}
          </ol>
          {task.jobFields.length ? (
            <div className="text-[12px] text-ink-600">
              <p className="font-semibold text-ink-700">Job details Computer may use</p>
              <ul className="mt-0.5 space-y-0.5">
                {task.jobFields.map((f) => (
                  <li key={`${f.label}-${f.value}`}>
                    {f.label}: <span className="text-ink-800">{f.value}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
