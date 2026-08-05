import type { ReactNode } from 'react';
import type { CaptureStep } from '../../lib/api';

/**
 * The shot list as a single connected path.
 *
 * One rail from the first step to the record button, because that is the
 * claim the design makes: filming is not a form to read and then a button to
 * find — it is one motion, and the button is the last step of it. The same
 * component draws the guide on the subcontractor's phone and the Field
 * platform's capture screen, so a crew that moves between them never relearns
 * the shape.
 *
 * The whys stay visible but small. On a job site the instruction is what gets
 * followed; the why is what stops it being deleted from the habit a week
 * later.
 */
export function CaptureGuideSteps({
  steps,
  final,
}: {
  steps: CaptureStep[];
  /** The last node on the rail — the record button, or a pointer to it. */
  final: ReactNode;
}) {
  return (
    <ol className="mt-3">
      {steps.map((step, i) => (
        <li key={i} className="flex gap-3">
          <span className="flex flex-col items-center">
            <span
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10.5px] font-bold ${
                step.kind === 'anchor'
                  ? 'bg-brand-600 text-white'
                  : step.kind === 'exclusion'
                    ? 'border border-caution-200 bg-caution-50 text-caution-600'
                    : 'bg-paper-200 text-ink-600'
              }`}
            >
              {i + 1}
            </span>
            <span className="w-px flex-1 bg-line" aria-hidden="true" />
          </span>
          <span className="min-w-0 pb-3.5">
            <span
              className={`block text-xs leading-snug ${
                step.kind === 'anchor' ? 'font-semibold text-ink-900' : 'text-ink-800'
              }`}
            >
              {step.kind === 'anchor' && <span className="text-brand-600">Start here — </span>}
              {step.instruction}
            </span>
            <span className="mt-0.5 block text-[10.5px] leading-snug text-ink-400">{step.why}</span>
          </span>
        </li>
      ))}
      <li className="flex gap-3">
        <span className="flex flex-col items-center">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ink-900 text-[10.5px] text-paper-0">
            ●
          </span>
        </span>
        <span className="min-w-0 flex-1 pb-0.5">{final}</span>
      </li>
    </ol>
  );
}
