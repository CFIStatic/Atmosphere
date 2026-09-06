import { eventClock } from '../../lib/downloadJson';
import type { DictationEventEntry } from '../../lib/api';

/**
 * The Analysis reading: event-boundary times, one or two sentences, click to seek.
 * No essay wall. A lone 0:00 dump is filtered before it reaches this list.
 */
export function EventTimeline({
  events,
  onSeek,
  empty = 'No distinct moments to list.',
  status,
}: {
  events: DictationEventEntry[];
  onSeek?: (seconds: number) => void;
  empty?: string;
  status?: 'pending' | 'failed' | null;
}) {
  if (status === 'pending') {
    return (
      <div className="rounded-lg bg-paper-100/70 px-3 py-3" data-status="pending">
        <div className="mb-2 space-y-1.5" aria-hidden="true">
          <span className="block h-2 w-11/12 rounded bg-paper-200" />
          <span className="block h-2 w-8/12 rounded bg-paper-200" />
        </div>
        <p className="text-[11px] text-ink-500">Reading this clip.</p>
      </div>
    );
  }
  if (status === 'failed') {
    return (
      <div className="rounded-lg bg-paper-100/70 px-3 py-3" data-status="failed">
        <p className="text-[12px] font-medium text-ink-800">Reading failed</p>
        <p className="mt-0.5 text-[11px] text-ink-500">The footage itself is unaffected.</p>
      </div>
    );
  }
  if (!events.length) {
    return <p className="text-[12px] text-ink-500">{empty}</p>;
  }
  return (
    <ol className="divide-y divide-line/70" data-testid="event-timeline">
      {events.map((event) => (
        <li key={`${event.atSeconds}|${event.text}`}>
          <button
            type="button"
            data-at={event.atSeconds}
            onClick={() => onSeek?.(event.atSeconds)}
            className="flex w-full items-start gap-3 px-0.5 py-2 text-left hover:bg-paper-100/80"
          >
            <span className="w-11 shrink-0 font-mono text-[12px] tabular-nums text-ink-500">
              {eventClock(event.atSeconds)}
            </span>
            <span className="min-w-0">
              {event.type && (
                <span className="mb-0.5 mr-1.5 inline-block rounded-full bg-paper-200 px-1.5 py-px text-[9.5px] font-semibold uppercase tracking-wide text-ink-500">
                  {event.type}
                </span>
              )}
              <span className="text-[13px] leading-snug text-ink-800">{event.text}</span>
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}
