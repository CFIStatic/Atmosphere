/** Atmosphere wordmark + glyph (a sphere ringed by its atmosphere). */
export function Logo({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <span className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-brand-400 to-brand-700 shadow-lg shadow-brand-900/40">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="5" fill="white" fillOpacity="0.95" />
          <ellipse
            cx="12"
            cy="12"
            rx="10"
            ry="3.6"
            stroke="white"
            strokeWidth="1.5"
            transform="rotate(-25 12 12)"
          />
        </svg>
      </span>
      <span className="text-xl font-extrabold tracking-tight text-white">
        Atmo<span className="text-brand-400">sphere</span>
      </span>
    </div>
  );
}
