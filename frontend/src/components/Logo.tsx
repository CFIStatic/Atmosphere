import { NavLink } from 'react-router-dom';
import { DASHBOARD_HOME } from '../lib/platforms';

interface Props {
  className?: string;
  /** Mark only — for narrow bars where the wordmark would crowd the row. */
  compact?: boolean;
  /** When set, the logo navigates home. Defaults to the Work Verification dashboard. */
  to?: string | null;
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
export function Logo({ className = '', compact = false, to = DASHBOARD_HOME }: Props) {
  const mark = (
    <div className={`flex items-center gap-3 text-ink-900 ${className}`}>
      <svg width="32" height="32" viewBox="0 0 22 22" aria-hidden="true" className="shrink-0">
        <rect className="fill-current opacity-30" width="22" height="2.8" />
        <rect className="fill-current opacity-50" y="4.8" width="22" height="2.8" />
        <rect className="fill-current opacity-[0.68]" y="9.6" width="22" height="2.8" />
        <rect className="fill-current opacity-[0.88]" y="14.4" width="22" height="2.8" />
        <rect className="fill-brand-500" y="19.2" width="22" height="2.8" />
      </svg>
      {!compact && <span className="text-[22px] font-extrabold tracking-tight">Atmosphere</span>}
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
