import { useEffect, useMemo, useRef, useState } from 'react';
import { eventClock } from '../../lib/downloadJson';
import type { EvidenceLogEntry, TranscriptSegment } from '../../lib/api';
import { parseTimestampedTranscript } from '../../lib/transcriptCaptions';
import { useScrollFollow } from '../../hooks/useScrollFollow';

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

function activeIndexForTime(entries: EvidenceLogEntry[], atSeconds: number): number {
  let last = -1;
  for (let i = 0; i < entries.length; i += 1) {
    if (atSeconds + 0.15 >= entries[i]!.atSeconds) last = i;
    else break;
  }
  return last;
}

/**
 * Complete Analysis evidence log — every useful visual and speech beat,
 * filterable and seekable. The summary brief can sit above; this log is
 * the product.
 *
 * When `activeAtSeconds` is set (playhead sync), the matching row is
 * highlighted. Auto-scroll follow only runs while the user is near the
 * bottom or has not scrolled away — never force scrollIntoView on every
 * tick after they scroll up.
 */
export function EvidenceLog({
  entries,
  onSeek,
  empty = 'No evidence moments to list yet.',
  status,
  activeAtSeconds,
}: {
  entries: EvidenceLogEntry[];
  onSeek?: (seconds: number) => void;
  empty?: string;
  status?: 'pending' | 'failed' | null;
  /** Optional playhead seconds for active-row highlight + sticky follow. */
  activeAtSeconds?: number | null;
}) {
  const [filter, setFilter] = useState('all');
  const visible = useMemo(
    () => entries.filter((entry) => matchesFilter(entry, filter)),
    [entries, filter],
  );
  const followEnabled = activeAtSeconds != null && Number.isFinite(activeAtSeconds);
  const { scrollerRef, following, followActive, resume, setScroller } = useScrollFollow({
    enabled: followEnabled,
  });
  const rowRefs = useRef<Array<HTMLElement | null>>([]);
  const activeIdx = followEnabled
    ? activeIndexForTime(visible, activeAtSeconds as number)
    : -1;

  useEffect(() => {
    if (!followEnabled || activeIdx < 0) return;
    followActive(rowRefs.current[activeIdx]);
  }, [activeIdx, followEnabled, followActive]);

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
      <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
        <p className="mr-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-500">
          Evidence log
        </p>
        <p className="text-[10px] tabular-nums text-ink-400">
          {visible.length}
          {filter !== 'all' ? ` / ${entries.length}` : ''} rows
        </p>
        {followEnabled && !following ? (
          <button
            type="button"
            onClick={resume}
            className="ml-auto rounded-full bg-ink-900 px-2 py-0.5 text-[10px] font-semibold text-paper-50"
            data-testid="evidence-log-follow"
          >
            Follow playhead
          </button>
        ) : null}
      </div>
      <div className="mb-2.5 flex flex-wrap gap-1" role="tablist" aria-label="Evidence filters">
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
        <ol
          className="max-h-96 divide-y divide-line/60 overflow-y-auto"
          data-testid="evidence-log-rows"
          ref={(el) => {
            setScroller(el);
            scrollerRef.current = el;
          }}
        >
          {visible.map((entry, index) => {
            const isActive = index === activeIdx;
            return (
              <li
                key={`${entry.type}|${entry.atSeconds}|${entry.text}`}
                ref={(el) => {
                  rowRefs.current[index] = el;
                }}
                data-active={isActive ? '1' : undefined}
                className={isActive ? 'bg-brand-50/80' : undefined}
              >
                <button
                  type="button"
                  data-at={entry.atSeconds}
                  data-type={entry.type}
                  onClick={() => onSeek?.(entry.atSeconds)}
                  className="flex w-full items-start gap-3 px-1 py-2.5 text-left hover:bg-paper-100/80"
                >
                  <span
                    className={
                      'w-11 shrink-0 font-mono text-[12px] tabular-nums ' +
                      (isActive ? 'font-bold text-brand-700' : 'text-ink-500')
                    }
                  >
                    {eventClock(entry.atSeconds)}
                  </span>
                  <span className="min-w-0 space-y-1">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="inline-block rounded-full bg-paper-200 px-1.5 py-px text-[9.5px] font-semibold uppercase tracking-wide text-ink-500">
                        {entry.type}
                      </span>
                      {entry.speakerLabel ? (
                        <span
                          className="inline-block rounded-full bg-ink-900/90 px-1.5 py-px text-[9.5px] font-semibold uppercase tracking-wide text-paper-50"
                          data-testid="evidence-speaker"
                        >
                          {entry.speakerLabel}
                        </span>
                      ) : null}
                      {entry.owner ? (
                        <span className="inline-block rounded-full bg-paper-200 px-1.5 py-px text-[9.5px] font-semibold uppercase tracking-wide text-ink-500">
                          {entry.owner}
                        </span>
                      ) : null}
                    </span>
                    {'\n'}
                    <span className="block text-[13px] leading-relaxed text-ink-800">{entry.text}</span>
                    {entry.quote && entry.quote !== entry.text ? (
                      <span className="block text-[11px] italic leading-relaxed text-ink-500">
                        “{entry.quote}”
                      </span>
                    ) : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function normalizeEvidenceKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isNearDuplicate(a: EvidenceLogEntry, b: EvidenceLogEntry): boolean {
  if (Math.abs(a.atSeconds - b.atSeconds) > 1.5) return false;
  const left = normalizeEvidenceKey(a.text);
  const right = normalizeEvidenceKey(b.text);
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.length >= 24 && right.includes(left.slice(0, 24))) return true;
  if (right.length >= 24 && left.includes(right.slice(0, 24))) return true;
  return false;
}

function speechEntriesFromVideo(video: {
  transcriptSegments?: TranscriptSegment[] | null;
  transcriptText?: string | null;
  heardOnMic?: string | null;
  conversation?: {
    transcriptSegments?: TranscriptSegment[] | null;
    transcriptText?: string | null;
  } | null;
}): EvidenceLogEntry[] {
  const segments = video.transcriptSegments?.length
    ? video.transcriptSegments
    : video.conversation?.transcriptSegments?.length
      ? video.conversation.transcriptSegments
      : parseTimestampedTranscript(
          video.transcriptText ?? video.heardOnMic ?? video.conversation?.transcriptText,
        );
  return segments
    .filter((row) => row.text?.trim())
    .map((row) => ({
      atSeconds: row.tSec != null && Number.isFinite(row.tSec) ? row.tSec : 0,
      text: row.text.trim(),
      type: 'said',
      speakerLabel: row.speakerLabel ?? null,
    }));
}

/** Complete Analysis log: stored evidence, then dictation, then events, plus every mic line. */
export function evidenceEntriesFromVideo(video: {
  evidenceLog?: EvidenceLogEntry[] | null;
  dictationEntries?: Array<{ atSeconds: number; text: string; type?: string | null }> | null;
  events?: Array<{ atSeconds: number; text?: string }> | null;
  transcriptText?: string | null;
  heardOnMic?: string | null;
  transcriptSegments?: TranscriptSegment[] | null;
  conversation?: {
    transcriptSegments?: TranscriptSegment[] | null;
    transcriptText?: string | null;
  } | null;
}): EvidenceLogEntry[] {
  const base: EvidenceLogEntry[] = video.evidenceLog?.length
    ? video.evidenceLog
    : video.dictationEntries?.length
      ? video.dictationEntries.map((e) => ({
          atSeconds: e.atSeconds,
          text: e.text,
          type: (e.type || 'other').toLowerCase(),
        }))
      : (video.events ?? [])
          .filter((e) => e.text)
          .map((e) => ({
            atSeconds: e.atSeconds,
            text: e.text || '',
            type: 'other',
          }));
  const out = [...base];
  for (const row of speechEntriesFromVideo(video)) {
    if (out.some((prev) => isNearDuplicate(prev, row))) continue;
    out.push(row);
  }
  return out.sort((a, b) => a.atSeconds - b.atSeconds || a.text.localeCompare(b.text));
}
