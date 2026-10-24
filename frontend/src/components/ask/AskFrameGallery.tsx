/**
 * The video stills a Chat answer shows: a strip of pictures labeled with the
 * day, time of day and clip moment. Two or more days read as a before/after.
 * Tapping a still opens that video at that moment. Each still can also play
 * a short clip (about 5 s before to 10 s after) right in the answer; the
 * player stays inside that window. Stills and clips this person may not see
 * never come back from the server, so they simply are not drawn.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, type AskStill } from '../../lib/api';
import type { AskFrameRef, AskSourceChip } from '../../lib/askSources';

type Loaded = AskStill & { ref: AskFrameRef };

function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}

function dayLabel(still: AskStill): string {
  const day = still.workDate ?? (still.capturedAt ? still.capturedAt.slice(0, 10) : '');
  if (!/^\d{4}-\d{2}-\d{2}/.test(day)) return 'Undated';
  const d = new Date(`${day.slice(0, 10)}T12:00:00`);
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function timeOfDay(still: AskStill): string {
  if (!still.capturedAt) return '';
  const t = new Date(new Date(still.capturedAt).getTime() + still.atSeconds * 1000);
  return Number.isNaN(t.getTime()) ? '' : t.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/**
 * Plays only [start, end] of a video: media fragment for the first seek, and
 * the player is held inside the window (loops back, never runs past `end`).
 */
export function AskClipPlayer({ url, start, end, poster, label }: { url: string; start: number; end: number; poster: string; label: string }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const keep = () => {
    const v = ref.current;
    if (!v) return;
    if (v.currentTime < start - 0.25 || v.currentTime > end + 0.25) v.currentTime = start;
  };
  return (
    <video
      ref={ref}
      data-testid="ask-clip-video"
      src={`${url}#t=${start},${end}`}
      poster={poster}
      autoPlay
      muted
      playsInline
      controls
      preload="metadata"
      aria-label={label}
      className="h-full w-full bg-black object-contain"
      onLoadedMetadata={keep}
      onSeeking={keep}
      onPlay={keep}
      onTimeUpdate={() => {
        const v = ref.current;
        if (v && v.currentTime >= end) {
          v.pause();
          v.currentTime = start;
        }
      }}
    />
  );
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
  const [playing, setPlaying] = useState<ReadonlySet<string>>(() => new Set());
  const play = (id: string, on: boolean) =>
    setPlaying((cur) => {
      const next = new Set(cur);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
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
      const label = dayLabel(s);
      byDay.set(label, [...(byDay.get(label) ?? []), s]);
    }
    return [...byDay.entries()];
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
      <div className={compare ? 'grid grid-cols-2 gap-2 sm:gap-3' : ''}>
        {groups.map(([day, list], gi) => (
          <div key={day} data-testid="ask-frames-day">
            <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-500">
              {compare ? (
                <span className="rounded bg-ink-800 px-1.5 py-0.5 text-[10px] text-white">
                  {gi === 0 ? 'Before' : gi === groups.length - 1 ? 'After' : 'Then'}
                </span>
              ) : null}
              <span>{day}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {list.map((s) => (
                <figure
                  key={s.ref.id}
                  className={`overflow-hidden rounded-lg border border-line bg-paper-50 ${playing.has(s.ref.id) ? 'w-full max-w-md' : 'w-40'}`}
                >
                  <div className="relative block aspect-video w-full overflow-hidden bg-ink-900">
                    {playing.has(s.ref.id) && s.clip ? (
                      <AskClipPlayer
                        url={s.clip.url}
                        start={s.clip.start}
                        end={s.clip.end}
                        poster={s.url}
                        label={`${s.title ?? 'Video'} clip ${clock(s.clip.start)} to ${clock(s.clip.end)}`}
                      />
                    ) : (
                      <>
                        <button
                          type="button"
                          data-testid="ask-frame"
                          data-proof-id={s.proofId}
                          data-at={String(s.atSeconds)}
                          onClick={() => setZoom(s)}
                          className="block h-full w-full"
                          title="Enlarge"
                        >
                          <img src={s.url} alt={`${s.title ?? 'Video'} at ${clock(s.atSeconds)}`} className="h-full w-full object-cover" loading="lazy" />
                        </button>
                        {s.clip ? (
                          <button
                            type="button"
                            data-testid="ask-clip-play"
                            onClick={() => play(s.ref.id, true)}
                            className="absolute bottom-1 left-1 rounded-full bg-black/70 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-black/85"
                            title="Play a short clip of this moment"
                          >
                            ▶ Clip {Math.round(s.clip.end - s.clip.start)}s
                          </button>
                        ) : null}
                      </>
                    )}
                  </div>
                  <figcaption className="flex items-center justify-between gap-1 px-2 py-1 text-[11px] text-ink-600">
                    <span className="truncate" title={s.title ?? ''}>
                      {[timeOfDay(s), s.title].filter(Boolean).join(' · ')}
                    </span>
                    <span className="flex shrink-0 items-center gap-1">
                      {playing.has(s.ref.id) ? (
                        <button type="button" data-testid="ask-clip-close" onClick={() => play(s.ref.id, false)} className="rounded px-1 text-ink-500 hover:underline">
                          Close
                        </button>
                      ) : null}
                      <button
                        type="button"
                        data-testid="ask-frame-open"
                        onClick={() => open(s)}
                        className="rounded px-1 font-medium text-brand-700 hover:underline"
                        title="Open the full video at this moment"
                      >
                        ▶ {clock(s.atSeconds)}
                      </button>
                    </span>
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
            {zoom.clip ? (
              <div className="aspect-video w-[min(90vw,56rem)] overflow-hidden rounded-lg">
                <AskClipPlayer url={zoom.clip.url} start={zoom.clip.start} end={zoom.clip.end} poster={zoom.url} label={`${zoom.title ?? 'Video'} clip`} />
              </div>
            ) : (
              <img src={zoom.url} alt="" className="max-h-[75vh] w-auto rounded-lg" />
            )}
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
