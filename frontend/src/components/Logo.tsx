import { NavLink } from 'react-router-dom';
import { DASHBOARD_HOME } from '../lib/platforms';

const SIZES = {
  md: { svg: 28, text: 'text-[21px]', gap: 'gap-3' },
  /** Full-width auth headers — login, signup, password reset. */
  lg: { svg: 40, text: 'text-[26px]', gap: 'gap-3.5' },
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
 * The ONLY Atmosphere brand mark: five bars (four ink, one orange base).
 *
 * Permanently retired — do not restore:
 * - Saturn / planet circle + ring ellipse
 * - Orange rounded square tile behind a white glyph
 * - Split "Atmo" + orange "sphere" wordmark
 *
 * Match the marketing site wordmark in website/assets/site.css (.lb1–.lb4, .lb-a).
 */
export function Logo({
  className = '',
  compact = false,
  to = DASHBOARD_HOME,
  size = 'md',
}: Props) {
  const { svg, text, gap } = SIZES[size];
  const mark = (
    <div className={`flex items-center ${gap} text-ink-900 ${className}`}>
      <svg width={svg} height={svg} viewBox="0 0 22 22" aria-hidden="true" className="shrink-0">
        <rect className="fill-current opacity-30" width="22" height="2.8" />
        <rect className="fill-current opacity-50" y="4.8" width="22" height="2.8" />
        <rect className="fill-current opacity-[0.68]" y="9.6" width="22" height="2.8" />
        <rect className="fill-current opacity-[0.88]" y="14.4" width="22" height="2.8" />
        <rect className="fill-brand-500" y="19.2" width="22" height="2.8" />
      </svg>
      {!compact && (
        <span className={`whitespace-nowrap ${text} font-bold tracking-tight`}>Atmosphere</span>
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
