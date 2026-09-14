/**
 * Client-side private-moment text scrubbing for homeowner surfaces.
 * Mirrors backend/src/audio/privacyRedactions heuristics — never invent rooms;
 * lean toward over-redacting private spaces.
 */

export const PRIVACY_REDACTED_LABEL = '[privacy redacted]';

const PRIVATE_SPACE_RE =
  /\b(bathroom|restroom|toilet|lavatory|shower|bathtub|bath\s*tub|locker\s*room|changing\s*room|dressing\s*room)\b/i;
const INTIMATE_RE =
  /\b(undress(ing|ed)?|disrob(e|ing)|naked|nude|nudity|lingerie|underwear|bra\b|panties|genital|intimate|in\s+the\s+shower|on\s+the\s+toilet)\b/i;

export function isPrivateMomentText(text: string | null | undefined): boolean {
  const t = String(text || '').trim();
  if (!t) return false;
  return PRIVATE_SPACE_RE.test(t) || INTIMATE_RE.test(t);
}

/** Scrub a homeowner-facing string; returns null when empty or fully private. */
export function scrubHomeownerText(
  text: string | null | undefined,
  opts?: { privacyProtected?: boolean },
): string | null {
  const t = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return null;
  if (t === PRIVACY_REDACTED_LABEL) return null;
  if (opts?.privacyProtected && isPrivateMomentText(t)) return null;
  if (isPrivateMomentText(t)) return null;
  return t.slice(0, 400);
}
