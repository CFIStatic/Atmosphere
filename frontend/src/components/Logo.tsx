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
      <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true" className="shrink-0">
        <rect className="fill-current opacity-30" width="22" height="2.8" />
        <rect className="fill-current opacity-50" y="4.8" width="22" height="2.8" />
        <rect className="fill-current opacity-[0.68]" y="9.6" width="22" height="2.8" />
        <rect className="fill-current opacity-[0.88]" y="14.4" width="22" height="2.8" />
        <rect className="fill-brand-500" y="19.2" width="22" height="2.8" />
      </svg>
      {!compact && (
        <span className="text-lg font-bold tracking-tight">Atmosphere</span>
      )}
    </div>
  );
}
