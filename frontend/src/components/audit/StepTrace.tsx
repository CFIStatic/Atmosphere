import { useEffect, useMemo, useRef, useState } from 'react';
import type { AuditStep } from '../../lib/api';
import { STEP_TYPE_LABELS } from '../../lib/api';
import { ChevronRightIcon } from '../icons';
import { JsonBlock, STEP_ICONS, formatDuration } from './shared';

/**
 * A run's trace, in the two ways people actually read one.
 *
 * **Timeline** answers "what happened" — the whole sequence at once, skimmable
 * by shape, which is what you want when hunting for the step that went wrong.
 *
 * **Step through** answers "what happened *next*" — one step at a time, with
 * the surrounding steps shown but dimmed. That is the mode for explaining a run
 * to someone else, or for following an agent's reasoning where the order is the
 * whole point and a wall of steps hides it.
 */

interface Props {
  steps: AuditStep[];
  /** A live run appends as you watch; stepping should follow the tail. */
  live?: boolean;
}

function StepGlyph({ step, muted = false }: { step: AuditStep; muted?: boolean }) {
  const Icon = STEP_ICONS[step.type] ?? STEP_ICONS.event;
  const tone =
    step.status === 'error'
      ? 'border-rose-500/40 bg-rose-500/10 text-rose-300'
      : step.status === 'pending'
        ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
        : 'border-white/10 bg-ink-700/70 text-gray-300';
  return (
    <span
      className={`grid h-8 w-8 shrink-0 place-items-center rounded-full border ${tone} ${muted ? 'opacity-50' : ''}`}
    >
      <Icon width={15} height={15} />
    </span>
  );
}

function StepHeading({ step }: { step: AuditStep }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <span className="font-mono text-xs text-gray-500">#{step.seq}</span>
      <span className="text-sm font-medium text-white">
        {step.action || STEP_TYPE_LABELS[step.type] || step.type}
      </span>
      <span className="rounded border border-white/10 bg-ink-700/60 px-1.5 py-0.5 text-[11px] text-gray-400">
        {STEP_TYPE_LABELS[step.type] ?? step.type}
      </span>
      {step.durationMs !== null && (
        <span className="text-xs text-gray-500">{formatDuration(step.durationMs)}</span>
      )}
    </div>
  );
}

function StepBody({ step, expanded }: { step: AuditStep; expanded: boolean }) {
  return (
    <>
      {step.detail && (
        <p
          className={`mt-1 whitespace-pre-wrap text-sm text-gray-300 ${expanded ? '' : 'line-clamp-3'}`}
        >
          {step.detail}
        </p>
      )}
      {step.target && (
        <p className="mt-1 truncate font-mono text-xs text-gray-500" title={step.target}>
          {step.target}
        </p>
      )}
      {step.error && (
        <p className="mt-2 rounded-md border border-rose-500/30 bg-rose-500/10 px-2.5 py-1.5 text-xs text-rose-200">
          {step.error}
        </p>
      )}
      {expanded && step.payload !== null && step.payload !== undefined && (
        <div className="mt-2">
          <JsonBlock label="Payload" value={step.payload} />
        </div>
      )}
    </>
  );
}

