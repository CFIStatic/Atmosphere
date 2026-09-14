import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { jobFilePath } from '../lib/jobFileAsk';
import {
  ACTIVITY_LABEL,
  projectPins,
  type LiveActivity,
  type LiveMapJob,
  type LiveMapResponse,
} from '../lib/liveJobMap';
import { AlertIcon, NavigationIcon, RefreshIcon, VideoIcon } from '../components/icons';
import { cn } from '../design';

const ACTIVITY_TONE: Record<LiveActivity, string> = {
  uploading: 'bg-brand-50 text-brand-700',
  on_site: 'bg-emerald-50 text-emerald-700',
  recent_upload: 'bg-caution-50 text-caution-700',
  in_progress: 'bg-paper-200 text-ink-700',
  idle: 'bg-paper-100 text-ink-500',
};

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

const POLL_MS = 30_000;

export function LiveJobMapPage() {
  const [data, setData] = useState<LiveMapResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showGaps, setShowGaps] = useState(false);

  const load = useCallback(async () => {
    try {
      const next = await api.liveJobMap();
      setData(next);
      setError(null);
      setSelectedId((prev) => {
        if (prev && next.jobs.some((j) => j.jobId === prev)) return prev;
        return next.jobs[0]?.jobId ?? null;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the live map.');
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  const pins = useMemo(() => projectPins(data?.jobs ?? []), [data?.jobs]);
  const selected = data?.jobs.find((j) => j.jobId === selectedId) ?? null;

  return (
    <div className="mx-auto max-w-6xl" data-testid="live-job-map">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink-900">Live map</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-500">
            Who is on site or filing film, last geo ping when available, and open safety
            flags — one office screen. Uses job site geo, proof pings, Field Capture opens,
            uploads, and safety incidents.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-2 rounded-md border border-line bg-paper-0 px-3 py-1.5 text-sm text-ink-700 hover:bg-paper-100"
        >
          <RefreshIcon width={14} height={14} />
          Refresh
        </button>
      </div>

      {error && <p className="mt-4 text-sm text-danger-600">{error}</p>}

      {data && (
        <>
          <div className="mt-5 grid gap-3 sm:grid-cols-4">
            <Stat label="Open jobs" value={data.summary.jobs} />
            <Stat label="Active now" value={data.summary.active} />
            <Stat label="With pins" value={data.summary.withCoords} />
            <Stat
              label="Open safety"
              value={data.summary.openSafety}
              emphasize={data.summary.criticalSafety > 0}
            />
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
            <ul className="space-y-2" data-testid="live-job-map-list">
              {(data.jobs ?? []).length === 0 ? (
                <li className="rounded-lg border border-dashed border-line bg-paper-50 px-4 py-8 text-center text-sm text-ink-500">
                  No open jobs. Start a job to see it here.
                </li>
              ) : (
                data.jobs.map((job) => (
                  <li key={job.jobId}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(job.jobId)}
                      className={cn(
                        'w-full rounded-lg border px-3 py-3 text-left transition',
                        selectedId === job.jobId
                          ? 'border-brand-400 bg-brand-50/60'
                          : 'border-line bg-paper-0 hover:bg-paper-50',
                      )}
                      data-testid="live-job-map-row"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-ink-900">
                          {job.jobNumber != null ? `#${job.jobNumber} ` : ''}
                          {job.title}
                        </span>
                        <span
                          className={cn(
                            'rounded-full px-2 py-0.5 text-[11px] font-medium',
                            ACTIVITY_TONE[job.activity],
                          )}
                        >
                          {ACTIVITY_LABEL[job.activity]}
                        </span>
                        {job.openSafetyFlags.some((f) => f.severity === 'critical') && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-danger-50 px-2 py-0.5 text-[11px] font-medium text-danger-700">
                            <AlertIcon width={12} height={12} />
                            Critical
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-ink-500">
                        {job.address ?? 'No site address'}
                        {job.lastPingAt
                          ? ` · last ping ${formatWhen(job.lastPingAt)}`
                          : ' · no recent ping'}
                      </p>
                      {job.people.length > 0 && (
                        <p className="mt-1 text-xs text-ink-600">
                          {job.people.map((p) => p.name).join(', ')}
                        </p>
                      )}
                    </button>
                  </li>
                ))
              )}
            </ul>

            <div className="rounded-lg border border-line bg-paper-0 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-ink-800">Map</p>
                <p className="text-[11px] text-ink-500">
                  Proof pin preferred over property. No live crew GPS.
                </p>
              </div>
              {pins.length === 0 ? (
                <div className="grid h-[280px] place-items-center rounded-md bg-paper-100 text-sm text-ink-500">
                  No coordinates yet — intake geo or a proof with location will place pins.
                </div>
              ) : (
                <svg
                  viewBox="0 0 640 420"
                  className="h-auto w-full rounded-md bg-[linear-gradient(180deg,#eef4f8,#f7f5f1)]"
                  role="img"
                  aria-label="Job map"
                  data-testid="live-job-map-svg"
                >
                  <rect x="0" y="0" width="640" height="420" fill="transparent" />
                  {pins.map(({ job, x, y }) => {
                    const critical = job.openSafetyFlags.some((f) => f.severity === 'critical');
                    const active = job.jobId === selectedId;
                    return (
                      <g
                        key={job.jobId}
                        transform={`translate(${x} ${y})`}
                        className="cursor-pointer"
                        onClick={() => setSelectedId(job.jobId)}
                      >
                        <circle
                          r={active ? 11 : 8}
                          fill={critical ? '#dc2626' : job.activity === 'idle' ? '#94a3b8' : '#F2670C'}
                          stroke={active ? '#0f172a' : 'white'}
                          strokeWidth={active ? 2.5 : 1.5}
                        />
                        {(job.activity === 'uploading' || job.activity === 'on_site') && (
                          <circle
                            r={16}
                            fill="none"
                            stroke={critical ? '#dc2626' : '#F2670C'}
                            strokeOpacity="0.35"
                            strokeWidth="2"
                          />
                        )}
                      </g>
                    );
                  })}
                </svg>
              )}

              {selected && <SelectedDetail job={selected} />}
            </div>
          </div>

          <div className="mt-6 rounded-lg border border-line bg-paper-50 px-4 py-3">
            <button
              type="button"
              className="text-sm font-medium text-ink-700"
              onClick={() => setShowGaps((v) => !v)}
            >
              {showGaps ? 'Hide' : 'Show'} known gaps
            </button>
            {showGaps && (
              <ul className="mt-2 list-disc space-y-1 ps-5 text-xs text-ink-500">
                {(data.gaps ?? []).map((gap) => (
                  <li key={gap}>{gap}</li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-[11px] text-ink-500">
              Generated {formatWhen(data.generatedAt)}. See docs/live-job-map.md.
            </p>
          </div>
        </>
      )}

      {!data && !error && (
        <p className="mt-8 text-sm text-ink-500">Loading live jobs…</p>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  emphasize,
}: {
  label: string;
  value: number;
  emphasize?: boolean;
}) {
  return (
    <div className="rounded-lg border border-line bg-paper-0 px-4 py-3">
      <p className="text-[11px] uppercase tracking-wide text-ink-500">{label}</p>
      <p
        className={cn(
          'mt-1 text-2xl font-semibold tabular-nums',
          emphasize ? 'text-danger-600' : 'text-ink-900',
        )}
      >
        {value}
      </p>
    </div>
  );
}

function SelectedDetail({ job }: { job: LiveMapJob }) {
  return (
    <div className="mt-3 rounded-md border border-line bg-paper-50 p-3" data-testid="live-job-map-detail">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium text-ink-900">
            {job.jobNumber != null ? `#${job.jobNumber} ` : ''}
            {job.title}
          </p>
          <p className="mt-0.5 text-xs text-ink-500">{job.address ?? 'No site address'}</p>
        </div>
        <Link
          to={jobFilePath(job.jobId, { title: job.title, number: job.jobNumber })}
          className="rounded-md bg-brand-600 px-3 py-1.5 text-sm text-white hover:bg-brand-700"
        >
          Open job file
        </Link>
      </div>
      <div className="mt-2 flex flex-wrap gap-3 text-xs text-ink-600">
        <span className="inline-flex items-center gap-1">
          <NavigationIcon width={12} height={12} />
          {job.coords
            ? `${job.coords.lat.toFixed(4)}, ${job.coords.lon.toFixed(4)} (${job.coords.source})`
            : 'No coordinates'}
        </span>
        <span className="inline-flex items-center gap-1">
          <VideoIcon width={12} height={12} />
          {job.filmedToday ? 'Filmed today' : 'No film today'}
        </span>
      </div>
      {job.lastPingLabel && job.lastPingAt && (
        <p className="mt-2 text-xs text-ink-500">
          {job.lastPingLabel} · {formatWhen(job.lastPingAt)}
        </p>
      )}
      {job.openSafetyFlags.length > 0 && (
        <ul className="mt-3 space-y-1">
          {job.openSafetyFlags.map((flag) => (
            <li
              key={flag.id}
              className={cn(
                'rounded-md px-2 py-1.5 text-xs',
                flag.severity === 'critical'
                  ? 'bg-danger-50 text-danger-700'
                  : 'bg-caution-50 text-caution-700',
              )}
            >
              <span className="font-medium">{flag.title}</span>
              <span className="opacity-80">
                {' '}
                · {flag.category.replace(/_/g, ' ')} · {flag.severity}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
