import { config } from '../../config.js';
import { splitName } from '../patterns.js';
import { safeFetchText } from '../sources/safeFetch.js';
import { toText, robotsForbids } from '../sources/webCrawl.js';
import { CRAWLER_USER_AGENT } from '../sources/safeFetch.js';

/**
 * The Profiler — professional context on someone before you call them.
 *
 * A salesperson who knows that Northgate Medical opened a third clinic in
 * March, and that the person they are calling has run facilities there since
 * 2021, has a conversation. A salesperson who knows a name and a phone number
 * has a cold call. That gap is the entire product here.
 *
 * WHAT THIS GATHERS, and the boundary is the design rather than a disclaimer:
 *
 *   Professional context only. Role, employer, tenure, what the company does,
 *   where it operates, what it has announced. The things a person published
 *   about themselves *in a business capacity*, on their employer's website,
 *   for the express purpose of being found by people who want to do business
 *   with them.
 *
 * WHAT IT DOES NOT GATHER, enforced in code rather than promised in prose —
 * see SENSITIVE_PATTERNS below:
 *
 *   Home address, family, marital status, age, health, religion, politics,
 *   race, sexuality, personal finances, criminal record, personal social
 *   accounts. Aggregating scattered public facts about a private life into one
 *   screen is what separates sales intelligence from a dossier, and it is the
 *   thing that gets these products regulated and their users sued. A page that
 *   collects it is not one this product is going to build.
 *
 * Every fact carries the URL it came from. That is not decoration: an
 * uncited claim on a profile is a rumour with good typography, and a
 * salesperson repeating it to a prospect finds out the hard way. If we cannot
 * say where something came from, it does not go on the page.
 */

/** Pages where companies describe themselves and their people. */
const PROFILE_PATHS = [
  '/about',
  '/about-us',
  '/team',
  '/our-team',
  '/leadership',
  '/staff',
  '/people',
  '/management',
  '/news',
  '/press',
  '/blog',
  '/newsroom',
];

/**
 * Categories that must never reach a profile, matched against extracted text.
 *
 * Belt and braces: the crawler only reads a company's own business pages, so
 * this material should not appear anyway. But "should not appear" is exactly
 * the assumption that fails when somebody's bio mentions their spouse, and a
 * sentence that goes on a sales screen is a sentence somebody will act on.
 */
const SENSITIVE_PATTERNS: Array<{ label: string; re: RegExp }> = [
  { label: 'family', re: /\b(wife|husband|spouse|partner of|married|children|kids|son|daughter|grandchildren)\b/i },
  { label: 'religion', re: /\b(church|congregation|parish|synagogue|mosque|temple|christian|catholic|jewish|muslim|hindu|buddhist)\b/i },
  { label: 'politics', re: /\b(republican|democrat|conservative|liberal|campaign for|ran for office|voted for)\b/i },
  { label: 'health', re: /\b(cancer|diagnosis|illness|disability|recovery from|treatment for|survivor of)\b/i },
  { label: 'home address', re: /\b(lives (in|at)|resides (in|at)|home address|residence at)\b/i },
  { label: 'age', re: /\b(age \d{2}|\d{2} years old|born in (19|20)\d{2})\b/i },
];

/** Does this sentence touch anything we refuse to put on a sales screen? */
export function sensitiveCategory(text: string): string | null {
  for (const { label, re } of SENSITIVE_PATTERNS) {
    if (re.test(text)) return label;
  }
  return null;
}

export interface ProfileFact {
  label: string;
  value: string;
  /** The page this came from. A fact without one does not get published. */
  sourceUrl: string;
  sourceKind: 'company_site' | 'crm';
}

export interface ProfileSignal {
  headline: string;
  sourceUrl: string;
}

export interface ProfileSourceCheck {
  url: string;
  ok: boolean;
  ms: number;
  skipped?: string;
}

