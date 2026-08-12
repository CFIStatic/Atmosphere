import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  api,
  type FieldContextSessionDetail,
  type FieldContextSessionSummary,
} from '../lib/api';
import { Logo } from '../components/Logo';
import { SpinnerIcon } from '../components/icons';
import { useFeatureTimer } from '../hooks/useFeatureTimer';
import { useAuth } from '../context/AuthContext';

/**
 * Atmosphere-internal Field Capture context.
 *
 * Device / GPS / motion bundles are recorded in the backend from the field app
 * and shown only here — never on customer Verification / job-file surfaces.
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
    return <span className="text-gray-500">—</span>;
  }
  if (typeof value === 'boolean') {
    return <span>{value ? 'Yes' : 'No'}</span>;
  }
  if (typeof value === 'number') {
    return <span className="font-mono text-[13px]">{value}</span>;
  }
  if (Array.isArray(value)) {
    if (!value.length) return <span className="text-gray-500">None</span>;
    return (
      <ul className="space-y-1 text-[13px]">
        {value.slice(0, 12).map((item, i) => (
          <li key={i} className="rounded bg-white/5 px-2 py-1 text-gray-300">
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
    return <span className="font-mono text-[12px] text-gray-400">{JSON.stringify(value)}</span>;
  }
  return <span className="break-all">{String(value)}</span>;
}

function BundleTable({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data).filter(([, v]) => v !== undefined);
  if (!entries.length) {
    return <p className="text-sm text-gray-500">Nothing recorded in this category yet.</p>;
  }
  return (
    <dl className="grid gap-3 sm:grid-cols-2">
      {entries.map(([key, value]) => (
        <div key={key} className="min-w-0">
          <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-500">
            {humanKey(key)}
          </dt>
          <dd className="mt-0.5 text-sm text-gray-200">
            {key.toLowerCase().includes('bytes') ? fmtBytes(value) : <ValueCell value={value} />}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function FieldContextPage() {
  useFeatureTimer('field_context');
  const { logout } = useAuth();
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('session');
  const jobFilter = params.get('job') ?? undefined;
  const orgFilter = params.get('org') ?? undefined;

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
      .fieldContextSessions({ orgId: orgFilter, jobId: jobFilter, limit: 100 })
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
  }, [jobFilter, orgFilter]);

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
    <div className="cx-aurora min-h-screen bg-ink-900 text-gray-100">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-6 py-4 sm:px-10">
        <div className="flex items-center gap-4">
          <Logo className="text-white" />
          <span className="hidden rounded-full border border-white/10 bg-ink-700/60 px-2.5 py-0.5 text-xs font-medium text-gray-400 sm:inline">
            Internal only
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/analytics"
            className="rounded-lg border border-white/10 px-3 py-2 text-sm text-gray-300 transition hover:bg-white/5"
          >
            Product analytics
          </Link>
          <Link
            to="/dashboard"
            className="rounded-lg border border-white/10 px-3 py-2 text-sm text-gray-300 transition hover:bg-white/5"
          >
            Back to app
          </Link>
          <button
            type="button"
            onClick={() => void logout()}
            className="rounded-lg border border-white/10 bg-ink-700/70 px-3 py-2 text-sm text-gray-200 transition hover:bg-ink-600"
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8 sm:px-10">
        <div className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">Field context</h1>
          <p className="mt-1.5 max-w-2xl text-sm text-gray-400">
            Apple-allowed signals recorded from Field Capture into our backend. Atmosphere staff
            only — never shown on customer Verification or job files.
          </p>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
            {error}
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
          <aside className="min-w-0">
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.09em] text-gray-500">
                Capture sessions
              </h2>
              {(jobFilter || orgFilter) && (
                <Link
                  to="/analytics/field-context"
                  className="text-[12px] font-medium text-brand-400 hover:underline"
                >
                  Clear filters
                </Link>
              )}
            </div>

            {loading ? (
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <SpinnerIcon className="animate-spin" /> Loading…
              </div>
            ) : sessions.length === 0 ? (
              <p className="text-sm text-gray-500">
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
                            ? 'border-brand-500/40 bg-brand-500/10'
                            : 'border-white/10 bg-ink-800/60 hover:border-white/20'
                        }`}
                      >
                        <div className="truncate text-[13.5px] font-semibold text-white">
                          {s.jobTitle || 'Job'}
                        </div>
                        <div className="mt-0.5 truncate text-[12px] text-gray-500">
                          {s.orgName ? `${s.orgName} · ` : ''}
                          {fmtWhen(s.startedAt)} · {model}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10.5px] font-medium uppercase tracking-wide text-gray-400">
                            {s.platform}
                          </span>
                          <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10.5px] font-medium uppercase tracking-wide text-gray-400">
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
              <div className="rounded-xl border border-dashed border-white/10 bg-ink-800/40 px-5 py-10 text-center">
                <p className="text-sm text-gray-300">
                  Select a capture session to inspect device, permissions, GPS trail, and motion.
                </p>
                <p className="mt-2 text-[13px] text-gray-500">
                  Internal telemetry for work verification integrity — not a customer-facing record.
                </p>
              </div>
            )}

            {selectedId && detailLoading && (
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <SpinnerIcon className="animate-spin" /> Opening session…
              </div>
            )}

            {selected && detail && !detailLoading && (
              <div className="space-y-5">
                <header className="rounded-xl border border-white/10 bg-ink-800/60 px-4 py-4 sm:px-5">
                  <div>
                    <h2 className="text-lg font-semibold text-white">
                      {selected.jobTitle || 'Field capture session'}
                    </h2>
                    <p className="mt-1 text-sm text-gray-500">
                      {selected.orgName ? `${selected.orgName} · ` : ''}
                      {fmtWhen(selected.startedAt)}
                      {selected.endedAt ? ` → ${fmtWhen(selected.endedAt)}` : ' · in progress'}
                    </p>
                  </div>
                  <dl className="mt-4 grid gap-3 sm:grid-cols-4">
                    <div>
                      <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-500">
                        Platform
                      </dt>
                      <dd className="text-sm text-gray-200">{selected.platform}</dd>
                    </div>
                    <div>
                      <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-500">
                        App
                      </dt>
                      <dd className="text-sm text-gray-200">{selected.appVersion || '—'}</dd>
                    </div>
                    <div>
                      <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-500">
                        GPS samples
                      </dt>
                      <dd className="text-sm text-gray-200">{detail.locations.length}</dd>
                    </div>
                    <div>
                      <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-500">
                        Motion samples
                      </dt>
                      <dd className="text-sm text-gray-200">{detail.motion.length}</dd>
                    </div>
                  </dl>
                </header>

                <div className="grid gap-4">
                  {CATEGORY_META.map((cat) => (
                    <section
                      key={cat.key}
                      className="rounded-xl border border-white/10 bg-ink-800/60 px-4 py-4 sm:px-5"
                    >
                      <h3 className="text-[15px] font-semibold text-white">{cat.title}</h3>
                      <p className="mt-0.5 text-[13px] text-gray-500">{cat.blurb}</p>
                      <div className="mt-3">
                        <BundleTable data={detail.categories[cat.key] ?? {}} />
                      </div>
                    </section>
                  ))}
                </div>

                <section className="rounded-xl border border-white/10 bg-ink-800/60 px-4 py-4 sm:px-5">
                  <h3 className="text-[15px] font-semibold text-white">Location trail</h3>
                  <p className="mt-0.5 text-[13px] text-gray-500">
                    When-in-use GPS points collected while the day film was rolling.
                  </p>
                  {detail.locations.length === 0 ? (
                    <p className="mt-3 text-sm text-gray-500">No location samples in this session.</p>
                  ) : (
                    <div className="mt-3 overflow-x-auto">
                      <table className="min-w-full text-left text-[13px]">
                        <thead className="text-[11px] uppercase tracking-[0.08em] text-gray-500">
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
                            <tr key={p.id} className="border-t border-white/10 text-gray-200">
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

                <section className="rounded-xl border border-white/10 bg-ink-800/60 px-4 py-4 sm:px-5">
                  <h3 className="text-[15px] font-semibold text-white">Motion samples</h3>
                  <p className="mt-0.5 text-[13px] text-gray-500">
                    Activity classification, attitude, barometer, and step count.
                  </p>
                  {detail.motion.length === 0 ? (
                    <p className="mt-3 text-sm text-gray-500">No motion samples in this session.</p>
                  ) : (
                    <div className="mt-3 overflow-x-auto">
                      <table className="min-w-full text-left text-[13px]">
                        <thead className="text-[11px] uppercase tracking-[0.08em] text-gray-500">
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
                            <tr key={m.id} className="border-t border-white/10 text-gray-200">
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
      </main>
    </div>
  );
}
