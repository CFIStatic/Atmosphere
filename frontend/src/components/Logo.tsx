interface Props {
  className?: string;
  /** Glyph only — for narrow bars where the wordmark would crowd the row. */
  compact?: boolean;
}

/** Atmosphere wordmark + glyph (a sphere ringed by its atmosphere). */
export function Logo({ className = '', compact = false }: Props) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
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
        <span className="text-lg font-extrabold tracking-tight text-ink-900">
          Atmo<span className="text-brand-500">sphere</span>
        </span>
      )}
    </div>
  );
}
