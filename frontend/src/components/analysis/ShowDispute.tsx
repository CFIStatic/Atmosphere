import { useState } from 'react';
import { eventClock } from '../../lib/downloadJson';
import type { DisputeMoment } from '../../lib/api';

const KIND_WORD: Record<DisputeMoment['kind'], string> = {
  integrity: 'Integrity',
  scope: 'Scope',
  clip: 'Clips disagree',
};

/**
 * One control: tap → the moments that conflict with scope or each other.
 * Hidden when the file is clean — no empty "None on this clip" banner.
 */
export function ShowDispute({
  disputes,
  onSeek,
}: {
  disputes: DisputeMoment[];
  onSeek?: (moment: DisputeMoment) => void;
}) {
  const [open, setOpen] = useState(false);
  const count = disputes.length;
  if (!count) return null;
  return (
    <div className="rounded-lg border border-line">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left"
      >
        <span className="text-[13px] font-semibold text-ink-900">Show me the dispute</span>
        <span className="text-[11px] font-medium text-caution-600">
          {count} moment{count === 1 ? '' : 's'}
        </span>
      </button>
      {open && (
        <div className="border-t border-line px-3 py-2.5" data-testid="dispute-list">
          <ol className="space-y-2">
            {disputes.map((moment) => (
              <li key={moment.id}>
                <button
                  type="button"
                  onClick={() => onSeek?.(moment)}
                  className="block w-full rounded-md px-1 py-1 text-left hover:bg-paper-100/80"
                >
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-[10.5px] font-semibold uppercase tracking-wide text-ink-500">
                      {KIND_WORD[moment.kind]}
                    </span>
                    {moment.seekSeconds != null && (
                      <span className="font-mono text-[11px] tabular-nums text-brand-700">
                        {eventClock(moment.seekSeconds)}
                      </span>
                    )}
                    {moment.workDate && (
                      <span className="text-[11px] text-ink-500">{moment.workDate}</span>
                    )}
                  </span>
                  <span className="mt-0.5 block text-[13px] font-medium text-ink-900">
                    {moment.title}
                  </span>
                  <span className="mt-0.5 block text-[12px] leading-snug text-ink-600">
                    {moment.detail}
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
