import { useEffect, useMemo, useState } from 'react';
import { api, type MotionClipsBrowseResponse, type MotionTypeBucket } from '../../lib/api';

function formatWindow(startSec: number, endSec: number): string {
  const fmt = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${String(sec).padStart(2, '0')}`;
  };
  return `${fmt(startSec)}–${fmt(endSec)}`;
}

/**
 * Browse robotics-ready motion clips for a job file, grouped by narrow motion
 * type (screw, cut, measure, …). Only evidence-backed clips; privacy excluded.
 */
export function MotionClipsBrowser({ jobId }: { jobId: string }) {
  const [data, setData] = useState<MotionClipsBrowseResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [motion, setMotion] = useState<string | 'all'>('all');

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    void (async () => {
      try {
        const res = await api.motionClipsForJob(jobId);
        if (!cancelled) setData(res);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not load motion clips.');
          setData(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  const buckets: MotionTypeBucket[] = useMemo(() => {
    if (!data?.buckets) return [];
    if (motion === 'all') return data.buckets;
    return data.buckets.filter((b) => b.motion === motion || b.action === motion);
  }, [data, motion]);

  const typeChips = data?.types ?? [];

  return (
    <section className="rounded-xl glass-card p-5" data-testid="motion-clips-browser">
      <div>
        <h2 className="text-base font-semibold text-ink-900">Motion clips</h2>
        <p className="mt-0.5 text-xs text-ink-500">
          Narrow trade motions labelled from verified video (screw, cut, measure, …) — skill
          corpus foundation for robotics. Privacy ranges are excluded. Atmosphere never invents
          a motion without evidence.
        </p>
      </div>

      {error && (
        <p role="alert" className="mt-3 text-xs text-danger-600">
          {error}
        </p>
      )}

      {data === null && !error ? (
        <p className="mt-3 text-xs text-ink-500">Loading motion clips…</p>
      ) : data && data.totalClips === 0 ? (
        <p className="mt-3 text-xs text-ink-500" data-testid="motion-clips-empty">
          No motion clips on this job yet. Once films are analysed with evidenced actions, timed
          segments show up here by motion type.
        </p>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap gap-1.5" data-testid="motion-clips-filters">
            <button
              type="button"
              className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
                motion === 'all' ? 'bg-brand-600 text-white' : 'bg-paper-200/70 text-ink-700'
              }`}
              onClick={() => setMotion('all')}
            >
              All ({data?.totalClips ?? 0})
            </button>
            {typeChips.map((t) => (
              <button
                key={t.motion}
                type="button"
                className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
                  motion === t.motion ? 'bg-brand-600 text-white' : 'bg-paper-200/70 text-ink-700'
                }`}
                onClick={() => setMotion(t.motion)}
                data-testid={`motion-filter-${t.motion}`}
              >
                {t.motion} ({t.count})
              </button>
            ))}
          </div>

          <ul className="mt-3 space-y-3">
            {buckets.map((bucket) => (
              <li key={bucket.motion}>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500">
                  {bucket.motion}
                  {bucket.action && bucket.action !== bucket.motion ? (
                    <span className="ml-1 font-normal normal-case text-ink-400">
                      → {bucket.action}
                    </span>
                  ) : null}
                </h3>
                <ul className="mt-1.5 space-y-1.5">
                  {bucket.clips.map((clip) => (
                    <li
                      key={`${clip.proofId}-${clip.startSec}-${clip.motion}-${clip.description}`}
                      className="rounded-lg border border-line px-3 py-2"
                      data-testid="motion-clip-row"
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <p className="text-sm text-ink-900">{clip.description}</p>
                        <span className="shrink-0 font-mono text-[11px] text-ink-500">
                          {formatWindow(clip.startSec, clip.endSec)}
                          {clip.durationInferred ? ' · ~' : ''}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[11px] text-ink-500">
                        {[clip.toolLabel, clip.objectLabel, clip.room].filter(Boolean).join(' · ') ||
                          'Evidence from verified analysis'}
                        {' · '}
                        {Math.round(clip.confidence * 100)}% conf
                      </p>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