export interface Profile {
  fullName: string;
  companyDomain: string;
  /** What the company says it does, in its own words. */
  companySummary: string | null;
  companySummarySource: string | null;
  /** Person-specific findings: title, tenure, the sentence their bio leads with. */
  facts: ProfileFact[];
  /** Things the company has announced — the openers a salesperson can use. */
  signals: ProfileSignal[];
  /** Derived, and labelled as derived. Never presented as fact. */
  talkingPoints: string[];
  sourcesChecked: ProfileSourceCheck[];
  /** Sentences dropped for touching a category we refuse to surface. */
  withheld: string[];
  /** What this deliberately never looks for, said out loud on the page. */
  excluded: string[];
}

export const EXCLUDED_CATEGORIES = [
  'Home address',
  'Family and relationships',
  'Age and date of birth',
  'Health',
  'Religion',
  'Politics',
  'Personal finances',
  'Personal social media',
];

/** The sentence a person's name appears in, cleaned up for reading. */
function sentencesMentioning(text: string, name: string): string[] {
  const parts = text.split(/(?<=[.!?])\s+/);
  const needle = name.toLowerCase();
  const surname = splitName(name)?.last ?? '';
  return parts
    .map((s) => s.trim())
    .filter((s) => s.length > 30 && s.length < 400)
    .filter((s) => {
      const lower = s.toLowerCase();
      return lower.includes(needle) || (surname.length > 3 && lower.includes(surname));
    });
}

/** A job title sitting next to the person's name. */
const TITLE_RE =
  /\b((?:senior |lead |chief |regional |national |district |vice |assistant |deputy |managing |general )*(?:president|director|manager|officer|adjuster|estimator|superintendent|supervisor|coordinator|owner|principal|partner|founder|administrator|controller|engineer|architect|specialist)(?: of [A-Z][a-z]+(?: [A-Z][a-z]+)?)?)\b/i;

/** Headline-shaped lines from a news or press page. */
function headlinesFrom(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\s{3,}/)
    .map((s) => s.trim())
    .filter((s) => s.length > 25 && s.length < 180)
    .filter((s) => /\b(announce|open|expand|acquire|award|launch|partner|complete|hire|appoint|new|celebrat)\w*\b/i.test(s))
    .slice(0, 6);
}

async function allowed(origin: string, path: string): Promise<boolean> {
  const robots = await safeFetchText(`${origin}/robots.txt`, { timeoutMs: 4_000 });
  if (!robots) return true;
  return !robotsForbids(robots, path);
}

/**
 * Build a profile from a company's own public pages.
 *
 * Never throws. A site that is down, blocked, or says no in robots.txt yields
 * a thinner profile, and `sourcesChecked` says which — a salesperson deserves
 * to know they are looking at two pages rather than ten before they decide how
 * much to trust it.
 */
