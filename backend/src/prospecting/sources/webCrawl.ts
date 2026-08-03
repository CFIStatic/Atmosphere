import { config } from '../../config.js';
import { splitName, type KnownAddress } from '../patterns.js';
import { isFreeDomain, isRoleAddress } from '../verification.js';
import { CRAWLER_USER_AGENT, safeFetchText } from './safeFetch.js';
import type { ContactSource, SourcedContact } from './ports.js';

/**
 * The company's own website, as a contact source.
 *
 * This is the one that finds the people no database holds. A forty-person
 * property-management firm in Round Rock is not in People Data Labs, but its
 * site has a "Our Team" page with names, titles and addresses on it, because
 * publishing that is the entire point of having the page.
 *
 * It is also the least ethically fraught source in the product: the company
 * put the information on the open web themselves, for exactly this purpose,
 * and we read it the way any visitor would. Three rules keep it that way:
 *
 *   - robots.txt is obeyed. If a site says not to crawl a path, we do not,
 *     even though the page is public and nothing technically stops us.
 *   - A handful of likely pages, once. This is not a spider; it does not walk
 *     a whole site, and it does not come back in a loop.
 *   - We identify ourselves in the user agent, with a URL that explains what
 *     the bot is. Anyone who wants us gone can say so and we will honour it.
 *
 * Role addresses (info@, sales@) are found and deliberately discarded: they
 * are real, but a shared mailbox is not a person and selling it as a contact
 * is how a prospecting tool ends up emailing nobody in particular.
 */

/** Where companies actually put their people, in rough order of likelihood. */
const CANDIDATE_PATHS = [
  '/team',
  '/about',
  '/about-us',
  '/our-team',
  '/leadership',
  '/staff',
  '/contact',
  '/contact-us',
  '/people',
  '/management',
];

const EMAIL_IN_TEXT =
  /[a-z0-9](?:[a-z0-9._%+-]{0,62}[a-z0-9])?@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z]{2,})+/gi;

/**
 * Minimal robots.txt reading: the rules that apply to us, for the paths we
 * intend to ask for.
 *
 * Deliberately conservative. It understands User-agent, Disallow and Allow,
 * and when it cannot make sense of a file it assumes the site said no. A
 * parser that guesses generously is one that crawls things it was told not to.
 */
