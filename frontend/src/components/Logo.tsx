/**
 * Atmosphere lockup: the stacked-bar mark plus the wordmark.
 *
 * The bars climb from recessive grey to full contrast, with the brand orange
 * carrying the bottom rung — the accent is the payoff of the ramp, so it is the
 * one bar that never changes colour.
 */

const BAR_HEIGHT = 2.6;
const BAR_GAP = 1.75;

/** Top-to-bottom greys for the dark UI; the brand orange closes the stack. */
const DARK_BARS = ['#4a4a4a', '#6e6e6e', '#9c9c9c', '#e4e4e4'];

export function Logo({
  className = '',
  showWordmark = true,
}: {
  className?: string;
  showWordmark?: boolean;
}) {
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <svg
        width="26"
        height="26"
        viewBox="0 0 20 20"
        fill="none"
        aria-hidden="true"
        className="shrink-0"
      >
        {DARK_BARS.map((fill, index) => (
          <rect
            key={fill}
            x="0"
            y={index * (BAR_HEIGHT + BAR_GAP)}
            width="20"
            height={BAR_HEIGHT}
            fill={fill}
          />
        ))}
        <rect
          x="0"
          y={DARK_BARS.length * (BAR_HEIGHT + BAR_GAP)}
          width="20"
          height={BAR_HEIGHT}
          fill="#f26522"
        />
      </svg>
      {showWordmark && (
        <span className="text-xl font-bold tracking-tight text-[#f5f4f1]">Atmosphere</span>
      )}
    </div>
  );
}
