/**
 * Phone normalisation to E.164.
 *
 * Every lookup API speaks E.164 (+15125550110) and every data vendor speaks
 * something else — "(512) 555-0110", "512.555.0110 x14", "+1 512 555 0110".
 * Without one canonical form, suppression misses numbers it holds, the same
 * number is stored three ways, and a carrier lookup is billed for a string the
 * API cannot parse.
 *
 * Deliberately NANP-focused rather than pulling in a full libphonenumber. The
 * customers are US restoration contractors calling US adjusters and property
 * managers; a number that is not recognisably North American is passed through
 * untouched and labelled unknown rather than being mangled into a plausible
 * wrong number. Getting this wrong silently is worse than not handling it.
 */

/** Extensions are not part of the number and break every lookup API. */
function stripExtension(raw: string): string {
  return raw.replace(/\s*(?:ext|x|extension|#)\.?\s*\d+\s*$/i, '');
}

/**
 * Convert to E.164, or null when this cannot be done confidently.
 *
 * Null is a real answer: it means "keep the original string and do not pretend
 * to have parsed it". A caller that treats null as a failure to be papered
 * over will end up dialling something nobody wrote down.
 */
export function toE164(raw: string | null | undefined): string | null {
  if (!raw) return null;

  const cleaned = stripExtension(String(raw).trim());
  // Keep a leading + so an already-international number is recognisable.
  const plus = cleaned.trimStart().startsWith('+');
  const digits = cleaned.replace(/\D/g, '');
  if (!digits) return null;

  if (plus) {
    // Already international. E.164 allows up to 15 digits.
    if (digits.length < 8 || digits.length > 15) return null;
    return `+${digits}`;
  }

  // NANP: ten digits, or eleven with the country code.
  if (digits.length === 10) {
    // Area codes and exchange codes never start with 0 or 1, which is the
    // cheapest way to reject a string of digits that was never a phone number.
    if (/^[01]/.test(digits) || /^\d{3}[01]/.test(digits)) return null;
    return `+1${digits}`;
  }
  if (digits.length === 11 && digits.startsWith('1')) {
    const national = digits.slice(1);
    if (/^[01]/.test(national) || /^\d{3}[01]/.test(national)) return null;
    return `+1${national}`;
  }

  // Anything else is left alone rather than guessed at.
  return null;
}

/** Digits only, for comparing two numbers written differently. */
export function phoneDigits(raw: string | null | undefined): string {
  if (!raw) return '';
  const e164 = toE164(raw);
  return (e164 ?? String(raw)).replace(/\D/g, '');
}

/**
 * Do these two strings mean the same telephone?
 *
 * Compares on the last ten digits, so a number stored with a country code
 * matches the same number stored without one — which is exactly the case that
 * made suppression miss numbers it was holding.
 */
export function samePhone(a: string | null | undefined, b: string | null | undefined): boolean {
  const da = phoneDigits(a);
  const db = phoneDigits(b);
  if (!da || !db) return false;
  return da.slice(-10) === db.slice(-10);
}

/** For display: +15125550110 → (512) 555-0110. Non-NANP is left as-is. */
export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return '';
  const match = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  if (!match) return e164;
  return `(${match[1]}) ${match[2]}-${match[3]}`;
}
