import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PageHeader } from '../components/AppShell';
import {
  api,
  type FieldContextSessionDetail,
  type FieldContextSessionSummary,
} from '../lib/api';
import { SpinnerIcon } from '../components/icons';
import { useFeatureTimer } from '../hooks/useFeatureTimer';

/**
 * Office view of everything Apple allows Field Capture to collect while a
 * crew films — organized by category, not dumped as a raw JSON blob.
 */

const CATEGORY_META: Array<{
  key: keyof FieldContextSessionDetail['categories'];
  title: string;
  blurb: string;
}> = [
  {
    key: 'device',
    title: 'Device & app',
    blurb: 'Model, OS, app build, locale, screen — no advertising IDs.',
  },
  {
    key: 'permissions',
    title: 'Permissions',
    blurb: 'What the crew granted on that phone for this day.',
  },
  {
    key: 'capabilities',
    title: 'Capabilities',
    blurb: 'LiDAR, RoomPlan, cameras, barometer, pedometer.',
  },
  {
    key: 'environment',
    title: 'Environment',
    blurb: 'Battery, thermal state, network, free disk.',
  },
  {
    key: 'capture',
    title: 'Day film',
    blurb: 'Audiovisual seal, duration, hash, storage path.',
  },
  {
    key: 'locationSummary',
    title: 'Location summary',
    blurb: 'When-in-use GPS trail summary for job attribution.',
  },
  {
    key: 'motionSummary',
    title: 'Motion summary',
    blurb: 'Activity, steps, and barometer while filming.',
  },
];

