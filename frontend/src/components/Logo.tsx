/**
 * Atmosphere lockup: the stacked-bar mark beside the wordmark.
 *
 * The bars are one colour at four opacities rather than four separate greys.
 * That single definition reproduces both brand marks exactly — on the dark
 * ground the ramp climbs from faint charcoal to near-white, and on the light
 * ground from pale grey to near-black — because the foreground token already
 * flips with the theme.
 *
 * The wordmark is likewise a single colour that follows the theme, never a
 * two-tone split. Orange appears once, on the bottom bar.
 */
export function Logo({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <span className="grid shrink-0 place-items-center" aria-hidden="true">
        <svg width="26" height="26" viewBox="0 0 26 26" fill="none">
          {[0.28, 0.48, 0.72, 1].map((opacity, i) => (
            <rect
              key={opacity}
              x="3"
              y={4 + i * 4.2}
              width="20"
              height="2.6"
              rx="0.6"
              className="fill-fg"
              fillOpacity={opacity}
            />
          ))}
          <rect x="3" y="20.8" width="20" height="2.6" rx="0.6" className="fill-brand-500" />
        </svg>
      </span>
      <span className="text-xl font-extrabold tracking-tight text-fg">Atmosphere</span>
    </div>
  );
}
