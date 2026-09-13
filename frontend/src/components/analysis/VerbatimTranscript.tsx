import { useMemo, useState } from 'react';
import { eventClock } from '../../lib/downloadJson';
import type { TranscriptSegment } from '../../lib/api';

/**
 * Searchable, seekable verbatim Whisper transcript.
 * Exact words only — never a paraphrase of what was said.
 */
export function VerbatimTranscript({
  segments,
  transcriptText,
  onSeek,
}: {
  segments?: TranscriptSegment[] | null;
  transcriptText?: string | null;
  onSeek?: (seconds: number) => void;
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

  if (!rows.length) return null;

  return (
    <div className="mt-3 rounded-lg border border-line/80 bg-white/60 px-3 py-2.5" data-testid="verbatim-transcript">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">
          Exact transcript
        </p>
        <p className="text-[10px] tabular-nums text-ink-400">
          {visible.length}
          {query ? ` / ${rows.length}` : ''} lines · verbatim
        </p>
      </div>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search exact words…"
        className="mt-2 w-full rounded-md border border-line bg-paper-50 px-2.5 py-1.5 text-[12.5px] text-ink-800 outline-none focus:border-ink-400"
        data-testid="verbatim-search"
      />
      {!visible.length ? (
        <p className="mt-2 text-[12px] text-ink-500">No lines match that search.</p>
      ) : (
        <ol className="mt-2 max-h-80 divide-y divide-line/60 overflow-y-auto" data-testid="verbatim-lines">
          {visible.map((row, index) => {
            const seekable = row.tSec != null && Number.isFinite(row.tSec) && row.tSec >= 0;
            const body = (
              <>
                <span className="w-11 shrink-0 font-mono text-[11px] tabular-nums text-ink-500">
                  {seekable ? eventClock(row.tSec!) : '—'}
                </span>
                <span className="min-w-0">
                  {row.speakerLabel ? (
                    <span className="mr-1.5 inline-block rounded-full bg-ink-900/90 px-1.5 py-px text-[9.5px] font-semibold uppercase tracking-wide text-paper-50">
                      {row.speakerLabel}
                    </span>
                  ) : null}
                  <span className="text-[12.5px] leading-snug text-ink-900">{row.text}</span>
                </span>
              </>
            );
            return (
              <li key={`${row.tSec}|${index}|${row.text.slice(0, 40)}`}>
                {seekable ? (
                  <button
                    type="button"
                    data-at={row.tSec!}
                    onClick={() => onSeek?.(row.tSec!)}
                    className="flex w-full items-start gap-2 px-0.5 py-1.5 text-left hover:bg-paper-100/80"
                  >
                    {body}
                  </button>
                ) : (
                  <div className="flex items-start gap-2 px-0.5 py-1.5">{body}</div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
