/**
 * Email pattern inference.
 *
 * This is the technique that finds addresses no vendor sells you, and it is
 * not guesswork — it is observation. A company picks one convention and
 * applies it to everybody: `first.last@`, `flast@`, `first@`. Learn the
 * convention from the addresses you already hold at that domain, apply it to
 * the person you want, and verify the result. If the mail server accepts it,
 * it is a real address regardless of whether any database had it.
 *
 * Two properties make this legitimate and safe:
 *
 *   - It only ever produces *business* addresses at a domain the customer is
 *     already doing business with, derived from data they already hold.
 *   - Nothing is sold until verification says a mailbox exists. A guess that
 *     fails costs the customer nothing, which is the whole point of putting
 *     verification between inference and billing.
 *
 * The evidence comes from the org's own contacts and prior reveals, so it gets
 * better the more the customer uses it — a compounding asset that belongs to
 * them, not to a data vendor.
 */

/** The conventions worth trying, in rough order of how common they are. */
export const PATTERNS = [
  '{first}.{last}',
  '{f}{last}',
  '{first}',
  '{first}{last}',
  '{first}_{last}',
  '{last}.{first}',
  '{f}.{last}',
  '{last}{f}',
  '{first}.{l}',
] as const;

export type EmailPattern = (typeof PATTERNS)[number];

export interface NameParts {
  first: string;
  last: string;
}

/** Strip accents and anything that is not a letter — mail locals are ASCII. */
function normalise(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

/**
 * Split a display name into a first and last part.
 *
 * Deliberately simple, and deliberately conservative about what it will not
 * handle: a single-word name, or one that reduces to nothing after
 * normalisation, returns null rather than producing a candidate we would then
 * charge someone to verify.
 */
export function splitName(fullName: string): NameParts | null {
  const words = fullName
    .trim()
    .split(/\s+/)
    .filter((w) => !/^(mr|mrs|ms|dr|prof|jr|sr|ii|iii|iv)\.?$/i.test(w));
  if (words.length < 2) return null;

  const first = normalise(words[0]);
  // Hyphenated surnames keep both halves joined: "Ortiz-Park" → "ortizpark".
  const last = normalise(words[words.length - 1]);
  if (!first || !last) return null;
  return { first, last };
}

/** Render one pattern for one person. */
export function applyPattern(pattern: EmailPattern, name: NameParts, domain: string): string {
  const local = pattern
    .replace('{first}', name.first)
    .replace('{last}', name.last)
    .replace('{f}', name.first[0] ?? '')
    .replace('{l}', name.last[0] ?? '');
  return `${local}@${domain.toLowerCase()}`;
}

/**
 * Which pattern does this address follow, given whose it is?
 *
 * Returns every pattern that reproduces the address exactly — usually one, but
 * `john@acme.com` for John Smith matches only `{first}`, while a name like
 * "Bob Bob" would legitimately match several, and pretending to pick one would
 * be inventing certainty.
 */
export function patternsMatching(email: string, fullName: string): EmailPattern[] {
  const name = splitName(fullName);
  if (!name) return [];
  const at = email.lastIndexOf('@');
  if (at <= 0) return [];
  const local = email.slice(0, at).toLowerCase();
  const domain = email.slice(at + 1).toLowerCase();
  return PATTERNS.filter((p) => applyPattern(p, name, domain).split('@')[0] === local);
}

export interface KnownAddress {
  email: string;
  fullName: string;
}

export interface InferredPattern {
  pattern: EmailPattern;
  /** How many known addresses at this domain follow it. */
  support: number;
  /** support ÷ addresses that could be attributed at all. */
  confidence: number;
}

/**
 * Infer a domain's convention from addresses already known at that domain.
 *
 * Evidence is per domain and nothing else: a pattern learned from one company
 * says nothing about another, and applying it across domains is how these
 * tools end up emailing strangers at addresses that never existed.
 */
export function inferPattern(known: KnownAddress[], domain: string): InferredPattern | null {
  const target = domain.toLowerCase();
  const tally = new Map<EmailPattern, number>();
  let attributed = 0;

  for (const entry of known) {
    if (!entry.email.toLowerCase().endsWith(`@${target}`)) continue;
    const matches = patternsMatching(entry.email, entry.fullName);
    if (!matches.length) continue;
    attributed += 1;
    // An address matching several patterns votes for each; the winner is the
    // one that explains the most addresses overall.
    for (const p of matches) tally.set(p, (tally.get(p) ?? 0) + 1);
  }

  if (!attributed) return null;

  let best: EmailPattern | null = null;
  let bestSupport = 0;
  for (const [pattern, support] of tally) {
    // PATTERNS is ordered by prevalence, so an exact tie resolves to the more
    // common convention rather than to map insertion order.
    if (support > bestSupport || (support === bestSupport && best && PATTERNS.indexOf(pattern) < PATTERNS.indexOf(best))) {
      best = pattern;
      bestSupport = support;
    }
  }
  if (!best) return null;

  return { pattern: best, support: bestSupport, confidence: bestSupport / attributed };
}

/**
 * The addresses to try for one person at one domain, best first.
 *
 * When the domain's convention is known it leads and the rest follow as
 * fallbacks; when it is not, the list is simply the common conventions in
 * order. Callers verify down the list and stop at the first mailbox that
 * exists — so a wrong guess costs a DNS lookup, not a customer's credit.
 */
export function candidateEmails(
  fullName: string,
  domain: string,
  known: KnownAddress[] = [],
  limit = 5,
): string[] {
  const name = splitName(fullName);
  if (!name || !domain) return [];

  const inferred = inferPattern(known, domain);
  const ordered: EmailPattern[] = inferred
    ? [inferred.pattern, ...PATTERNS.filter((p) => p !== inferred.pattern)]
    : [...PATTERNS];

  const seen = new Set<string>();
  const out: string[] = [];
  for (const pattern of ordered) {
    const candidate = applyPattern(pattern, name, domain);
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    out.push(candidate);
    if (out.length >= limit) break;
  }
  return out;
}