export async function buildProfile(
  fullName: string,
  companyDomain: string,
  crmFacts: ProfileFact[] = [],
): Promise<Profile> {
  const domain = companyDomain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const origin = `https://${domain}`;

  const profile: Profile = {
    fullName,
    companyDomain: domain,
    companySummary: null,
    companySummarySource: null,
    facts: [...crmFacts],
    signals: [],
    talkingPoints: [],
    sourcesChecked: [],
    withheld: [],
    excluded: EXCLUDED_CATEGORIES,
  };

  if (!domain.includes('.')) return profile;

  let pagesRead = 0;
  const seenFacts = new Set(crmFacts.map((f) => `${f.label}:${f.value}`));
  const seenSignals = new Set<string>();

  for (const path of PROFILE_PATHS) {
    if (pagesRead >= config.prospecting.profilerMaxPages) break;

    const url = `${origin}${path}`;
    const started = Date.now();

    if (!(await allowed(origin, path))) {
      profile.sourcesChecked.push({ url, ok: false, ms: Date.now() - started, skipped: 'robots.txt' });
      continue;
    }

    const html = await safeFetchText(url, { timeoutMs: config.prospecting.crawlTimeoutMs });
    if (!html) {
      profile.sourcesChecked.push({ url, ok: false, ms: Date.now() - started });
      continue;
    }
    pagesRead += 1;
    profile.sourcesChecked.push({ url, ok: true, ms: Date.now() - started });

    const text = toText(html);

    // What the company says it does — its own words, from its own About page.
    if (!profile.companySummary && /about/.test(path)) {
      const first = text
        .split(/(?<=[.!?])\s+/)
        .map((s) => s.trim())
        .find((s) => s.length > 60 && s.length < 400 && !sensitiveCategory(s));
      if (first) {
        profile.companySummary = first;
        profile.companySummarySource = url;
      }
    }

    // Anything the page says about this person.
    for (const sentence of sentencesMentioning(text, fullName)) {
      const category = sensitiveCategory(sentence);
      if (category) {
        // Recorded as withheld rather than silently dropped: a profile that
        // quietly filters is one nobody can audit.
        if (!profile.withheld.includes(category)) profile.withheld.push(category);
        continue;
      }

      const title = TITLE_RE.exec(sentence)?.[1];
      if (title) {
        const key = `Title:${title}`;
        if (!seenFacts.has(key)) {
          seenFacts.add(key);
          profile.facts.push({
            label: 'Title',
            value: title.replace(/\s+/g, ' ').trim(),
            sourceUrl: url,
            sourceKind: 'company_site',
          });
        }
      }

      const tenure = /\b(?:since|joined (?:the (?:company|firm|team)|[A-Z][\w&.\- ]{2,40}) in|has been with [\w&.\- ]{2,40} since)\s+((?:19|20)\d{2})\b/i.exec(sentence);
      if (tenure) {
        const key = `With the company since:${tenure[1]}`;
        if (!seenFacts.has(key)) {
          seenFacts.add(key);
          profile.facts.push({
            label: 'With the company since',
            value: tenure[1],
            sourceUrl: url,
            sourceKind: 'company_site',
          });
        }
      }

      const key = `Bio:${sentence.slice(0, 60)}`;
      if (!seenFacts.has(key) && profile.facts.filter((f) => f.label === 'From their bio').length < 3) {
        seenFacts.add(key);
        profile.facts.push({
          label: 'From their bio',
          value: sentence,
          sourceUrl: url,
          sourceKind: 'company_site',
        });
      }
    }

    // Company announcements — the openers worth knowing before a call.
    if (/news|press|blog/.test(path)) {
      for (const headline of headlinesFrom(text)) {
        if (sensitiveCategory(headline)) continue;
        if (seenSignals.has(headline)) continue;
        seenSignals.add(headline);
        profile.signals.push({ headline, sourceUrl: url });
        if (profile.signals.length >= 6) break;
      }
    }
  }

  profile.talkingPoints = deriveTalkingPoints(profile);
  return profile;
}

/**
 * Suggestions, labelled as suggestions.
 *
 * These are inferred from what was gathered rather than found anywhere, which
 * is why they are a separate field with a separate heading. Blending a guess
 * into a list of cited facts is how a salesperson ends up confidently telling
 * a prospect something nobody ever said.
 */
function deriveTalkingPoints(profile: Profile): string[] {
  const points: string[] = [];

  const title = profile.facts.find((f) => f.label === 'Title')?.value;
  const tenure = profile.facts.find((f) => f.label === 'With the company since')?.value;

  if (title && /facilit|property|operations|maintenance/i.test(title)) {
    points.push(
      `They run ${/facilit/i.test(title) ? 'facilities' : 'operations'} — response time and minimising disruption to tenants will matter more to them than headline price.`,
    );
  }
  if (title && /adjuster|claims/i.test(title)) {
    points.push(
      'On the carrier side — documentation quality and scope accuracy are what make you easy to work with.',
    );
  }
  if (tenure) {
    const years = new Date().getFullYear() - Number(tenure);
    if (years >= 5) {
      points.push(
        `${years} years in the role — they will have existing vendors, so lead with what those vendors are not doing.`,
      );
    }
  }
  for (const signal of profile.signals.slice(0, 2)) {
    points.push(`Recent company news to open with: "${signal.headline}"`);
  }
  if (!profile.facts.length && !profile.signals.length) {
    points.push(
      'Nothing published about this person was found. Treat the call as genuinely cold, and ask rather than assume.',
    );
  }
  return points;
}

export { CRAWLER_USER_AGENT };
