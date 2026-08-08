import type { ReactNode } from 'react';
import type { TourSimulation } from '../../lib/productTour';

/** Simulated UI previews for tour steps — not live data, just orientation. */
export function TourSimulationPanel({ kind }: { kind: TourSimulation }) {
  switch (kind) {
    case 'welcome':
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <SimCard
            accent="brand"
            title="Field Capture"
            lines={['Pick job + before/after', 'Follow the shot list on site', 'Clips sync to the record']}
          />
          <SimCard
            accent="ink"
            title="Evidence Platform"
            lines={['Integrity checks on every clip', 'Scope read against footage', 'Chain of custody + share links']}
          />
        </div>
      );
    case 'verification-library':
      return (
        <div className="space-y-2 rounded-xl border border-line bg-paper-0 p-4">
          <SimRow label="1841 Cypress Bend" meta="3 clips · integrity pass" status="Verified" />
          <SimRow label="Lakeview Dental" meta="8 clips · awaiting review" status="In review" />
          <SimRow label="Meridian HVAC — RTU swap" meta="2 clips · scope gap flagged" status="Flagged" />
        </div>
      );
    case 'field-capture':
      return (
        <div className="space-y-3 rounded-xl border border-line bg-paper-0 p-4">
          <div className="flex gap-2">
            <SimPill active>Before</SimPill>
            <SimPill>After</SimPill>
          </div>
          <div className="aspect-video rounded-lg bg-paper-100 ring-2 ring-brand-400 ring-offset-2">
            <div className="flex h-full items-center justify-center text-xs text-ink-500">
              Camera viewfinder
            </div>
          </div>
          <p className="text-xs text-ink-600">
            Shot 2 of 5 · <span className="font-medium text-ink-800">Wide — affected area</span>
          </p>
        </div>
      );
    case 'job-intake':
      return (
        <div className="space-y-2 rounded-xl border border-line bg-paper-0 p-4 text-sm">
          <label className="block text-xs font-medium text-ink-500">Property / claim</label>
          <div className="rounded-lg border border-dashed border-brand-300 bg-brand-50/50 px-3 py-2 text-ink-700">
            Drop scope PDF or paste text…
          </div>
          <div className="rounded-lg bg-paper-50 px-3 py-2 text-xs text-ink-600">
            Readiness: 4 shots required before work starts
          </div>
        </div>
      );
    case 'job-files':
      return (
        <div className="space-y-2 rounded-xl border border-line bg-paper-0 p-4 text-sm">
          <SimRow label="Subcontractor link" meta="Expires in 14 days" status="Copy link" />
          <SimRow label="Scope v3" meta="Uploaded today" status="Active" />
          <SimRow label="Readiness" meta="2 of 4 shots captured" status="In progress" />
        </div>
      );
    case 'usage-meter':
      return (
        <div className="grid gap-2 sm:grid-cols-3">
          <MetricTile label="Processed jobs" value="12" sub="50 included / period" />
          <MetricTile label="Platform fee" value="$599" sub="Monthly" />
          <MetricTile label="Est. overage" value="$0" sub="0 excess jobs" />
        </div>
      );
    default:
      return null;
  }
}

function SimCard({
  accent,
  title,
  lines,
}: {
  accent: 'brand' | 'ink';
  title: string;
  lines: string[];
}) {
  return (
    <div
      className={`rounded-xl border p-4 ${
        accent === 'brand' ? 'border-brand-200 bg-brand-50/60' : 'border-line bg-paper-0'
      }`}
    >
      <p className="font-semibold text-ink-900">{title}</p>
      <ul className="mt-2 space-y-1 text-sm text-ink-600">
        {lines.map((line) => (
          <li key={line} className="flex gap-2">
            <span className="text-brand-600">→</span>
            <span>{line}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SimRow({
  label,
  meta,
  status,
}: {
  label: string;
  meta: string;
  status: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-paper-50 px-3 py-2 text-sm">
      <div>
        <p className="font-medium text-ink-900">{label}</p>
        <p className="text-xs text-ink-500">{meta}</p>
      </div>
      <span className="shrink-0 rounded-full bg-paper-100 px-2 py-0.5 text-[11px] font-semibold text-ink-600">
        {status}
      </span>
    </div>
  );
}

function SimPill({ children, active }: { children: ReactNode; active?: boolean }) {
  return (
    <span
      className={`inline-flex rounded-lg px-3 py-1.5 text-sm font-medium ${
        active ? 'bg-brand-500 text-ink-900' : 'bg-paper-100 text-ink-600'
      }`}
    >
      {children}
    </span>
  );
}

function MetricTile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl border border-line bg-paper-0 px-3 py-3 text-center">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-500">{label}</p>
      <p className="mt-1 text-xl font-bold text-ink-900">{value}</p>
      <p className="mt-0.5 text-xs text-ink-500">{sub}</p>
    </div>
  );
}
