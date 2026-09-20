import { NavLink } from 'react-router-dom';
import { DASHBOARD_HOME } from '../lib/platforms';

const SIZES = {
  md: { svg: 28, text: 'text-[21px]', gap: 'gap-3', wordNudge: 'translate-y-[4px]' },
  /** Full-width auth headers — login, signup, password reset. */
  lg: { svg: 34, text: 'text-[23px]', gap: 'gap-3', wordNudge: 'translate-y-[5px]' },
} as const;

interface Props {
  className?: string;
  /** Mark only — for narrow bars where the wordmark would crowd the row. */
  compact?: boolean;
  /** When set, the logo navigates home. Defaults to the Work Verification dashboard. */
  to?: string | null;
  /** `lg` fills the top-left corner on login and other sparse headers. */
  size?: keyof typeof SIZES;
}

/**
 * The ONLY Atmosphere brand lockup: five bars (four ink, one orange base)
 * plus the word "Atmosphere".
 *
 * Permanently retired — do not restore:
 * - Saturn / planet circle + ring ellipse
 * - Orange rounded square tile behind a white glyph
 * - Split "Atmo" + orange "sphere" wordmark
 *
 * Ink follows the live theme via `text-ink-900` + `currentColor`:
 * dark bars and word on light paper, light (near-white) bars and word on a
 * dark ground. The terracotta base stays brand-colored in both palettes.
 * Match the marketing site wordmark in website/assets/site.css (.lb1–.lb4, .lb-a).
 *
 * Vertical alignment: wordmark baseline sits on the orange bar's bottom edge
 * (`items-end` + `leading-none`). Small downward nudge so the A baseline
 * meets the orange bar bottom. Extra nudge offsets the descender on "p"
 * so the A baseline — not the line-box bottom — hits the bar (md +4px, lg +5px).
 */
export function Logo({
  className = '',
  compact = false,
  to = DASHBOARD_HOME,
  size = 'md',
}: Props) {
  const { svg, text, gap, wordNudge } = SIZES[size];
  const mark = (
    <div
      data-atmosphere-lockup=""
      className={`flex items-end ${gap} text-ink-900 ${className}`}
    >
      <AtmosphereBars size={svg} />
      {!compact && (
        <span
          className={`whitespace-nowrap ${text} font-bold tracking-tight leading-none text-current ${wordNudge}`}
        >
          Atmosphere
        </span>
      )}
    </div>
  );

  if (!to) return mark;

  return (
    <NavLink
      to={to}
      aria-label="Atmosphere home"
      className="inline-flex rounded-lg transition hover:opacity-90"
    >
      {mark}
    </NavLink>
  );
}

/** Five-bar mark. Ink bars inherit `currentColor`; the base stays terracotta. */
export function AtmosphereBars({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 22 22"
      aria-hidden="true"
      className="shrink-0 text-current"
    >
      <rect className="fill-current opacity-30" width="22" height="2.8" />
      <rect className="fill-current opacity-50" y="4.8" width="22" height="2.8" />
      <rect className="fill-current opacity-[0.68]" y="9.6" width="22" height="2.8" />
      <rect className="fill-current opacity-[0.88]" y="14.4" width="22" height="2.8" />
      <rect className="fill-brand-500" y="19.2" width="22" height="2.8" />
    </svg>
  );
}
