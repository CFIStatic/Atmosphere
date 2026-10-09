/**
 * Comparing what a form field shows with what Computer meant to put there.
 * Sites reformat values (phone masks, dates, upper-casing, thousands
 * separators), so "the field holds the value" means equal after
 * normalizing, not byte-equal.
 */

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * A date in a form a person or a job field might use, as YYYY-MM-DD (what
 * <input type="date"> takes). US order for slashes (MM/DD/YYYY). Null when it
 * is not a date.
 */
export function toIsoDate(value: string): string | null {
  const v = value.trim();
  let m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
  if (m) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return valid(y, +m[1], +m[2]);
  }
  m = v.match(/^([a-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/i);
  if (m) {
    const month = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1;
    return month ? valid(+m[3], month, +m[2]) : null;
  }
  return null;
}

function valid(y: number, mo: number, d: number): string | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1900 || y > 2200) return null;
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCMonth() !== mo - 1) return null;
  return `${y}-${pad(mo)}-${pad(d)}`;
}

const TRUE = /^(true|yes|y|checked|check|on|1|x|selected|tick|ticked)$/i;
const FALSE = /^(false|no|n|unchecked|uncheck|off|0|clear|cleared|unticked)$/i;

/** "checked" / "unchecked" for a checkbox value, or null when unclear. */
export function toChecked(value: string): boolean | null {
  const v = value.trim();
  if (TRUE.test(v)) return true;
  if (FALSE.test(v)) return false;
  return null;
}

function loose(v: string): string {
  return v.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Does the field's value match what was wanted, allowing site reformatting? */
export function fieldMatches(wanted: string, actual: string | null, kind?: string): boolean {
  if (actual == null) return false;
  if (kind === 'checkbox' || kind === 'radio') {
    const want = toChecked(wanted);
    return want != null && (actual === 'checked') === want;
  }
  if (loose(wanted) === loose(actual)) return true;
  const dw = toIsoDate(wanted);
  if (dw && dw === toIsoDate(actual)) return true;
  // Phone numbers, amounts and IDs that a mask reformats: same digits (and letters).
  const core = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, '');
  const cw = core(wanted);
  if (cw.length >= 3 && cw === core(actual)) return true;
  // Amounts: "1,250.00" vs "1250".
  const num = (v: string) => (/^[\s$€£]*-?[\d,]*\.?\d+\s*$/.test(v) ? Number(v.replace(/[^\d.-]/g, '')) : NaN);
  const nw = num(wanted);
  return Number.isFinite(nw) && nw === num(actual);
}