export function robotsForbids(robotsTxt: string, path: string): boolean {
  const lines = robotsTxt.split(/\r?\n/).map((l) => l.replace(/#.*$/, '').trim());

  let applies = false;
  let sawAnyGroup = false;
  const rules: Array<{ allow: boolean; path: string }> = [];

  for (const line of lines) {
    const [rawKey, ...rest] = line.split(':');
    if (!rest.length) continue;
    const key = rawKey.trim().toLowerCase();
    const value = rest.join(':').trim();

    if (key === 'user-agent') {
      // A new group starts; it applies if it names us or everybody.
      const agent = value.toLowerCase();
      const mine = CRAWLER_USER_AGENT.split('/')[0].toLowerCase();
      applies = agent === '*' || mine.includes(agent) || agent.includes(mine);
      if (applies) sawAnyGroup = true;
      continue;
    }
    if (!applies) continue;
    if (key === 'disallow') rules.push({ allow: false, path: value });
    if (key === 'allow') rules.push({ allow: true, path: value });
  }

  if (!sawAnyGroup) return false;

  // Longest matching rule wins, which is what the standard specifies and what
  // makes "Disallow: /" plus "Allow: /about" behave the way a site intends.
  let best: { allow: boolean; path: string } | null = null;
  for (const rule of rules) {
    if (rule.path === '') continue;
    if (!path.startsWith(rule.path)) continue;
    if (!best || rule.path.length > best.path.length) best = rule;
  }
  // "Disallow: /" with an empty path means everything.
  if (!best && rules.some((r) => r.path === '/' && !r.allow)) return true;
  return best ? !best.allow : false;
}

/** Strip tags so names sitting next to addresses survive as adjacent words. */
function toText(html: string): string {
  return html
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ');
}

/**
 * Words that look like a name and are not one.
 *
 * "Regional Manager" and "Field Adjuster" are two capitalised words sitting
 * right next to an address on every team page ever built, and they are usually
 * *closer* to it than the person's actual name. Without this list the crawler
 * confidently learns that acme.com addresses its staff as regional.manager@,
 * and pattern inference then poisons every later guess at that domain.
 */
const TITLE_WORDS = new Set(
  [
    'president', 'vice', 'chief', 'officer', 'director', 'manager', 'managing',
    'principal', 'partner', 'owner', 'founder', 'head', 'lead', 'senior',
    'junior', 'associate', 'assistant', 'deputy', 'interim', 'acting',
    'coordinator', 'supervisor', 'specialist', 'executive', 'administrator',
    'adjuster', 'estimator', 'superintendent', 'foreman', 'technician',
    'regional', 'national', 'general', 'field', 'district', 'territory',
    'sales', 'marketing', 'operations', 'facilities', 'property', 'claims',
    'account', 'accounts', 'project', 'business', 'development', 'customer',
    'support', 'service', 'services', 'human', 'resources', 'technology',
    'information', 'construction', 'insurance', 'commercial', 'residential',
    'portfolio', 'estate', 'real', 'group', 'company', 'team', 'staff',
    'contact', 'about', 'our', 'us', 'home', 'email', 'phone', 'office',
    'mobile', 'direct', 'main', 'toll', 'free', 'fax', 'address', 'location',
    'llc', 'inc', 'corp', 'ltd', 'co',
  ],
);

/** Two capitalised words are only a name if neither is a job title. */
function looksLikePersonName(first: string, last: string): boolean {
  if (TITLE_WORDS.has(first.toLowerCase()) || TITLE_WORDS.has(last.toLowerCase())) return false;
  return Boolean(splitName(`${first} ${last}`));
}

/**
 * Pair each address with the name nearest to it in the text.
 *
 * Team pages put a person's name within a few words of their address, so the
 * surrounding window is usually enough. A pairing we cannot make confidently
 * is dropped rather than guessed: a wrong name attached to a real address
 * teaches pattern inference the wrong convention, which then poisons every
 * later guess at that domain.
 */
export function pairNamesWithAddresses(text: string, domain: string): KnownAddress[] {
  const out: KnownAddress[] = [];
  const seen = new Set<string>();
  const target = domain.toLowerCase();

  for (const match of text.matchAll(EMAIL_IN_TEXT)) {
    const email = match[0].toLowerCase();
    if (!email.endsWith(`@${target}`)) continue;
    if (isRoleAddress(email) || isFreeDomain(email)) continue;
    if (seen.has(email)) continue;

    const at = match.index ?? 0;
    const start = Math.max(0, at - 90);
    const window = text.slice(start, at + 90);
    // Where the address actually sits inside the window. Not always 90 — near
    // the top of a page the window is clipped, and assuming otherwise measures
    // every distance from the wrong place.
    const anchor = at - start;

    // Two consecutive capitalised words is the shape of a person's name.
    const names = [...window.matchAll(/\b([A-Z][a-z'’-]{1,20})\s+([A-Z][a-z'’-]{1,20})\b/g)];
    if (!names.length) continue;

    // Prefer the nearest name BEFORE the address. Team pages run
    // "Name, Title, address" down the page, so the name after an address
    // almost always belongs to the next person — taking whichever is closest
    // in absolute terms reliably attributes each address to its neighbour.
    let before: { name: string; distance: number } | null = null;
    let after: { name: string; distance: number } | null = null;

    for (const n of names) {
      if (!looksLikePersonName(n[1], n[2])) continue;
      const index = n.index ?? 0;
      const name = `${n[1]} ${n[2]}`;
      if (index <= anchor) {
        const distance = anchor - index;
        if (!before || distance < before.distance) before = { name, distance };
      } else {
        const distance = index - anchor;
        if (!after || distance < after.distance) after = { name, distance };
      }
    }

    const best = before?.name ?? after?.name ?? null;
    if (!best) continue;

    seen.add(email);
    out.push({ email, fullName: best });
  }
  return out;
}

export class WebsiteContactSource implements ContactSource {
  readonly name = 'Company website';
  readonly metered = false;

  private async allowed(origin: string, path: string): Promise<boolean> {
    const robots = await safeFetchText(`${origin}/robots.txt`, { timeoutMs: 4_000 });
    // No robots.txt is permission by convention; an unreadable one we treat
    // the same way, because a site that cannot serve it has not refused.
    if (!robots) return true;
    return !robotsForbids(robots, path);
  }

  async addressesAt(domain: string): Promise<KnownAddress[]> {
    const clean = domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!clean || !clean.includes('.')) return [];

    const origin = `https://${clean}`;
    const found: KnownAddress[] = [];
    const seen = new Set<string>();
    let fetched = 0;

    for (const path of CANDIDATE_PATHS) {
      if (fetched >= config.prospecting.crawlMaxPages) break;
      if (!(await this.allowed(origin, path))) continue;

      const html = await safeFetchText(`${origin}${path}`, {
        timeoutMs: config.prospecting.crawlTimeoutMs,
      });
      if (!html) continue;
      fetched += 1;

      for (const entry of pairNamesWithAddresses(toText(html), clean)) {
        if (seen.has(entry.email)) continue;
        seen.add(entry.email);
        found.push(entry);
      }
      // Enough evidence to learn a convention; more pages add cost, not
      // accuracy. Inference needs agreement, not volume.
      if (found.length >= 8) break;
    }

    return found;
  }

  async find(fullName: string, domain: string): Promise<SourcedContact | null> {
    const wanted = splitName(fullName);
    if (!wanted) return null;

    const published = await this.addressesAt(domain);
    const hit = published.find((entry) => {
      const parts = splitName(entry.fullName);
      return parts && parts.first === wanted.first && parts.last === wanted.last;
    });
    if (!hit) return null;

    return {
      email: hit.email,
      phone: null,
      mobile: null,
      // Published by the company itself on its own site: as good as a
      // non-vendor source gets, though verification still has the last word.
      confidence: 0.85,
      detail: 'Published on the company website.',
    };
  }
}
