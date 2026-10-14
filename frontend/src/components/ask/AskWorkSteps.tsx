/**
 * What Chat shows while it works: the people-readable step lines and the
 * one-line summary of the work once the answer is in.
 */
import { useState } from 'react';
import { type JobFileTurn } from '../../lib/jobFileAsk';
import { SpinnerIcon } from '../icons';

/**
 * Steps written for people (server statuses in backend askReasoning / jobFileAsk).
 * Anything else is an internal phase name and is never shown.
 */
export const ASK_STEPS = new Set([
  'Looking through clips…',
  'Searching what was said…',
  'Opening a clip…',
  'Checking other jobs…',
  'Looking up who was on site…',
  'Reading the job history…',
  'Searching the web…',
  'Writing the answer…',
  'Starting Computer…',
  'Checking the CRM…',
  'Updating the job…',
  'Drafting the text…',
  'Checking who has access…',
  'Reading the punch list…',
  'Finding the moment…',
  'Drafting…',
  'Reading the job…',
]);

/** A server status as a step line, or null when it is not one written for people. */
export function askStepLabel(phase: string | null | undefined): string | null {
  const value = (phase ?? '').replace(/\s+/g, ' ').trim().replace(/\.{3}$/, '…');
  return ASK_STEPS.has(value) ? value : null;
}

/** Wall clock for the "Worked for" summary; read in event handlers only. */
export const askClock = () => Date.now();

export function formatWorkTime(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

/** "Worked for 6s · 2 steps" above an answer; opens to the step list. */
export function AskWorkSummary({ work }: { work: NonNullable<JobFileTurn['work']> }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-1.5" data-testid="ask-work-summary">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 text-[12px] text-ink-500 transition hover:text-ink-800"
      >
        <span aria-hidden className={`inline-block transition-transform ${open ? 'rotate-90' : ''}`}>›</span>
        Worked for {formatWorkTime(work.ms)}
        {work.steps.length > 1 ? ` · ${work.steps.length} steps` : ''}
      </button>
      {open ? (
        <ol className="mt-1 space-y-0.5 border-l border-line pl-3 text-[12px] text-ink-600">
          {work.steps.map((step, i) => (
            <li key={`${step}-${i}`} className="flex items-center gap-1.5">
              <span aria-hidden className="text-success-600">✓</span>
              {step.replace(/…$/, '')}
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

/** While answering: finished steps ticked, the current one spinning. */
export function AskLiveSteps({ steps }: { steps: string[] }) {
  return (
    <ol className="space-y-1 text-[13px]" data-testid="ask-live-steps" aria-live="polite">
      {steps.map((step, i) => {
        const current = i === steps.length - 1;
        return (
          <li key={`${step}-${i}`} className={`flex items-center gap-2 ${current ? 'text-ink-800' : 'text-ink-400'}`}>
            {current ? (
              <SpinnerIcon className="animate-spin" width={12} height={12} />
            ) : (
              <span aria-hidden className="w-3 text-center text-success-600">✓</span>
            )}
            {current ? step : step.replace(/…$/, '')}
          </li>
        );
      })}
    </ol>
  );
}

export function askPhaseLabel(phase: string | null | undefined): string {
  const value = (phase ?? '').trim();
  if (/search(?:ing)? the web/i.test(value)) return 'Searching the web…';
  if (/computer|browser/i.test(value)) return 'Starting Computer…';
  if (/writing/i.test(value)) return 'Writing…';
  return 'Thinking';
}
