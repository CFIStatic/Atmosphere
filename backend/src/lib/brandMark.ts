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

export function atmosphereWordmarkHtml(options?: { wordSize?: number }): string {
  const wordSize = options?.wordSize ?? 18;
  const bars = ATMOSPHERE_MARK_BARS.map((color, i) => {
    const gap =
      i === 0
        ? ''
        : `<tr><td height="2" style="height:2px;line-height:2px;font-size:2px;">&nbsp;</td></tr>`;
    const bar = `<tr><td height="4" style="height:4px;line-height:4px;font-size:4px;background:${color};">&nbsp;</td></tr>`;
    return `${gap}${bar}`;
  }).join('');
  return `<table role="presentation" cellspacing="0" cellpadding="0">
    <tr>
      <td valign="middle" width="22" style="width:22px;">
        <table role="presentation" width="22" cellspacing="0" cellpadding="0" style="width:22px;">
          ${bars}
        </table>
      </td>
      <td valign="middle" style="padding-left:10px;font-size:${wordSize}px;font-weight:700;letter-spacing:-0.02em;color:${ATMOSPHERE_INK};line-height:1;">
        Atmosphere
      </td>
    </tr>
  </table>`;
}
