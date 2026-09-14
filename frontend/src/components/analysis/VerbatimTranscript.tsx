import { useEffect, useMemo, useRef, useState } from 'react';
import { eventClock } from '../../lib/downloadJson';
import type { TranscriptSegment } from '../../lib/api';
import { useScrollFollow } from '../../hooks/useScrollFollow';

function activeIndexForTime(rows: TranscriptSegment[], atSeconds: number): number {
  let last = -1;
  for (let i = 0; i < rows.length; i += 1) {
    const t = rows[i]!.tSec;
    if (t != null && Number.isFinite(t) && atSeconds + 0.15 >= t) last = i;
  }
  return last;
}

/**
 * Searchable, seekable verbatim Whisper transcript.
 * Exact words only — never a paraphrase of what was said.
 *
 * Speaker label sits on its own line above the quote body so names never
 * glue onto the first word (`FriedbergI think`).
 */
export function VerbatimTranscript({
  segments,
  transcriptText,
  onSeek,
  activeAtSeconds,
}: {
  segments?: TranscriptSegment[] | null;
  transcriptText?: string | null;
  onSeek?: (seconds: number) => void;
  activeAtSeconds?: number | null;
}) {
  const [query, setQuery] = useState('');
  const rows = useMemo(() => {
    if (segments?.length) return segments;
    const raw = String(transcriptText || '').trim();
    if (!raw) return [] as TranscriptSegment[];
    return [{ tSec: null, text: raw, speakerLabel: null }];
  }, [segments, transcriptText]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (row) =>
        row.text.toLowerCase().includes(q) ||
        (row.speakerLabel && row.speakerLabel.toLowerCase().includes(q)),
    );
  }, [rows, query]);

  const followEnabled = activeAtSeconds != null && Number.isFinite(activeAtSeconds) && !query.trim();
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

  if (!rows.length) return null;

  return (
    <div className="mt-4 rounded-lg border border-line/80 bg-white/60 px-3 py-3" data-testid="verbatim-transcript">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">
          Exact transcript
        </p>
        <div className="flex items-center gap-2">
          <p className="text-[10px] tabular-nums text-ink-400">
            {visible.length}
            {query ? ` / ${rows.length}` : ''} lines · verbatim
          </p>
          {followEnabled && !following ? (
            <button
              type="button"
              onClick={resume}
              className="rounded-full bg-ink-900 px-2 py-0.5 text-[10px] font-semibold text-paper-50"
              data-testid="verbatim-follow"
            >
              Follow playhead
            </button>
          ) : null}
        </div>
      </div>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search exact words…"
        className="mt-2.5 w-full rounded-md border border-line bg-paper-50 px-2.5 py-1.5 text-[12.5px] text-ink-800 outline-none focus:border-ink-400"
        data-testid="verbatim-search"
      />
      {!visible.length ? (
        <p className="mt-2 text-[12px] text-ink-500">No lines match that search.</p>
      ) : (
        <ol
          className="mt-2.5 max-h-80 divide-y divide-line/50 overflow-y-auto"
          data-testid="verbatim-lines"
          ref={(el) => {
            setScroller(el);
            scrollerRef.current = el;
          }}
        >
          {visible.map((row, index) => {
            const seekable = row.tSec != null && Number.isFinite(row.tSec) && row.tSec >= 0;
            const isActive = index === activeIdx;
            const body = (
              <>
                <span
                  className={
                    'w-11 shrink-0 font-mono text-[11px] tabular-nums ' +
                    (isActive ? 'font-bold text-brand-700' : 'text-ink-500')
                  }
                >
                  {seekable ? eventClock(row.tSec!) : '—'}
                </span>
                <span className="min-w-0 space-y-1">
                  {row.speakerLabel ? (
                    <>
                      <span
                        className="block text-[10px] font-semibold uppercase tracking-[0.06em] text-ink-500"
                        data-testid="transcript-speaker"
                      >
                        {row.speakerLabel}
                      </span>
                      {'\n'}
                    </>
                  ) : null}
                  <span className="block text-[13px] leading-relaxed text-ink-900">{row.text}</span>
                </span>
              </>
            );
            return (
              <li
                key={`${row.tSec}|${index}|${row.text.slice(0, 40)}`}
                ref={(el) => {
                  rowRefs.current[index] = el;
                }}
                data-active={isActive ? '1' : undefined}
                className={isActive ? 'bg-brand-50/80' : undefined}
              >
                {seekable ? (
                  <button
                    type="button"
                    data-at={row.tSec!}
                    onClick={() => onSeek?.(row.tSec!)}
                    className="flex w-full items-start gap-2.5 px-1 py-2.5 text-left hover:bg-paper-100/80"
                  >
                    {body}
                  </button>
                ) : (
                  <div className="flex items-start gap-2.5 px-1 py-2.5">{body}</div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
