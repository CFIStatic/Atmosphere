import { useMemo, useState } from 'react';
import { eventClock } from '../../lib/downloadJson';
import type { EvidenceLogEntry } from '../../lib/api';

const FILTERS: Array<{ id: string; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'said', label: 'Said' },
  { id: 'decision', label: 'Decision' },
  { id: 'work', label: 'Work' },
  { id: 'scene', label: 'Scene' },
  { id: 'camera', label: 'Camera' },
  { id: 'activity', label: 'Activity' },
];

function matchesFilter(entry: EvidenceLogEntry, filter: string): boolean {
  if (filter === 'all') return true;
  const t = (entry.type || 'other').toLowerCase();
  if (filter === 'said') return t === 'said' || t === 'speech';
  return t === filter;
}

/**
 * Complete Analysis evidence log — every useful visual and speech beat,
 * filterable and seekable. The summary brief can sit above; this log is
 * the product.
 */
export function EvidenceLog({
  entries,
  onSeek,
  empty = 'No evidence moments to list yet.',
  status,
}: {
  entries: EvidenceLogEntry[];
  onSeek?: (seconds: number) => void;
  empty?: string;
  status?: 'pending' | 'failed' | null;
}) {
  const [filter, setFilter] = useState('all');
  const visible = useMemo(
    () => entries.filter((entry) => matchesFilter(entry, filter)),
    [entries, filter],
  );

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
  if (!entries.length) {
    return <p className="text-[12px] text-ink-500">{empty}</p>;
  }

  return (
    <div data-testid="evidence-log">
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <p className="mr-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-500">
          Evidence log
        </p>
        <p className="text-[10px] tabular-nums text-ink-400">
          {visible.length}
          {filter !== 'all' ? ` / ${entries.length}` : ''} rows
        </p>
      </div>
      <div className="mb-2 flex flex-wrap gap-1" role="tablist" aria-label="Evidence filters">
        {FILTERS.map((item) => {
          const count = entries.filter((e) => matchesFilter(e, item.id)).length;
          if (item.id !== 'all' && count === 0) return null;
          const active = filter === item.id;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setFilter(item.id)}
              className={
                active
                  ? 'rounded-full bg-ink-900 px-2 py-0.5 text-[10.5px] font-semibold text-paper-50'
                  : 'rounded-full bg-paper-200 px-2 py-0.5 text-[10.5px] font-medium text-ink-600 hover:bg-paper-300'
              }
            >
              {item.label}
              <span className="ml-1 tabular-nums opacity-70">{count}</span>
            </button>
          );
        })}
      </div>
      {!visible.length ? (
        <p className="text-[12px] text-ink-500">Nothing in this filter.</p>
      ) : (
        <ol className="divide-y divide-line/70" data-testid="evidence-log-rows">
          {visible.map((entry) => (
            <li key={`${entry.type}|${entry.atSeconds}|${entry.text}`}>
              <button
                type="button"
                data-at={entry.atSeconds}
                data-type={entry.type}
                onClick={() => onSeek?.(entry.atSeconds)}
                className="flex w-full items-start gap-3 px-0.5 py-2 text-left hover:bg-paper-100/80"
              >
                <span className="w-11 shrink-0 font-mono text-[12px] tabular-nums text-ink-500">
                  {eventClock(entry.atSeconds)}
                </span>
                <span className="min-w-0">
                  <span className="mb-0.5 mr-1.5 inline-block rounded-full bg-paper-200 px-1.5 py-px text-[9.5px] font-semibold uppercase tracking-wide text-ink-500">
                    {entry.type}
                  </span>
                  {entry.speakerLabel ? (
                    <span className="mb-0.5 mr-1.5 inline-block rounded-full bg-ink-900/90 px-1.5 py-px text-[9.5px] font-semibold uppercase tracking-wide text-paper-50">
                      {entry.speakerLabel}
                    </span>
                  ) : null}
                  {entry.owner ? (
                    <span className="mb-0.5 mr-1.5 inline-block rounded-full bg-paper-200 px-1.5 py-px text-[9.5px] font-semibold uppercase tracking-wide text-ink-500">
                      {entry.owner}
                    </span>
                  ) : null}
                  <span className="text-[13px] leading-snug text-ink-800">{entry.text}</span>
                  {entry.quote && entry.quote !== entry.text ? (
                    <span className="mt-0.5 block text-[11px] italic text-ink-500">“{entry.quote}”</span>
                  ) : null}
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** Prefer the complete evidence log; fall back to dictation entries. */
export function evidenceEntriesFromVideo(video: {
  evidenceLog?: EvidenceLogEntry[] | null;
  dictationEntries?: Array<{ atSeconds: number; text: string; type?: string | null }> | null;
  events?: Array<{ atSeconds: number; text?: string }> | null;
}): EvidenceLogEntry[] {
  if (video.evidenceLog?.length) return video.evidenceLog;
  if (video.dictationEntries?.length) {
    return video.dictationEntries.map((e) => ({
      atSeconds: e.atSeconds,
      text: e.text,
      type: (e.type || 'other').toLowerCase(),
    }));
  }
  return (video.events ?? [])
    .filter((e) => e.text)
    .map((e) => ({
      atSeconds: e.atSeconds,
      text: e.text || '',
      type: 'other',
    }));
}
