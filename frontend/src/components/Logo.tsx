/** Commandx wordmark + glyph. The ">_" glyph nods to a command prompt. */
export function Logo({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <span className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-brand-400 to-brand-700 shadow-lg shadow-brand-900/40">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M4 6l5 6-5 6"
            stroke="white"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path d="M12 18h8" stroke="white" strokeWidth="2.4" strokeLinecap="round" />
        </svg>
      </span>
      <span className="text-xl font-extrabold tracking-tight text-white">
        Command<span className="text-brand-400">x</span>
      </span>
    </div>
  );
}
