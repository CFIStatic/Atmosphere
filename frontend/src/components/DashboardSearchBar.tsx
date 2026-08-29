/**
 * The Dashboard search field — same size, placeholder, and icon placement
 * as the verifier top bar. Job Files mounts this in the office chrome so
 * the two screens share one search control.
 */
export function DashboardSearchBar({
  value,
  onChange,
  className,
  'aria-label': ariaLabel = 'Search videos',
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  'aria-label'?: string;
}) {
  return (
    <div className={`relative min-w-0 flex-1 md:max-w-[520px] ${className ?? ''}`}>
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        aria-hidden="true"
        className="pointer-events-none absolute left-[9px] top-[10px] text-ink-500"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search by job, company, date, address, ID, or hash"
        aria-label={ariaLabel}
        className="h-[34px] w-full rounded-lg border border-line bg-paper-100 pl-[30px] pr-2.5 text-[13px] text-ink-900 outline-none placeholder:text-ink-500 focus:border-brand-600 focus:shadow-[0_0_0_3px_rgb(var(--brand-200))]"
      />
    </div>
  );
}
