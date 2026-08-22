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
      : `${delta > 0 ? '+' : ''}${delta.toFixed(1)}%`;
  return (
    <div className="rounded-xl border border-line bg-paper-0 px-4 py-4 shadow-sm">
      <p className="text-[11px] uppercase tracking-[0.14em] text-ink-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-ink-900">{value}</p>
      <div className="mt-1 flex items-center gap-2 text-xs text-ink-500">
        {deltaLabel && (
          <span className={delta && delta < 0 ? 'text-danger-600' : 'text-success-600'}>
            {deltaLabel}
          </span>
        )}
        {footnote && <span>{footnote}</span>}
      </div>
    </div>
  );
}

export function SectionHeading({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="mb-4 mt-10 flex items-end justify-between gap-4 first:mt-0">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      {hint && <p className="text-xs text-ink-500">{hint}</p>}
    </div>
  );
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-dashed border-line-strong px-6 py-10 text-center">
      <h3 className="font-medium">{title}</h3>
      <p className="mt-1 text-sm text-ink-500">{body}</p>
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
    <div className="rounded-xl border border-line bg-paper-0 p-4">
      <p className="text-[11px] uppercase tracking-[0.14em] text-ink-500">{label}</p>
      <svg viewBox="0 0 320 80" className="mt-3 h-24 w-full" role="img" aria-label={label}>
        <polyline
          fill="none"
          stroke="rgb(232 89 12)"
          strokeWidth="2.5"
          strokeLinejoin="round"
          strokeLinecap="round"
          points={points}
        />
      </svg>
    </div>
  );
}

export function StatusPill({ status }: { status: string }) {
  const tone =
    status === 'active' || status === 'ready' || status === 'running' || status === 'approved'
      ? 'border-success-600/30 text-success-600'
      : status === 'canceled' || status === 'not_ready' || status === 'denied'
        ? 'border-danger-600/30 text-danger-600'
        : status === 'pending'
          ? 'border-brand-600/30 text-brand-600'
          : 'border-line-strong text-ink-500';
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide ${tone}`}>
      {status}
    </span>
  );
}
