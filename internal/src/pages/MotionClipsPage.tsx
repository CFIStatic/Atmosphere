import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../lib/api';
import type { MotionClipsStaffResponse, MotionTypeBucket } from '../lib/types';
import { EmptyState, SectionHeading, StatTile } from '../components/ui';

function formatWindow(startSec: number, endSec: number): string {
  const fmt = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${String(sec).padStart(2, '0')}`;
  };
  return `${fmt(startSec)}–${fmt(endSec)}`;
}

export function MotionClipsPage() {
  const [data, setData] = useState<MotionClipsStaffResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [motion, setMotion] = useState<string>('all');

  useEffect(() => {
    let cancelled = false;
    api
      .motionClipsStaff({ limit: 150 })
      .then((payload) => {
        if (!cancelled) setData(payload);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Could not load motion clips');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const buckets: MotionTypeBucket[] = useMemo(() => {
    if (!data?.buckets) return [];
    if (motion === 'all') return data.buckets;
    return data.buckets.filter((b) => b.motion === motion || b.action === motion);
  }, [data, motion]);

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Motion clips</h1>
      <p className="mt-1 text-sm text-ink-500">
        Robotics-ready skill corpus: narrow trade motions (screw, cut, measure, …) labelled from
        verified Field Capture evidence. Privacy ranges are excluded. Atmosphere never invents a
        motion without evidence. See docs/motion-clips.md.
      </p>
      {error && <p className="mt-4 text-sm text-danger-600">{error}</p>}

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <StatTile label="Clips" value={String(data?.totalClips ?? '—')} />
        <StatTile label="Motion types" value={String(data?.types?.length ?? '—')} />
        <StatTile label="Showing" value={String(buckets.reduce((n, b) => n + b.clips.length, 0))} />
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          className={`rounded-md px-3 py-1.5 text-sm ${motion === 'all' ? 'bg-paper-200' : 'text-ink-600'}`}
          onClick={() => setMotion('all')}
        >
          All
        </button>
        {(data?.types ?? []).map((t) => (
          <button
            key={t.motion}
            type="button"
            className={`rounded-md px-3 py-1.5 text-sm ${
              motion === t.motion ? 'bg-paper-200' : 'text-ink-600'
            }`}
            onClick={() => setMotion(t.motion)}
          >
            {t.motion} ({t.count})
          </button>
        ))}
      </div>

      <SectionHeading title="By motion type" />
      {!data && !error && <p className="text-sm text-ink-500">Loading…</p>}
      {data && data.totalClips === 0 && (
        <EmptyState title="No motion clips yet" body="Verified films with evidenced actions will populate this corpus." />
      )}
      <div className="grid gap-4">
        {buckets.map((bucket) => (
          <article key={bucket.motion} className="rounded-xl border border-line bg-paper-0 p-5">
            <div className="flex items-baseline gap-2">
              <h2 className="font-semibold">{bucket.motion}</h2>
              {bucket.action && bucket.action !== bucket.motion && (
                <span className="text-xs text-ink-500">action: {bucket.action}</span>
              )}
              <span className="ml-auto font-mono text-xs text-ink-500">{bucket.count}</span>
            </div>
            <ul className="mt-3 space-y-2 text-sm">
              {bucket.clips.map((clip) => (
                <li key={`${clip.proofId}-${clip.startSec}-${clip.description}`} className="border-t border-line pt-2">
                  <p className="text-ink-900">{clip.description}</p>
                  <p className="text-[11px] text-ink-500">
                    {formatWindow(clip.startSec, clip.endSec)}
                    {clip.jobId ? ` · job ${clip.jobId.slice(0, 8)}` : ''}
                    {clip.proofId ? ` · proof ${clip.proofId.slice(0, 8)}` : ''}
                    {clip.orgId ? ` · org ${clip.orgId.slice(0, 8)}` : ''}
                    {' · '}
                    {Math.round(clip.confidence * 100)}%
                  </p>
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </div>
  );
}