export function StepTrace({ steps, live = false }: Props) {
  const [mode, setMode] = useState<'timeline' | 'stepper'>('timeline');
  const [cursor, setCursor] = useState(0);
  const focusRef = useRef<HTMLDivElement | null>(null);

  const lastIndex = Math.max(0, steps.length - 1);
  const current = steps[Math.min(cursor, lastIndex)];

  // A live run appends while you watch. Following the tail is right until the
  // reader steps back deliberately — from then on, stay where they put it.
  const followingTail = useRef(true);
  useEffect(() => {
    if (live && followingTail.current) setCursor(lastIndex);
  }, [live, lastIndex]);

  function moveTo(next: number) {
    const clamped = Math.max(0, Math.min(next, lastIndex));
    followingTail.current = clamped === lastIndex;
    setCursor(clamped);
  }

  // Arrow keys drive the stepper, except while the reader is typing in a filter.
  // The move is expressed as a delta against the previous cursor so the handler
  // does not close over it — otherwise this would rebind on every step taken.
  useEffect(() => {
    if (mode !== 'stepper') return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      const delta =
        event.key === 'ArrowRight' || event.key === 'ArrowDown'
          ? 1
          : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
            ? -1
            : 0;
      if (!delta) return;
      event.preventDefault();
      setCursor((prev) => {
        const next = Math.max(0, Math.min(prev + delta, lastIndex));
        followingTail.current = next === lastIndex;
        return next;
      });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, lastIndex]);

  useEffect(() => {
    if (mode === 'stepper') focusRef.current?.scrollIntoView({ block: 'nearest' });
  }, [cursor, mode]);

  const neighbours = useMemo(() => {
    if (!steps.length) return [];
    const from = Math.max(0, cursor - 3);
    return steps.slice(from, Math.min(steps.length, cursor + 4)).map((step, offset) => ({
      step,
      index: from + offset,
    }));
  }, [steps, cursor]);

  if (!steps.length) {
    return (
      <p className="rounded-lg border border-dashed border-white/10 px-4 py-8 text-center text-sm text-gray-500">
        {live
          ? 'This run has not reported a step yet.'
          : 'This run finished without recording any steps.'}
      </p>
    );
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-white">
          Trace
          <span className="ml-2 font-normal text-gray-500">
            {steps.length} step{steps.length === 1 ? '' : 's'}
          </span>
        </h3>
        <div
          role="tablist"
          aria-label="Trace view"
          className="flex rounded-lg border border-white/10 bg-ink-800/60 p-0.5 text-xs"
        >
          {(['timeline', 'stepper'] as const).map((value) => (
            <button
              key={value}
              role="tab"
              aria-selected={mode === value}
              onClick={() => setMode(value)}
              className={`rounded-md px-2.5 py-1 font-medium transition ${
                mode === value ? 'bg-brand-600/30 text-white' : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              {value === 'timeline' ? 'Timeline' : 'Step through'}
            </button>
          ))}
        </div>
      </div>

      {mode === 'timeline' ? (
        <ol className="relative space-y-3 border-l border-white/10 pl-5">
          {steps.map((step) => (
            <li key={step.id} className="relative">
              <span className="absolute -left-[2.4rem] top-0">
                <StepGlyph step={step} />
              </span>
              <div className="rounded-lg border border-white/10 bg-ink-800/50 px-3.5 py-2.5">
                <StepHeading step={step} />
                <StepBody step={step} expanded />
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <div>
          {/* Focused step */}
          <div
            ref={focusRef}
            className="rounded-xl border border-brand-500/30 bg-ink-800/70 p-4 ring-1 ring-inset ring-brand-500/20"
          >
            <div className="flex items-start gap-3">
              <StepGlyph step={current} />
              <div className="min-w-0 flex-1">
                <StepHeading step={current} />
                <StepBody step={current} expanded />
              </div>
            </div>
          </div>

          {/* Transport */}
          <div className="mt-3 flex items-center gap-3">
            <button
              onClick={() => moveTo(cursor - 1)}
              disabled={cursor <= 0}
              className="rounded-lg border border-white/10 bg-ink-700/70 px-3 py-1.5 text-sm text-gray-200 transition hover:bg-ink-600 disabled:opacity-40"
            >
              <ChevronRightIcon width={16} height={16} className="rotate-180" />
              <span className="sr-only">Previous step</span>
            </button>
            <div className="flex-1">
              <div className="h-1.5 overflow-hidden rounded-full bg-ink-700">
                <div
                  className="h-full rounded-full bg-brand-500 transition-all"
                  style={{ width: `${((cursor + 1) / steps.length) * 100}%` }}
                />
              </div>
              <p className="mt-1.5 text-center text-xs text-gray-500">
                Step {cursor + 1} of {steps.length}
                <span className="ml-2 hidden sm:inline">· arrow keys to move</span>
              </p>
            </div>
            <button
              onClick={() => moveTo(cursor + 1)}
              disabled={cursor >= lastIndex}
              className="rounded-lg border border-white/10 bg-ink-700/70 px-3 py-1.5 text-sm text-gray-200 transition hover:bg-ink-600 disabled:opacity-40"
            >
              <ChevronRightIcon width={16} height={16} />
              <span className="sr-only">Next step</span>
            </button>
          </div>

          {/* Surrounding steps, so the reader keeps their place in the run */}
          <ol className="mt-4 space-y-1">
            {neighbours.map(({ step, index }) => (
              <li key={step.id}>
                <button
                  onClick={() => moveTo(index)}
                  aria-current={index === cursor}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition ${
                    index === cursor ? 'bg-brand-600/20 text-white' : 'text-gray-400 hover:bg-white/5'
                  }`}
                >
                  <StepGlyph step={step} muted={index !== cursor} />
                  <span className="min-w-0 flex-1 truncate text-sm">
                    <span className="font-mono text-xs text-gray-500">#{step.seq}</span>{' '}
                    {step.action || STEP_TYPE_LABELS[step.type]}
                    {step.detail && <span className="text-gray-500"> — {step.detail}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
