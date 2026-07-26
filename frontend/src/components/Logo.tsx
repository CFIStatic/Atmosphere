/**
 * Atmosphere lockup: the stacked-bar mark beside the wordmark.
 *
 * The wordmark is a single colour that follows the theme — white on the dark
 * ground, black on the light one — never a two-tone split. The orange appears
 * once, on the bottom bar of the mark, which is what makes it read as an accent
 * rather than as decoration.
 */
export function Logo({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <span className="grid shrink-0 place-items-center" aria-hidden="true">
        <svg width="26" height="26" viewBox="0 0 26 26" fill="none">
          {/* Four greys stepping toward the foreground, then the accent. */}
          <rect x="3" y="4" width="20" height="2.6" rx="0.6" className="fill-fg-4" />
          <rect x="3" y="8.2" width="20" height="2.6" rx="0.6" className="fill-fg-3" />
          <rect x="3" y="12.4" width="20" height="2.6" rx="0.6" className="fill-fg-2" />
          <rect x="3" y="16.6" width="20" height="2.6" rx="0.6" className="fill-fg" />
          <rect x="3" y="20.8" width="20" height="2.6" rx="0.6" className="fill-brand-500" />
        </svg>
      </span>
      <span className="text-xl font-extrabold tracking-tight text-fg">Atmosphere</span>
    </div>
  );
}
