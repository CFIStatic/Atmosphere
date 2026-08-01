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
    <div className={`flex items-center gap-2.5 ${className}`}>
      <svg
        width="26"
        height="26"
        viewBox="0 0 22 22"
        aria-hidden="true"
        className="shrink-0 text-ink-900"
      >
        <rect width="22" height="2.8" fill="currentColor" opacity="0.3" />
        <rect y="4.8" width="22" height="2.8" fill="currentColor" opacity="0.5" />
        <rect y="9.6" width="22" height="2.8" fill="currentColor" opacity="0.68" />
        <rect y="14.4" width="22" height="2.8" fill="currentColor" opacity="0.88" />
        <rect y="19.2" width="22" height="2.8" fill="#F2670C" />
      </svg>
      {!compact && (
        <span className="text-lg font-extrabold tracking-tight text-ink-900">Atmosphere</span>
      )}
    </div>
  );
}
