/**
 * Legacy primitives, restyled for Atmosphere Analytics: hairlines, no cards,
 * no shadows, tabular numbers. New pages use components/report.tsx.
 */
export function StatTile({
  label,
  value,
  footnote,
  delta,
}: {
  label: string;
  value: string;
  footnote?: string;
  delta?: number | null;
}) {
  const deltaLabel =
    delta === null || delta === undefined
      ? null
      : `${delta > 0 ? '+' : delta < 0 ? '−' : '±'}${Math.abs(delta).toFixed(1)}%`;
  return (
    <div className="border-t border-line-strong px-0.5 py-3">
      <p className="text-[11.5px] font-semibold text-ink-700">{label}</p>
      <p className="mt-1.5 text-[22px] font-semibold leading-none tracking-tight text-ink-900 tabular-nums">{value}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-ink-500">
        {deltaLabel && (
          <span className={delta && delta < 0 ? 'text-danger-600' : 'text-success-600'}>{deltaLabel}</span>
        )}
        {footnote && <span>{footnote}</span>}
      </div>
    </div>
  );
}

export function SectionHeading({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="mb-3 mt-10 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line-strong pb-1.5 first:mt-0">
      <h2 className="text-[17px] text-ink-900">{title}</h2>
      {hint && <p className="text-[11.5px] text-ink-500">{hint}</p>}
    </div>
  );
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="border-y border-line px-2 py-8 text-center">
      <h3 className="text-[15px] text-ink-800">{title}</h3>
      <p className="mt-1 text-[13px] text-ink-500">{body}</p>
    </div>
  );
}

export function Sparkline({
  values,
  label,
}: {
  values: number[];
  label: string;
}) {
  if (values.length < 2) return null;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = Math.max(max - min, 1);
  const points = values
    .map((value, i) => {
      const x = (i / (values.length - 1)) * 320;
      const y = 72 - ((value - min) / span) * 64;
      return `${x},${y}`;
    })
    .join(' ');
  return (
    <div className="border-t border-line-strong pt-3">
      <p className="text-[11.5px] font-semibold text-ink-700">{label}</p>
      <svg viewBox="0 0 320 80" className="mt-2 h-24 w-full" role="img" aria-label={label}>
        <line x1="0" x2="320" y1="72" y2="72" className="stroke-line" strokeWidth="1" />
        <polyline
          fill="none"
          className="stroke-brand-500"
          strokeWidth="1.5"
          strokeLinejoin="round"
          points={points}
        />
      </svg>
    </div>
  );
}

export function StatusPill({ status }: { status: string }) {
  const tone =
    status === 'active' || status === 'ready' || status === 'running' || status === 'approved'
      ? 'border-success-600/40 text-success-600'
      : status === 'canceled' || status === 'not_ready' || status === 'denied'
        ? 'border-danger-600/40 text-danger-600'
        : status === 'pending'
          ? 'border-brand-500/50 text-brand-600'
          : 'border-line-strong text-ink-600';
  return (
    <span className={`inline-block whitespace-nowrap border px-1.5 py-px text-[10px] font-semibold uppercase tracking-[0.06em] ${tone}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}
