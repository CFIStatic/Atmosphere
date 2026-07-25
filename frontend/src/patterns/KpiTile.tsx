import { TrendingDown, TrendingUp } from 'lucide-react';
import { cn } from '../design';
import { percent } from '../domain/format';
import type { MetricTile } from '../domain/types';

/**
 * A single headline number.
 *
 * The delta is coloured by whether the movement is *good*, not by its sign —
 * receivables climbing 22% is red even though the arrow points up. Getting this
 * backwards is the classic dashboard failure, and on a finance-adjacent screen
 * it actively misleads.
 */
export function KpiTile({ metric, className }: { metric: MetricTile; className?: string }) {
  const { deltaPct, higherIsBetter } = metric;
  const rising = (deltaPct ?? 0) > 0;
  const good = deltaPct === null ? null : rising === higherIsBetter;
  const Icon = rising ? TrendingUp : TrendingDown;

  return (
    <div
      className={cn(
        'rounded-xl border border-white/10 bg-ink-800/60 p-3.5 backdrop-blur transition hover:border-white/20',
        className,
      )}
    >
      {/* Wraps rather than truncates: "Receivables > 30d" clipped to
          "Receivables > 3…" leaves the number meaningless. */}
      <p className="min-h-[2rem] text-2xs font-medium uppercase leading-tight tracking-wide text-gray-500">
        {metric.label}
      </p>
      <div className="mt-1.5 flex items-baseline gap-2">
        <p className="text-2xl font-semibold tracking-tight text-white">{metric.value}</p>
        {deltaPct !== null && (
          <span
            className={cn(
              'flex items-center gap-0.5 text-2xs font-medium',
              good === null && 'text-gray-500',
              good === true && 'text-state-ok',
              good === false && 'text-state-danger',
            )}
          >
            <Icon className="h-3 w-3" />
            {percent(Math.abs(deltaPct), 1)}
          </span>
        )}
      </div>
      {metric.hint && <p className="mt-1 truncate text-2xs text-gray-600">{metric.hint}</p>}
    </div>
  );
}
