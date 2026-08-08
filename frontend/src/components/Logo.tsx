interface Props {
  className?: string;
  /** Mark only — for narrow bars where the wordmark would crowd the row. */
  compact?: boolean;
}

/**
 * The ONLY Atmosphere brand mark: five bars (four ink, one orange base).
 *
 * Permanently retired — do not restore:
 * - Saturn / planet circle + ring ellipse
 * - Orange rounded square tile behind a white glyph
 * - Split "Atmo" + orange "sphere" wordmark
 *
 * Match the marketing site wordmark in website/assets/site.css (.lb1–.lb4, .lb-a).
 */
export function Logo({ className = '', compact = false }: Props) {
  return (
    <div className={`flex items-center gap-2.5 text-ink-900 ${className}`}>
      <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true" className="shrink-0">
        <rect className="fill-current opacity-30" width="22" height="2.8" />
        <rect className="fill-current opacity-50" y="4.8" width="22" height="2.8" />
        <rect className="fill-current opacity-[0.68]" y="9.6" width="22" height="2.8" />
        <rect className="fill-current opacity-[0.88]" y="14.4" width="22" height="2.8" />
        <rect className="fill-brand-500" y="19.2" width="22" height="2.8" />
      </svg>
      {!compact && <span className="text-lg font-bold tracking-tight">Atmosphere</span>}
    </div>
  );
}