function fmtWhen(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function fmtBytes(n: unknown): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

function humanKey(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function ValueCell({ value }: { value: unknown }) {
  if (value === null || value === undefined || value === '') {
    return <span className="text-ink-400">—</span>;
  }
  if (typeof value === 'boolean') {
    return <span>{value ? 'Yes' : 'No'}</span>;
  }
  if (typeof value === 'number') {
    return <span className="font-mono text-[13px]">{value}</span>;
  }
  if (Array.isArray(value)) {
    if (!value.length) return <span className="text-ink-400">None</span>;
    return (
      <ul className="space-y-1 text-[13px]">
        {value.slice(0, 12).map((item, i) => (
          <li key={i} className="rounded bg-paper-100 px-2 py-1 text-ink-700">
            {typeof item === 'object' && item ? (
              <span className="font-mono text-[12px]">{JSON.stringify(item)}</span>
            ) : (
              String(item)
            )}
          </li>
        ))}
      </ul>
    );
  }
  if (typeof value === 'object') {
    return <span className="font-mono text-[12px] text-ink-600">{JSON.stringify(value)}</span>;
  }
  const s = String(value);
  if (s.endsWith('Bytes') || /bytes/i.test(s)) return <span>{s}</span>;
  return <span className="break-all">{s}</span>;
}

function BundleTable({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data).filter(([, v]) => v !== undefined);
  if (!entries.length) {
    return <p className="text-sm text-ink-500">Nothing recorded in this category yet.</p>;
  }
  return (
    <dl className="grid gap-3 sm:grid-cols-2">
      {entries.map(([key, value]) => (
        <div key={key} className="min-w-0">
          <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">
            {key.toLowerCase().includes('bytes') ? humanKey(key) : humanKey(key)}
          </dt>
          <dd className="mt-0.5 text-sm text-ink-800">
            {key.toLowerCase().includes('bytes') ? fmtBytes(value) : <ValueCell value={value} />}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function FieldContextPage() {
  useFeatureTimer('field_context');
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('session');
  const jobFilter = params.get('job') ?? undefined;

  const [sessions, setSessions] = useState<FieldContextSessionSummary[]>([]);
  const [detail, setDetail] = useState<FieldContextSessionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .fieldContextSessions({ jobId: jobFilter, limit: 100 })
      .then((res) => {
        if (!cancelled) setSessions(res.sessions);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message || 'Could not load field context.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [jobFilter]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    api
      .fieldContextSession(selectedId)
      .then((res) => {
        if (!cancelled) setDetail(res);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message || 'Could not load session.');
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const selected = useMemo(
    () => sessions.find((s) => s.id === selectedId) ?? detail?.session ?? null,
    [sessions, selectedId, detail],
  );

  function openSession(id: string) {
    const next = new URLSearchParams(params);
    next.set('session', id);
    setParams(next, { replace: false });
  }

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Field context"
        description="Everything Apple allows Field Capture to collect while the crew films — organized for the office."
      />

      {error && (
        <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
        <aside className="min-w-0">
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.09em] text-ink-500">
              Capture sessions
            </h2>
            {jobFilter && (
              <Link
                to="/field-context"
                className="text-[12px] font-medium text-brand-700 hover:underline"
              >
                Clear job filter
              </Link>
            )}
          </div>

          {loading ? (
            <div className="flex items-center gap-2 text-sm text-ink-500">
              <SpinnerIcon className="animate-spin" /> Loading…
            </div>
          ) : sessions.length === 0 ? (
            <p className="text-sm text-ink-500">
              No Field Capture context yet. Sessions appear after a crew starts a day film in the
              iOS Field Capture app.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {sessions.map((s) => {
                const active = s.id === selectedId;
                const model = typeof s.device?.model === 'string' ? s.device.model : s.platform;
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => openSession(s.id)}
                      className={`w-full rounded-lg border px-3 py-2.5 text-left transition-colors ${
                        active
                          ? 'border-brand-300 bg-brand-50'
                          : 'border-line bg-panel hover:border-ink-300'
                      }`}
                    >
                      <div className="truncate text-[13.5px] font-semibold text-ink-900">
                        {s.jobTitle || 'Job'}
                      </div>
                      <div className="mt-0.5 truncate text-[12px] text-ink-500">
                        {fmtWhen(s.startedAt)} · {model}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        <span className="rounded bg-paper-100 px-1.5 py-0.5 text-[10.5px] font-medium uppercase tracking-wide text-ink-600">
                          {s.platform}
                        </span>
                        <span className="rounded bg-paper-100 px-1.5 py-0.5 text-[10.5px] font-medium uppercase tracking-wide text-ink-600">
                          {s.status}
                        </span>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        <section className="min-w-0">
          {!selectedId && (
            <div className="rounded-xl border border-dashed border-line bg-panel px-5 py-10 text-center">
              <p className="text-sm text-ink-600">
                Select a capture session to inspect device, permissions, GPS trail, and motion.
              </p>
              <p className="mt-2 text-[13px] text-ink-500">
                Collected for work verification only — camera, mic, when-in-use location, motion,
                and device facts Apple allows for app functionality. No tracking / IDFA.
              </p>
            </div>
          )}

          {selectedId && detailLoading && (
            <div className="flex items-center gap-2 text-sm text-ink-500">
              <SpinnerIcon className="animate-spin" /> Opening session…
            </div>
          )}

          {selected && detail && !detailLoading && (
            <div className="space-y-5">
              <header className="rounded-xl border border-line bg-panel px-4 py-4 sm:px-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-ink-900">
                      {selected.jobTitle || 'Field capture session'}
                    </h2>
                    <p className="mt-1 text-sm text-ink-500">
                      {fmtWhen(selected.startedAt)}
                      {selected.endedAt ? ` → ${fmtWhen(selected.endedAt)}` : ' · in progress'}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {selected.proofId && (
                      <Link
                        to={`/job-progress?job=${selected.jobId}`}
                        className="rounded-lg border border-line px-3 py-1.5 text-[13px] font-medium text-ink-700 hover:bg-paper-100"
                      >
                        Open job file
                      </Link>
                    )}
                  </div>
                </div>
                <dl className="mt-4 grid gap-3 sm:grid-cols-4">
                  <div>
                    <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">
                      Platform
                    </dt>
                    <dd className="text-sm text-ink-800">{selected.platform}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">
                      App
                    </dt>
                    <dd className="text-sm text-ink-800">{selected.appVersion || '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">
                      GPS samples
                    </dt>
                    <dd className="text-sm text-ink-800">{detail.locations.length}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">
                      Motion samples
                    </dt>
                    <dd className="text-sm text-ink-800">{detail.motion.length}</dd>
                  </div>
                </dl>
              </header>

              <div className="grid gap-4">
                {CATEGORY_META.map((cat) => (
                  <section
                    key={cat.key}
                    className="rounded-xl border border-line bg-panel px-4 py-4 sm:px-5"
                  >
                    <h3 className="text-[15px] font-semibold text-ink-900">{cat.title}</h3>
                    <p className="mt-0.5 text-[13px] text-ink-500">{cat.blurb}</p>
                    <div className="mt-3">
                      <BundleTable data={detail.categories[cat.key] ?? {}} />
                    </div>
                  </section>
                ))}
              </div>

              <section className="rounded-xl border border-line bg-panel px-4 py-4 sm:px-5">
                <h3 className="text-[15px] font-semibold text-ink-900">Location trail</h3>
                <p className="mt-0.5 text-[13px] text-ink-500">
                  When-in-use GPS points collected while the day film was rolling.
                </p>
                {detail.locations.length === 0 ? (
                  <p className="mt-3 text-sm text-ink-500">No location samples in this session.</p>
                ) : (
                  <div className="mt-3 overflow-x-auto">
                    <table className="min-w-full text-left text-[13px]">
                      <thead className="text-[11px] uppercase tracking-[0.08em] text-ink-500">
                        <tr>
                          <th className="py-2 pr-3 font-semibold">When</th>
                          <th className="py-2 pr-3 font-semibold">Lat</th>
                          <th className="py-2 pr-3 font-semibold">Lon</th>
                          <th className="py-2 pr-3 font-semibold">±m</th>
                          <th className="py-2 pr-3 font-semibold">Alt</th>
                          <th className="py-2 pr-3 font-semibold">Speed</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.locations.map((p) => (
                          <tr key={p.id} className="border-t border-line/70 text-ink-800">
                            <td className="py-1.5 pr-3 whitespace-nowrap">{fmtWhen(p.recordedAt)}</td>
                            <td className="py-1.5 pr-3 font-mono">{p.lat?.toFixed(6) ?? '—'}</td>
                            <td className="py-1.5 pr-3 font-mono">{p.lon?.toFixed(6) ?? '—'}</td>
                            <td className="py-1.5 pr-3 font-mono">
                              {p.accuracyM != null ? p.accuracyM.toFixed(1) : '—'}
                            </td>
                            <td className="py-1.5 pr-3 font-mono">
                              {p.altitudeM != null ? `${p.altitudeM.toFixed(1)} m` : '—'}
                            </td>
                            <td className="py-1.5 pr-3 font-mono">
                              {p.speedMps != null ? `${p.speedMps.toFixed(1)} m/s` : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              <section className="rounded-xl border border-line bg-panel px-4 py-4 sm:px-5">
                <h3 className="text-[15px] font-semibold text-ink-900">Motion samples</h3>
                <p className="mt-0.5 text-[13px] text-ink-500">
                  Activity classification, attitude, barometer, and step count.
                </p>
                {detail.motion.length === 0 ? (
                  <p className="mt-3 text-sm text-ink-500">No motion samples in this session.</p>
                ) : (
                  <div className="mt-3 overflow-x-auto">
                    <table className="min-w-full text-left text-[13px]">
                      <thead className="text-[11px] uppercase tracking-[0.08em] text-ink-500">
                        <tr>
                          <th className="py-2 pr-3 font-semibold">When</th>
                          <th className="py-2 pr-3 font-semibold">Activity</th>
                          <th className="py-2 pr-3 font-semibold">Conf.</th>
                          <th className="py-2 pr-3 font-semibold">Pressure</th>
                          <th className="py-2 pr-3 font-semibold">Steps</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.motion.map((m) => (
                          <tr key={m.id} className="border-t border-line/70 text-ink-800">
                            <td className="py-1.5 pr-3 whitespace-nowrap">{fmtWhen(m.recordedAt)}</td>
                            <td className="py-1.5 pr-3">{m.activity || '—'}</td>
                            <td className="py-1.5 pr-3 font-mono">
                              {m.confidence != null ? m.confidence.toFixed(2) : '—'}
                            </td>
                            <td className="py-1.5 pr-3 font-mono">
                              {m.pressureHpa != null ? `${m.pressureHpa.toFixed(1)} hPa` : '—'}
                            </td>
                            <td className="py-1.5 pr-3 font-mono">{m.stepCount ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
