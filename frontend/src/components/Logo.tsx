interface Props {
  className?: string;
  /** Mark only — for narrow bars where the wordmark would crowd the row. */
  compact?: boolean;
}

/**
 * The official Atmosphere mark: five bars settling from faint to solid onto
 * an orange base — the atmosphere over the ground. The greys ride the ink
 * token so the mark reads correctly on both themes; the base is always the
 * brand orange.
 */
export function Logo({ className = '', compact = false }: Props) {
  return (
    <div className={`flex items-center gap-2.5 text-ink-900 ${className}`}>
      <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-500 shadow-card">
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="5" fill="white" fillOpacity="0.95" />
          <ellipse
            cx="12"
            cy="12"
            rx="10"
            ry="3.6"
            stroke="white"
            strokeWidth="1.6"
            transform="rotate(-25 12 12)"
          />
        </svg>
      </span>
      {!compact && (
        <span className="text-lg font-extrabold tracking-tight">
          Atmo<span className="text-brand-500">sphere</span>
        </span>
      )}
    </div>
  );
}
