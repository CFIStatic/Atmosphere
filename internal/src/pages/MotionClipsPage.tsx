import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../lib/api';
import type { MotionClipStaffItem, MotionClipsStaffResponse, MotionTypeBucket } from '../lib/types';
import { EmptyState } from '../components/ui';
import { ErrorLine, KpiStrip, Loading, PageHeader, Section } from '../components/report';
import { DownloadButton } from '../components/DownloadButton';
import type { ExportSheet } from '../lib/excel';

/** The most proofs the staff endpoint reads in one request. */
const EXPORT_LIMIT = 200;

function formatWindow(startSec: number, endSec: number): string {
  const fmt = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${String(sec).padStart(2, '0')}`;
  };
  return `${fmt(startSec)}–${fmt(endSec)}`;
}

function clipsSheet(buckets: MotionTypeBucket[]): ExportSheet {
  const rows = buckets.flatMap((b) => b.clips.map((clip) => ({ bucket: b, clip })));
  return {
    name: 'Motion clips',
    columns: [
      { header: 'Motion' },
      { header: 'Action' },
      { header: 'Description' },
      { header: 'Start, seconds', type: 'number' },
      { header: 'End, seconds', type: 'number' },
      { header: 'Confidence', type: 'percent' },
      { header: 'Tool' },
      { header: 'Object' },
      { header: 'Material' },
      { header: 'Room' },
      { header: 'Phase' },
      { header: 'Work date', type: 'date' },
      { header: 'Source' },
      { header: 'Duration inferred' },
      { header: 'Job id' },
      { header: 'Proof id' },
      { header: 'Org id' },
    ],
    rows: rows.map(({ bucket, clip }: { bucket: MotionTypeBucket; clip: MotionClipStaffItem }) => [
      bucket.motion,
      clip.action,
      clip.description,
      clip.startSec,
      clip.endSec,
      clip.confidence * 100,
      clip.toolLabel,
      clip.objectLabel,
      clip.materialLabel,
      clip.room,
      clip.phase,
      clip.workDate,
      clip.source,
      clip.durationInferred,
      clip.jobId,
      clip.proofId,
      clip.orgId,
    ]),
  };
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

  /** Re-reads at the endpoint's maximum so the file holds every clip it will return, for the motion filter in effect. */
  async function exportSheets(): Promise<ExportSheet[]> {
    const full = await api.motionClipsStaff({ limit: EXPORT_LIMIT, ...(motion === 'all' ? {} : { motion }) });
    const picked = motion === 'all' ? full.buckets : full.buckets.filter((b) => b.motion === motion || b.action === motion);
    return [clipsSheet(picked)];
  }

  if (!data && !error) return <Loading label="Loading motion clips" />;

  return (
    <div>
      <PageHeader
        eyebrow="Product"
        title="Motion clips"
        subtitle="Robotics-ready skill corpus: narrow trade motions (screw, cut, measure, …) labelled from verified Field Capture evidence. Privacy ranges are excluded. Atmosphere never invents a motion without evidence. See docs/motion-clips.md."
      />
      {error && <ErrorLine message={error} />}

      <KpiStrip
        items={[
          { label: 'Clips', unit: 'count, latest captures', value: String(data?.totalClips ?? '—'), raw: data?.totalClips ?? null, rawType: 'integer' },
          { label: 'Motion types', unit: 'count', value: String(data?.types?.length ?? '—'), raw: data?.types?.length ?? null, rawType: 'integer' },
          {
            label: 'Showing',
            unit: motion === 'all' ? 'all motion types' : motion,
            value: String(buckets.reduce((n, b) => n + b.clips.length, 0)),
          },
        ]}
      />

      <div className="mt-5 flex flex-wrap gap-1.5" role="group" aria-label="Filter by motion">
        {[{ motion: 'all', label: 'All' }, ...(data?.types ?? []).map((t) => ({ motion: t.motion, label: `${t.motion} (${t.count})` }))].map(
          (option) => (
            <button
              key={option.motion}
              type="button"
              aria-pressed={motion === option.motion}
              className={`btn-quiet ${motion === option.motion ? 'border-ink-900 bg-ink-900 text-paper-0 hover:text-paper-0' : ''}`}
              onClick={() => setMotion(option.motion)}
            >
              {option.label}
            </button>
          ),
        )}
      </div>

      <Section
        title="By motion type"
        note="Up to 30 clips per type from the latest captures"
        actions={
          <DownloadButton table="motion-clips" label="motion clips" disabled={!data || data.totalClips === 0} sheets={exportSheets} />
        }
      >
        {data && data.totalClips === 0 && (
          <EmptyState title="No motion clips yet" body="Verified films with evidenced actions will populate this corpus." />
        )}
        <div className="space-y-8">
          {buckets.map((bucket) => (
            <article key={bucket.motion}>
              <div className="flex items-baseline gap-2 border-b border-line pb-1">
                <h3 className="text-[14.5px] font-semibold text-ink-900">{bucket.motion}</h3>
                {bucket.action && bucket.action !== bucket.motion && (
                  <span className="text-[11.5px] text-ink-500">action: {bucket.action}</span>
                )}
                <span className="ml-auto text-[12px] tabular-nums text-ink-500">{bucket.count}</span>
              </div>
              <ul className="divide-y divide-line">
                {bucket.clips.map((clip) => (
                  <li key={`${clip.proofId}-${clip.startSec}-${clip.description}`} className="py-2 text-[13px]">
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
      </Section>
    </div>
  );
}
