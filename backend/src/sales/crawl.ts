import type { DiscoveredContact } from './types.js';

/**
 * Public-page crawler for decision-maker contact info.
 *
 * Uses Playwright when available to fetch home / about / contact / team pages
 * and extract emails, names, and titles. Falls back to a heuristic demo contact
 * when the browser is missing or the site is unreachable — the outreach loop
 * still needs someone to email.
 */

const PATHS = ['/', '/about', '/about-us', '/contact', '/contact-us', '/team', '/our-team', '/leadership'];

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const TITLE_HINT =
  /\b(CEO|COO|CFO|CTO|Owner|Founder|President|Principal|Partner|Director|VP|Vice President|Manager|General Manager|Managing Partner)\b/i;

function looksLikePublicUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    // Block obvious internal / metadata targets.
    if (u.hostname === 'localhost' || u.hostname.endsWith('.local')) return false;
    return true;
  } catch {
    return false;
  }
}

function extractEmails(text: string): string[] {
  const matches = text.match(EMAIL_RE) ?? [];
  const blocked = /(example\.com|sentry\.io|wixpress\.com|schema\.org|godaddy\.com|cloudflare|noreply|no-reply)/i;
  const uniq = new Set<string>();
  for (const raw of matches) {
    const email = raw.toLowerCase();
    if (blocked.test(email)) continue;
    if (email.length > 254) continue;
    uniq.add(email);
  }
  return [...uniq].slice(0, 8);
}

function guessNameFromEmail(email: string): string | null {
  const local = email.split('@')[0] ?? '';
  if (!local || /^(info|hello|contact|sales|support|admin|office|team)$/i.test(local)) {
    return null;
  }
  const parts = local.split(/[._-]+/).filter(Boolean);
  if (parts.length === 0) return null;
  return parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join(' ');
}

function demoContacts(businessName: string): DiscoveredContact[] {
  const short = businessName.split(/\s+/).slice(0, 2).join(' ');
  return [
    {
      fullName: `Alex Rivera`,
      title: 'Director of Operations',
      email: `alex.rivera@${slugDomain(businessName)}.example`,
      phone: null,
      linkedinUrl: null,
      isDecisionMaker: true,
      researchSummary: `Leads ops at ${short}. Likely evaluates estimating, field tech, and carrier-portal tooling for Atmosphere demos.`,
      personalizationHooks: [
        `Runs operations at ${short}`,
        'Decision-maker for restoration software and workflows',
      ],
    },
    {
      fullName: `Jordan Lee`,
      title: 'Owner',
      email: `jordan.lee@${slugDomain(businessName)}.example`,
      phone: null,
      linkedinUrl: null,
      isDecisionMaker: true,
      researchSummary: `Owner-operator at ${short}. Final say on buying Atmosphere for estimating and field teams.`,
      personalizationHooks: [`Owner of ${short}`, 'Approves new software for the restoration shop'],
    },
  ];
}

function slugDomain(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 18) || 'business';
}

async function fetchPageText(url: string): Promise<string> {
  try {
    // Prefer Playwright for JS-rendered sites; fall back to fetch.
    try {
      const { chromium } = await import('playwright');
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000 });
        const text = await page.evaluate(() => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const doc = (globalThis as any).document;
          return String(doc?.body?.innerText ?? '');
        });
        return String(text).slice(0, 40_000);
      } finally {
        await browser.close();
      }
    } catch {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'AtmosphereOutreach/1.0',
          Accept: 'text/html',
        },
        signal: AbortSignal.timeout(15_000),
        redirect: 'follow',
      });
      if (!res.ok) return '';
      const html = await res.text();
      return html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .slice(0, 40_000);
    }
  } catch {
    return '';
  }
}

function contactsFromText(text: string, businessName: string): DiscoveredContact[] {
  const emails = extractEmails(text);
  const contacts: DiscoveredContact[] = [];

  for (const email of emails) {
    const name = guessNameFromEmail(email) ?? `Team at ${businessName}`;
    const titleMatch = text.match(TITLE_HINT);
    const isRoleInbox = /^(info|hello|contact|sales|support|admin|office|team)@/i.test(email);
    contacts.push({
      fullName: name,
      title: titleMatch?.[0] ?? (isRoleInbox ? 'General contact' : 'Decision maker'),
      email,
      phone: null,
      linkedinUrl: null,
      isDecisionMaker: !isRoleInbox,
      researchSummary: `Contact found on the public website for ${businessName}.`,
      personalizationHooks: [
        `Works with ${businessName}`,
        titleMatch ? `Title signal: ${titleMatch[0]}` : 'Listed on company site',
      ],
    });
  }

  // Name + title pairs near each other in the page text.
  const nameTitle = text.matchAll(
    /([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})\s[,–—-]\s*((?:CEO|COO|CFO|Owner|Founder|President|Director|VP|Manager)[^.\n]{0,40})/g,
  );
  for (const match of nameTitle) {
    const fullName = match[1]?.trim();
    const title = match[2]?.trim();
    if (!fullName || contacts.some((c) => c.fullName === fullName)) continue;
    contacts.push({
      fullName,
      title,
      email: null,
      phone: null,
      linkedinUrl: null,
      isDecisionMaker: true,
      researchSummary: `Leadership mention on the ${businessName} website.`,
      personalizationHooks: [`${title} at ${businessName}`],
    });
    if (contacts.length >= 6) break;
  }

  return contacts.slice(0, 6);
}

export async function crawlBusinessContacts(input: {
  businessName: string;
  websiteUrl?: string | null;
  forceDemo?: boolean;
}): Promise<{ contacts: DiscoveredContact[]; mode: 'live' | 'demo' }> {
  const { businessName, websiteUrl, forceDemo } = input;

  if (forceDemo || !websiteUrl || !looksLikePublicUrl(websiteUrl) || /example\.com/i.test(websiteUrl)) {
    return { contacts: demoContacts(businessName), mode: 'demo' };
  }

  let combined = '';
  const origin = new URL(websiteUrl).origin;
  for (const path of PATHS) {
    const target = path === '/' ? websiteUrl : `${origin}${path}`;
    if (!looksLikePublicUrl(target)) continue;
    const text = await fetchPageText(target);
    if (text) combined += `\n${text}`;
    if (combined.length > 80_000) break;
  }

  const contacts = contactsFromText(combined, businessName);
  if (contacts.length === 0) {
    return { contacts: demoContacts(businessName), mode: 'demo' };
  }
  return { contacts, mode: 'live' };
}
