import { NavLink } from 'react-router-dom';

const SIZES = {
  md: { svg: 28, text: 'text-[21px]', gap: 'gap-3' },
  lg: { svg: 34, text: 'text-[23px]', gap: 'gap-3' },
} as const;

interface Props {
  className?: string;
  /** When set, the logo navigates home. Pass `null` on auth screens. */
  to?: string | null;
  size?: keyof typeof SIZES;
}

/**
 * The ONLY Atmosphere brand lockup: five bars (four ink, one orange base)
 * plus the word "Atmosphere". Same mark as the office app and the site.
 *
 * Ink follows the live theme via `text-ink-900` + `currentColor`:
 * dark on light paper, light (near-white) on a dark ground.
 */
export function Logo({ className = '', to = '/overview', size = 'md' }: Props) {
  const { svg, text, gap } = SIZES[size];
  const mark = (
    <div
      data-atmosphere-lockup=""
      className={`flex items-center ${gap} text-ink-900 ${className}`}
    >
      <svg
        width={svg}
        height={svg}
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
      <span className={`whitespace-nowrap ${text} font-bold tracking-tight text-current`}>
        Atmosphere
      </span>
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
