import { TOKEN_FEATURE_LABELS, TOKEN_FEATURES, type TokenFeature, type TokenUsageDay } from '../../lib/api';
import { formatTokens } from '../../lib/money';
import {
  TOKEN_FEATURE_COLOR,
  activeFeatures,
  compactDayLabel,
  featureTokens,
  peakDayTokens,
} from './tokenUsageModel';

const HEIGHT = 196;
const PAD = { top: 12, right: 8, bottom: 28, left: 8 };

export function TokenUsageChart({ days }: { days: TokenUsageDay[] }) {
  const width = 720;
  const peak = peakDayTokens(days);
  const features = activeFeatures(days);
  const series = features.length ? features : [...TOKEN_FEATURES];
  const plotWidth = width - PAD.left - PAD.right;
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;
  const slot = days.length > 0 ? plotWidth / days.length : plotWidth;
  const gap = days.length > 45 ? 1 : days.length > 20 ? 3 : 5;
  const barWidth = Math.max(2, slot - gap);

  if (days.length === 0) {
    return (
      <p className="rounded-lg border border-line px-4 py-8 text-center text-sm text-ink-600">
        No token usage in this window yet.
      </p>
    );
  }

  return (
    <div>
      <svg
        role="img"
        aria-label="Token usage by day, stacked by video analysis, chat, and Ask"
        viewBox={`0 0 ${width} ${HEIGHT}`}
        className="h-48 w-full"
      >
        {[0.25, 0.5, 0.75, 1].map((tick) => {
          const y = PAD.top + plotHeight * (1 - tick);
          return (
            <line
              key={tick}
              x1={PAD.left}
              x2={width - PAD.right}
              y1={y}
              y2={y}
              stroke="rgb(var(--line))"
              strokeWidth={1}
            />
          );
        })}
        {days.map((day, index) => {
          let stacked = 0;
          const x = PAD.left + index * slot + (slot - barWidth) / 2;
          return (
            <g key={day.day}>
              {series.map((feature) => {
                const tokens = featureTokens(day, feature);
                const h = (tokens / peak) * plotHeight;
                const y = PAD.top + plotHeight - stacked - h;
                stacked += h;
                if (h <= 0) return null;
                return (
                  <rect
                    key={feature}
                    x={x}
                    y={y}
                    width={barWidth}
                    height={Math.max(h, 1)}
                    fill={TOKEN_FEATURE_COLOR[feature]}
                    rx={Math.min(2, barWidth / 3)}
                  >
                    <title>
                      {compactDayLabel(day.day)} · {TOKEN_FEATURE_LABELS[feature]} · {formatTokens(tokens)} tokens
                    </title>
                  </rect>
                );
              })}
            </g>
          );
        })}
        {labelIndexes(days.length).map((index) => (
          <text
            key={days[index]!.day}
            x={PAD.left + index * slot + slot / 2}
            y={HEIGHT - 8}
            textAnchor="middle"
            fill="rgb(var(--ink-500))"
            fontSize={11}
          >
            {compactDayLabel(days[index]!.day)}
          </text>
        ))}
      </svg>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-600">
        {series.map((feature) => (
          <li key={feature} className="flex items-center gap-1.5">
            <span
              className="inline-block h-2 w-2 rounded-sm"
              style={{ background: TOKEN_FEATURE_COLOR[feature] }}
            />
            {TOKEN_FEATURE_LABELS[feature as TokenFeature]}
          </li>
        ))}
        <li className="ml-auto tabular-nums text-ink-500">Peak day {formatTokens(peak)}</li>
      </ul>
    </div>
  );
}

function labelIndexes(count: number): number[] {
  if (count <= 10) return Array.from({ length: count }, (_, i) => i);
  const step = count <= 16 ? 2 : count <= 32 ? 4 : 7;
  const indexes = [0];
  for (let i = step; i < count - 1; i += step) indexes.push(i);
  if (indexes[indexes.length - 1] !== count - 1) indexes.push(count - 1);
  return indexes;
}
