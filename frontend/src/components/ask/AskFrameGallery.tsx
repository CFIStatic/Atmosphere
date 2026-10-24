/**
 * The video stills a Chat answer shows: a strip of pictures labeled with the
 * day, time of day and clip moment. Two or more days read as a before/after.
 * Tapping a still opens that video at that moment. Stills this person may not
 * see never come back from the server, so they simply are not drawn.
 */
import { useEffect, useMemo, useState } from 'react';
import { api, type AskStill } from '../../lib/api';
import type { AskFrameRef, AskSourceChip } from '../../lib/askSources';
import { viewerDayKey } from '../../lib/viewerTime';

type Loaded = AskStill & { ref: AskFrameRef };

function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}

/** Calendar day: the work date, else the viewer's day of the capture. The UTC date prefix is already the next day for a late evening. */
function stillDay(still: AskStill): string | null {
  const raw = still.workDate ?? viewerDayKey(still.capturedAt);
  return /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : null;
}

function dayLabel(still: AskStill): string {
  const day = stillDay(still);
  if (!day) return 'Undated';
  const d = new Date(`${day}T12:00:00`);
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function timeOfDay(still: AskStill): string {
  if (!still.capturedAt) return '';
  const t = new Date(new Date(still.capturedAt).getTime() + still.atSeconds * 1000);
  return Number.isNaN(t.getTime()) ? '' : t.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function askStillsLoader(refs: AskFrameRef[]): Promise<AskStill[]> {
  return api.askStills(refs.map((r) => ({ proofId: r.proofId, atSeconds: r.atSeconds }))).then((res) => res.stills ?? []);
}

export function AskFrameGallery({
  frames,
  onOpen,
  load = askStillsLoader,
}: {
  frames: AskFrameRef[];
  onOpen: (source: AskSourceChip) => void;
  /** Test / screenshot hook. */
  load?: (refs: AskFrameRef[]) => Promise<AskStill[]>;
}) {
  const key = frames.map((f) => f.id).join(',');
  const [stills, setStills] = useState<Loaded[] | null>(null);
  const [zoom, setZoom] = useState<Loaded | null>(null);
  useEffect(() => {
    if (!frames.length) return;
    let live = true;
    load(frames)
      .then((rows) => {
        if (!live) return;
        const out: Loaded[] = [];
        for (const ref of frames) {
          const hit = rows.find((r) => r.proofId === ref.proofId && Math.abs(r.requestedSeconds - ref.atSeconds) < 0.05);
          if (hit) out.push({ ...hit, ref });
        }
        setStills(out);
      })
      .catch(() => live && setStills([]));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const groups = useMemo(() => {
    const byDay = new Map<string, Loaded[]>();
    for (const s of stills ?? []) {
      const day = stillDay(s) ?? '';
      byDay.set(day, [...(byDay.get(day) ?? []), s]);
    }
    // Before is the earliest calendar day. Cite order can list the later day first. Undated last.
    return [...byDay.entries()].sort(([a], [b]) => (a || '9999-99-99').localeCompare(b || '9999-99-99'));
  }, [stills]);

  if (!frames.length) return null;
  if (stills === null) {
    return (
      <div className="mt-2 flex gap-2" data-testid="ask-frames-loading" aria-label="Loading video stills">
        {frames.slice(0, 3).map((f) => (
          <div key={f.id} className="h-24 w-36 animate-pulse rounded-lg bg-paper-100" />
        ))}
      </div>
    );
  }
  if (!stills.length) return null;
  const compare = groups.length >= 2;
  const open = (s: Loaded) =>
    onOpen({
      id: s.ref.id as AskSourceChip['id'],
      label: s.title ?? 'Video',
      section: 'videos',
      jobId: s.jobId,
      proofId: s.proofId,
      atSeconds: s.atSeconds,
      workDate: s.workDate ?? undefined,
    });

  return (
    <div className="mt-2" data-testid="ask-frames">
      <div className={compare ? 'grid grid-cols-1 gap-3 sm:grid-cols-2' : ''}>
        {groups.map(([day, list], gi) => (
          <div key={day || 'undated'} data-testid="ask-frames-day">
            <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-500">
              {compare ? (
                <span className="rounded bg-ink-800 px-1.5 py-0.5 text-[10px] text-white">
                  {gi === 0 ? 'Before' : gi === groups.length - 1 ? 'After' : 'Then'}
                </span>
              ) : null}
              <span>{list[0] ? dayLabel(list[0]) : 'Undated'}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {list.map((s) => (
                <figure key={s.ref.id} className="w-40 overflow-hidden rounded-lg border border-line bg-paper-50">
                  <button
                    type="button"
                    data-testid="ask-frame"
                    data-proof-id={s.proofId}
                    data-at={String(s.atSeconds)}
                    onClick={() => setZoom(s)}
                    className="block aspect-video w-full overflow-hidden bg-ink-900"
                    title="Enlarge"
                  >
                    <img src={s.url} alt={`${s.title ?? 'Video'} at ${clock(s.atSeconds)}`} className="h-full w-full object-cover" loading="lazy" />
                  </button>
                  <figcaption className="flex items-center justify-between gap-1 px-2 py-1 text-[11px] text-ink-600">
                    <span className="truncate" title={s.title ?? ''}>
                      {[timeOfDay(s), s.title].filter(Boolean).join(' · ')}
                    </span>
                    <button
                      type="button"
                      data-testid="ask-frame-open"
                      onClick={() => open(s)}
                      className="shrink-0 rounded px-1 font-medium text-brand-700 hover:underline"
                      title="Open the video at this moment"
                    >
                      ▶ {clock(s.atSeconds)}
                    </button>
                  </figcaption>
                </figure>
              ))}
            </div>
          </div>
        ))}
      </div>
      {zoom ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          role="dialog"
          aria-label="Video still"
          data-testid="ask-frame-zoom"
          onClick={() => setZoom(null)}
        >
          <div className="max-w-4xl" onClick={(e) => e.stopPropagation()}>
            <img src={zoom.url} alt="" className="max-h-[75vh] w-auto rounded-lg" />
            <div className="mt-2 flex items-center justify-between text-sm text-white">
              <span>
                {dayLabel(zoom)} {timeOfDay(zoom) ? `· ${timeOfDay(zoom)}` : ''} · {zoom.title ?? 'Video'} at {clock(zoom.atSeconds)}
              </span>
              <span className="flex gap-2">
                <button type="button" className="rounded bg-white px-3 py-1 text-ink-900" onClick={() => { open(zoom); setZoom(null); }}>
                  Open video here
                </button>
                <button type="button" className="rounded border border-white/60 px-3 py-1" onClick={() => setZoom(null)}>
                  Close
                </button>
              </span>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
