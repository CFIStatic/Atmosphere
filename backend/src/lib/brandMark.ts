/**
 * Atmosphere brand lockup for HTML mail.
 *
 * Emails stay on paper, so the mark is always the dark-ink bars + terracotta
 * base used on light surfaces. In-app lockups invert with the theme instead.
 */

export const ATMOSPHERE_INK = '#1C1917';
export const ATMOSPHERE_ACCENT_BAR = '#F2670C';

/** Four ink bars + terracotta base — the only Atmosphere mark. */
export const ATMOSPHERE_MARK_BARS = [
  '#A8A29E',
  '#78716C',
  '#57534E',
  '#292524',
  ATMOSPHERE_ACCENT_BAR,
] as const;

/**
 * Email lockup = the exact atmosphereteam.com header lockup (28px bar mark,
 * 12px gap, 21px Inter Bold "Atmosphere", baseline on the orange bar),
 * rendered from the live site at 3x into hosted PNGs (mail clients drop SVG).
 * Light = ink #1C1917 bars/word for paper; dark = #F1EFEB for dark grounds.
 */
export const ATMOSPHERE_EMAIL_LOGO_LIGHT_URL =
  'https://atmosphereteam.com/assets/email/atmosphere-lockup-light-3x.png';
export const ATMOSPHERE_EMAIL_LOGO_DARK_URL =
  'https://atmosphereteam.com/assets/email/atmosphere-lockup-dark-3x.png';
/** Display size in CSS px (PNG is 3x: 486x96). */
export const ATMOSPHERE_EMAIL_LOGO_WIDTH = 162;
export const ATMOSPHERE_EMAIL_LOGO_HEIGHT = 32;

/**
 * Put in <head>. Our paper emails declare color-scheme: light, so Apple Mail
 * keeps them light and the ink lockup stays correct. Outlook.com / Outlook
 * apps force-darken the background and tag it [data-ogsc]; there we swap to
 * the light-ink (#F1EFEB) lockup, exactly as the site does in dark mode.
 */
export const ATMOSPHERE_EMAIL_LOGO_STYLE = `<style>
  .atm-logo-dark { display:none; max-height:0; overflow:hidden; mso-hide:all; }
  [data-ogsc] .atm-logo-light { display:none !important; }
  [data-ogsc] .atm-logo-dark { display:block !important; max-height:none !important; }
</style>`;

function logoImg(src: string, cls: string, extra = ''): string {
  return `<img class="${cls}" src="${src}" width="${ATMOSPHERE_EMAIL_LOGO_WIDTH}" height="${ATMOSPHERE_EMAIL_LOGO_HEIGHT}" alt="Atmosphere" style="display:block;width:${ATMOSPHERE_EMAIL_LOGO_WIDTH}px;height:${ATMOSPHERE_EMAIL_LOGO_HEIGHT}px;border:0;outline:none;text-decoration:none;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:21px;font-weight:700;letter-spacing:-0.025em;color:${ATMOSPHERE_INK};${extra}" />`;
}

/**
 * Shared header lockup for every Atmosphere email. `ground: 'dark'` is for
 * headers that sit on a dark band in both modes (demo booking mail).
 */
export function atmosphereWordmarkHtml(options?: { ground?: 'paper' | 'dark' }): string {
  // No link wrapper: code / reset mail must carry exactly one action.
  const link = (inner: string) => inner;
  if (options?.ground === 'dark') {
    return link(logoImg(ATMOSPHERE_EMAIL_LOGO_DARK_URL, 'atm-logo', 'color:#F1EFEB;'));
  }
  return link(
    logoImg(ATMOSPHERE_EMAIL_LOGO_LIGHT_URL, 'atm-logo-light') +
      `<!--[if !mso]><!-->${logoImg(ATMOSPHERE_EMAIL_LOGO_DARK_URL, 'atm-logo-dark', 'display:none;max-height:0;overflow:hidden;color:#F1EFEB;')}<!--<![endif]-->`,
  );
}
