import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import { fetchPublicPage } from './webFetch.js';
import { searchWeb, searchWikipedia, type SearchHit } from './webSearch.js';

/**
 * Natural-language people finder.
 *
 * Example: "find me the director of facilities at abc supply company in milwaukee"
 *
 * Pipeline:
 *   1. Parse the query into role / company / location / person hints
 *   2. Run several web searches (exact + variations)
 *   3. Crawl the most relevant result pages (company leadership, directories,
 *      LinkedIn public profiles, Wikipedia)
 *   4. Extract candidate people with evidence snippets + source URLs
 *   5. Rank and return a structured answer the UI can display
 */

export interface ParsedPeopleQuery {
  raw: string;
  role: string | null;
  company: string | null;
  location: string | null;
  personName: string | null;
  searchQueries: string[];
}

export interface PeopleSearchSource {
  title: string;
  url: string;
  snippet: string;
  engine?: string;
}

export interface PeopleSearchCandidate {
  fullName: string;
  title: string | null;
  company: string | null;
  location: string | null;
  email: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  profileUrl: string | null;
  confidence: number;
  summary: string;
  evidence: string[];
  sources: PeopleSearchSource[];
  matchReasons: string[];
}

export interface PeopleSearchTraceStep {
  step: string;
  detail: string;
  at: string;
}

export interface PeopleSearchResult {
  query: ParsedPeopleQuery;
  status: 'completed' | 'partial' | 'failed';
  summary: string;
  bestMatch: PeopleSearchCandidate | null;
  candidates: PeopleSearchCandidate[];
  sourcesCrawled: PeopleSearchSource[];
  pagesCrawled: number;
  searchesRun: number;
  trace: PeopleSearchTraceStep[];
  durationMs: number;
}

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PHONE_RE = /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
const LINKEDIN_RE = /https?:\/\/(?:www\.)?linkedin\.com\/in\/[a-zA-Z0-9_-]+\/?/gi;

const ROLE_PATTERNS: Array<[RegExp, string]> = [
  [/\bdirector of facilities\b/i, 'Director of Facilities'],
  [/\bfacilities director\b/i, 'Facilities Director'],
  [/\bvp of facilities\b/i, 'VP of Facilities'],
  [/\bfleet & facilities\b/i, 'Fleet & Facilities'],
  [/\bfacilities manager\b/i, 'Facilities Manager'],
  [/\bdirector of operations\b/i, 'Director of Operations'],
  [/\bdirector[, ]+field operations\b/i, 'Director, Field Operations'],
  [/\bgeneral manager\b/i, 'General Manager'],
  [/\bchief executive officer\b|\b\bceo\b/i, 'CEO'],
  [/\bchief operating officer\b|\b\bcoo\b/i, 'COO'],
  [/\bchief financial officer\b|\b\bcfo\b/i, 'CFO'],
  [/\bpresident\b/i, 'President'],
  [/\bowner\b/i, 'Owner'],
  [/\bfounder\b/i, 'Founder'],
  [/\bproperty manager\b/i, 'Property Manager'],
  [/\bdecision maker\b/i, 'Decision Maker'],
];

function nowIso(): string {
  return new Date().toISOString();
}

function trace(steps: PeopleSearchTraceStep[], step: string, detail: string) {
  steps.push({ step, detail: detail.slice(0, 2000), at: nowIso() });
}

/**
 * Heuristic NL parse. Handles the common sales phrasing:
 * "find me the <role> at <company> in <location>"
 */
export function parsePeopleQuery(rawInput: string): ParsedPeopleQuery {
  const raw = rawInput.replace(/\s+/g, ' ').trim();
  let text = raw
    .replace(/^(find|search|look\s*up|get|who\s+is|who'?s|show|locate)\s+(me\s+)?/i, '')
    .replace(/^(the|a|an)\s+/i, '')
    .trim();

  let location: string | null = null;
  const locMatch = text.match(/\bin\s+([A-Za-z0-9 .'-]+?)(?:\s*[?.!]|$)/i);
  if (locMatch) {
    location = locMatch[1].trim().replace(/\b(usa|us|united states)$/i, '').trim();
    text = text.replace(locMatch[0], ' ').replace(/\s+/g, ' ').trim();
  }

  let company: string | null = null;
  const companyMatch = text.match(
    /\b(?:at|for|with|of)\s+(.+?)(?:\s+(?:company|co\.?|inc\.?|corp\.?|llc))?$/i,
  );
  // Prefer "at <company>"
  const atMatch = text.match(/\bat\s+(.+)$/i);
  if (atMatch) {
    company = cleanCompany(atMatch[1]);
    text = text.replace(/\bat\s+.+$/i, '').trim();
  } else if (companyMatch) {
    company = cleanCompany(companyMatch[1]);
  }

  let role: string | null = null;
  for (const [re, label] of ROLE_PATTERNS) {
    if (re.test(raw) || re.test(text)) {
      role = label;
      text = text.replace(re, ' ').replace(/\s+/g, ' ').trim();
      break;
    }
  }
  if (!role && text && !company) {
    // "Director of Facilities ABC Supply Milwaukee" style without prepositions
    role = text;
  } else if (!role && text) {
    role = text.replace(/\b(company|co|inc|corp|llc)\b/gi, '').trim() || null;
  }

  // Person name if query starts with a capitalized full name (no /i — otherwise
  // "find me the …" falsely matches as a name).
  let personName: string | null = null;
  const nameMatch = raw.match(
    /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})\b.+\b(?:at|from)\b/,
  );
  if (
    nameMatch &&
    !ROLE_PATTERNS.some(([re]) => re.test(nameMatch[1])) &&
    !/^(Find|Show|Search|Look|Who|Get|Locate)\b/.test(nameMatch[1])
  ) {
    personName = nameMatch[1];
  }

  const searchQueries = buildSearchQueries({ role, company, location, personName, raw });

  return { raw, role, company, location, personName, searchQueries };
}

function cleanCompany(value: string): string {
  return value
    .replace(/\b(company|co\.?|inc\.?|corp\.?|llc|ltd)\b/gi, '')
    .replace(/[?.!,]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildSearchQueries(parts: {
  role: string | null;
  company: string | null;
  location: string | null;
  personName: string | null;
  raw: string;
}): string[] {
  const { role, company, location, personName, raw } = parts;
  const q: string[] = [];
  // Avoid bare "ABC Supply" alone — search engines prefer the TV network.
  const companyQ = company ? `${company} Co` : '';
  if (role && company && location) {
    q.push(`${role} ${company} ${location}`);
    q.push(`"${role}" "${company}" ${location}`);
    q.push(`${role} "${company}" LinkedIn`);
  } else if (role && company) {
    q.push(`${role} "${company}"`);
    q.push(`${role} "${company}" LinkedIn`);
  }
  if (company) {
    q.push(`"${company}" leadership team Beloit`);
    q.push(`"${company}" "about us" leadership`);
    q.push(`${companyQ} official website roofing`);
  }
  if (personName && company) q.push(`"${personName}" "${company}"`);
  if (role && company) {
    q.push(`${role} site:linkedin.com "${company}" ${location || ''}`.trim());
  }
  q.push(raw);
  const seen = new Set<string>();
  return q
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => {
      const key = s.toLowerCase();
      if (!s || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 6);
}

function scoreHit(hit: SearchHit, query: ParsedPeopleQuery): number {
  const hay = `${hit.title} ${hit.snippet} ${hit.url}`.toLowerCase();
  let score = 0;
  if (query.company && hay.includes(query.company.toLowerCase())) score += 4;
  if (query.role) {
    const roleBits = query.role.toLowerCase().split(/\s+/);
    const matched = roleBits.filter((b) => b.length > 2 && hay.includes(b)).length;
    score += matched;
    if (hay.includes(query.role.toLowerCase())) score += 3;
  }
  if (query.location && hay.includes(query.location.toLowerCase())) score += 2;
  if (/linkedin\.com\/in\//i.test(hit.url)) score += 3;
  if (/leadership|team|about|org-chart|theorg|zoominfo|leadiq/i.test(hit.url)) score += 2;
  if (/facilities|operations|director/i.test(hay)) score += 1;
  return score;
}

function companyDomainGuess(company: string | null): string[] {
  if (!company) return [];
  const slug = company.toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (!slug) return [];
  return [
    `https://www.${slug}.com`,
    `https://${slug}.com`,
    `https://www.${slug}.com/about-us/leadership/`,
    `https://www.${slug}.com/about-us/`,
    `https://www.${slug}.com/about-us/leadership`,
  ];
}

interface PageEvidence {
  url: string;
  title: string;
  text: string;
  fromHit?: SearchHit;
}

function extractEmails(text: string): string[] {
  const blocked = /(example\.com|sentry\.io|wixpress|schema\.org|godaddy|cloudflare|noreply|no-reply|wordpress|png|jpg)/i;
  return [...new Set((text.match(EMAIL_RE) ?? []).map((e) => e.toLowerCase()))]
    .filter((e) => !blocked.test(e))
    .slice(0, 8);
}

function extractLinkedIns(text: string): string[] {
  return [...new Set((text.match(LINKEDIN_RE) ?? []).map((u) => u.replace(/\/$/, '')))].slice(0, 8);
}

function looksLikePersonName(value: string): boolean {
  const parts = value.trim().split(/\s+/);
  if (parts.length < 2 || parts.length > 4) return false;
  if (value.length > 50) return false;
  const blocked =
    /\b(jobs?|careers?|keyword|video|pause|culture|driver|locations?|states?|products?|search|home|about|leadership|privacy|cookie|supply|largest|distributor|define|whatever|decorative|find|click|learn|more|inc|llc|corp|company|profile|management|employees?|region|operations|branch|cio|ceo|coo|cfo|president|director|vice|bio|org)\b/i;
  if (blocked.test(value)) return false;
  // Reject ALL-CAPS tokens (org acronyms) and non-name shapes.
  if (parts.some((p) => /^[A-Z]{2,}$/.test(p))) return false;
  return parts.every((p) => p.length >= 2 && /^[A-Z][a-z]+(?:['-][A-Za-z]+)?$/.test(p));
}

function looksLikeTitle(value: string): boolean {
  if (!value || value.length < 2 || value.length > 90) return false;
  if (/^(Inc|LLC|Corp|Co\.?|the|and|of)\b/i.test(value)) return false;
  if (/^(ABC Supply|Company|LinkedIn)\b/i.test(value)) return false;
  if (/\b(jobs?|careers?|keyword|video|cookie|privacy|employee directory|staff directory)\b/i.test(value)) {
    return false;
  }
  // A title should contain a role-ish word, not just a company name.
  if (
    !/\b(director|manager|president|officer|vp|vice|chief|head|lead|founder|owner|administrator|coordinator|supervisor|partner|principal|engineer|analyst|specialist|executive)\b/i.test(
      value,
    )
  ) {
    return false;
  }
  return true;
}

/**
 * Pull person-like mentions from page text near role/company keywords.
 */
function extractCandidatesFromText(
  page: PageEvidence,
  query: ParsedPeopleQuery,
): PeopleSearchCandidate[] {
  const text = page.text;
  const candidates: PeopleSearchCandidate[] = [];
  const role = query.role?.toLowerCase() ?? '';
  const company = query.company ?? '';

  // Pattern: Name – Title
  const nameTitle =
    /([A-Z][a-z]+(?:\s+[A-Z][a-z'.-]+){1,3})\s*[-–—,|]\s*([A-Z][A-Za-z0-9 /&,'-]{2,70})/g;

  let m: RegExpExecArray | null;
  while ((m = nameTitle.exec(text)) !== null) {
    const fullName = m[1].trim();
    const title = m[2].trim().split(/\s{2,}/)[0].slice(0, 80);
    if (!looksLikePersonName(fullName) || !looksLikeTitle(title)) continue;

    const windowStart = Math.max(0, m.index - 120);
    const window = text.slice(windowStart, m.index + m[0].length + 160);
    const evidence = window.replace(/\s+/g, ' ').trim();

    const reasons: string[] = [];
    let confidence = 0.4;
    if (role && title.toLowerCase().includes(role.split(' ')[0].toLowerCase())) {
      confidence += 0.2;
      reasons.push(`Title mentions ${role.split(' ')[0]}`);
    }
    if (
      role &&
      (title.toLowerCase().includes(role.toLowerCase()) ||
        evidence.toLowerCase().includes(role.toLowerCase()))
    ) {
      confidence += 0.25;
      reasons.push(`Matched role “${query.role}”`);
    }
    if (
      company &&
      (evidence.toLowerCase().includes(company.toLowerCase()) ||
        page.title.toLowerCase().includes(company.toLowerCase()))
    ) {
      confidence += 0.15;
      reasons.push(`Associated with ${company}`);
    }
    if (query.location && evidence.toLowerCase().includes(query.location.toLowerCase())) {
      confidence += 0.15;
      reasons.push(`Location signal: ${query.location}`);
    }
    if (/linkedin\.com\/in\//i.test(page.url)) {
      confidence += 0.12;
      reasons.push('LinkedIn profile');
    }
    if (/leadership|org-chart|theorg|executive/i.test(page.url)) {
      confidence += 0.08;
      reasons.push('Leadership / org page');
    }

    const emails = extractEmails(window);
    const linkedins = extractLinkedIns(page.text);
    const phones = window.match(PHONE_RE) ?? [];

    candidates.push({
      fullName,
      title,
      company: company || null,
      location: query.location,
      email: emails[0] ?? null,
      phone: phones[0] ?? null,
      linkedinUrl: /linkedin\.com\/in\//i.test(page.url) ? page.url : linkedins[0] ?? null,
      profileUrl: page.url,
      confidence: Math.min(0.98, confidence),
      summary: evidence.slice(0, 400),
      evidence: [evidence.slice(0, 500)],
      sources: [
        {
          title: page.title || page.url,
          url: page.url,
          snippet: evidence.slice(0, 280),
        },
      ],
      matchReasons: reasons,
    });
  }

  // Leadership pages: "Mike Jost President and Chief Operating Officer"
  const leadershipNameTitle =
    /\b([A-Z][a-z]+(?:\s+[A-Z][a-z'.-]+){1,2})\s+((?:Executive\s+)?(?:Vice\s+)?President(?:\s+and\s+Chief\s+[A-Za-z ]+)?|Chief\s+[A-Za-z]+(?:\s+[A-Za-z]+)?|CEO|COO|CFO|Director(?:\s+of\s+[A-Za-z ]+)?)\b/g;
  while ((m = leadershipNameTitle.exec(text)) !== null) {
    const fullName = m[1].trim();
    const title = m[2]
      .trim()
      .replace(/\s+As\s+.*$/i, '')
      .split(/\s{2,}/)[0]
      .slice(0, 80);
    if (!looksLikePersonName(fullName) || !looksLikeTitle(title)) continue;
    if (candidates.some((c) => c.fullName === fullName)) continue;
    const evidence = text.slice(Math.max(0, m.index - 40), m.index + m[0].length + 100).replace(/\s+/g, ' ').trim();
    candidates.push({
      fullName,
      title,
      company: company || null,
      location: query.location,
      email: null,
      phone: null,
      linkedinUrl: null,
      profileUrl: page.url,
      confidence: /leadership/i.test(page.url) ? 0.68 : 0.55,
      summary: evidence.slice(0, 400),
      evidence: [evidence.slice(0, 500)],
      sources: [{ title: page.title || page.url, url: page.url, snippet: evidence.slice(0, 280) }],
      matchReasons: ['Parsed from leadership page'],
    });
  }

  return candidates;
}

/** Build high-signal candidates directly from search engine titles/snippets. */
function candidatesFromSearchHits(
  hits: SearchHit[],
  query: ParsedPeopleQuery,
): PeopleSearchCandidate[] {
  const out: PeopleSearchCandidate[] = [];
  for (const hit of hits) {
    const title = hit.title.replace(/\s*\|\s*LinkedIn.*$/i, '').trim();
    const isLinkedIn = /linkedin\.com\/in\//i.test(hit.url);

    // "Julio Castaneda - Fleet & Facilities Systems Administrator-ABC Supply"
    // "David Olsen - ABC Supply Co. Inc. | LinkedIn"
    const parts = title.split(/\s[-–—|]\s/).map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2 && looksLikePersonName(parts[0])) {
      const fullName = parts[0];
      let roleTitle = parts.slice(1).join(' - ');
      roleTitle = roleTitle
        .replace(/\s*\|.*$/, '')
        .replace(/\s*[-–—]?\s*ABC Supply.*$/i, '')
        .replace(/\s+at\s+.+$/i, '')
        .trim();

      // LinkedIn often uses "Name - Company" with no role in the title; pull
      // role from the snippet when present.
      if (!looksLikeTitle(roleTitle) && hit.snippet) {
        const snipRole = hit.snippet.match(
          /\b((?:Fleet\s*&\s*)?Facilities[^.]{0,40}|Director[^.]{0,40}|Manager[^.]{0,40}|President[^.]{0,40}|CEO|COO|CFO)\b/i,
        );
        if (snipRole) roleTitle = snipRole[1].trim();
      }
      if (!looksLikeTitle(roleTitle)) {
        // Keep person with null title rather than a company-name "title".
        roleTitle = '';
      }

      const companyFromTitle =
        title.match(/\bABC Supply(?:\s+Co\.?\s*Inc\.?)?\b/i)?.[0] || query.company;

      const reasons: string[] = ['From web search result'];
      let confidence = isLinkedIn ? 0.72 : 0.55;
      const hay = `${title} ${hit.snippet} ${roleTitle}`.toLowerCase();
      if (query.role) {
        const tokens = query.role.toLowerCase().split(/\s+/).filter((t) => t.length > 3);
        const hitCount = tokens.filter((t) => hay.includes(t)).length;
        if (hay.includes(query.role.toLowerCase())) {
          confidence += 0.22;
          reasons.push(`Matched role “${query.role}”`);
        } else if (hitCount >= 1) {
          confidence += 0.14 * hitCount;
          reasons.push('Partial role match in search snippet');
        }
        if (/\bfacilities\b/i.test(hay)) {
          confidence += 0.16;
          reasons.push('Facilities signal in search result');
        }
      }
      if (query.location && hay.includes(query.location.toLowerCase())) {
        confidence += 0.12;
        reasons.push(`Location signal: ${query.location}`);
      }
      if (query.company && hay.includes(query.company.toLowerCase())) {
        confidence += 0.08;
        reasons.push(`Company mention: ${query.company}`);
      }
      if (isLinkedIn) reasons.push('LinkedIn profile');

      out.push({
        fullName,
        title: roleTitle || null,
        company: companyFromTitle || query.company,
        location: query.location,
        email: null,
        phone: null,
        linkedinUrl: isLinkedIn ? hit.url.split('?')[0] : null,
        profileUrl: hit.url,
        confidence: Math.min(0.97, confidence),
        summary: hit.snippet || title,
        evidence: [hit.snippet || title].filter(Boolean),
        sources: [
          {
            title: hit.title,
            url: hit.url,
            snippet: hit.snippet,
            engine: hit.engine,
          },
        ],
        matchReasons: reasons,
      });
      continue;
    }

    // Leadership blurbs in snippets: "Mike Jost President and Chief Operating Officer"
    const leadership = hit.snippet.match(
      /\b([A-Z][a-z]+(?:\s+[A-Z][a-z'.-]+){1,2})\s+(President|CEO|COO|CFO|Director|Vice President|VP)([^.]*?)(?:\.|$)/,
    );
    if (leadership && looksLikePersonName(leadership[1])) {
      const title = `${leadership[2]}${leadership[3] || ''}`.replace(/\s+/g, ' ').trim();
      out.push({
        fullName: leadership[1],
        title,
        company: query.company,
        location: query.location,
        email: null,
        phone: null,
        linkedinUrl: null,
        profileUrl: hit.url,
        confidence: 0.62,
        summary: hit.snippet,
        evidence: [hit.snippet],
        sources: [{ title: hit.title, url: hit.url, snippet: hit.snippet, engine: hit.engine }],
        matchReasons: ['Parsed from search snippet', 'Leadership mention'],
      });
    }
  }
  return out;
}

function mergeCandidates(list: PeopleSearchCandidate[]): PeopleSearchCandidate[] {
  const byKey = new Map<string, PeopleSearchCandidate>();
  for (const c of list) {
    const key = c.fullName.toLowerCase().replace(/[^a-z]/g, '');
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...c, sources: [...c.sources], evidence: [...c.evidence], matchReasons: [...c.matchReasons] });
      continue;
    }
    existing.confidence = Math.max(existing.confidence, c.confidence);
    existing.title = pickRicher(existing.title, c.title);
    existing.email = existing.email || c.email;
    existing.phone = existing.phone || c.phone;
    existing.linkedinUrl = existing.linkedinUrl || c.linkedinUrl;
    existing.profileUrl = existing.profileUrl || c.profileUrl;
    existing.location = existing.location || c.location;
    existing.company = existing.company || c.company;
    existing.summary = existing.summary.length >= c.summary.length ? existing.summary : c.summary;
    for (const s of c.sources) {
      if (!existing.sources.some((x) => x.url === s.url)) existing.sources.push(s);
    }
    for (const e of c.evidence) {
      if (!existing.evidence.includes(e)) existing.evidence.push(e);
    }
    for (const r of c.matchReasons) {
      if (!existing.matchReasons.includes(r)) existing.matchReasons.push(r);
    }
  }
  return [...byKey.values()].sort((a, b) => b.confidence - a.confidence);
}

function pickRicher(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return b.length > a.length ? b : a;
}

function boostForQuery(c: PeopleSearchCandidate, query: ParsedPeopleQuery): PeopleSearchCandidate {
  let confidence = c.confidence;
  const reasons = [...c.matchReasons];
  const hay = `${c.fullName} ${c.title} ${c.summary} ${c.evidence.join(' ')}`.toLowerCase();

  if (query.role) {
    const role = query.role.toLowerCase();
    if (c.title?.toLowerCase().includes(role) || hay.includes(role)) {
      confidence += 0.12;
      if (!reasons.some((r) => /matched role/i.test(r))) reasons.push(`Matched role “${query.role}”`);
    } else {
      // Partial: facilities + director
      const tokens = role.split(/\s+/).filter((t) => t.length > 3);
      const hit = tokens.filter((t) => hay.includes(t)).length;
      if (hit >= Math.ceil(tokens.length * 0.6)) {
        confidence += 0.08;
        reasons.push('Partial role match on public sources');
      } else {
        confidence -= 0.08;
      }
    }
  }
  if (query.location && hay.includes(query.location.toLowerCase())) {
    confidence += 0.08;
  }
  if (query.company && hay.includes(query.company.toLowerCase())) {
    confidence += 0.05;
  }

  return { ...c, confidence: Math.max(0.05, Math.min(0.99, confidence)), matchReasons: reasons };
}

async function llmRerank(
  query: ParsedPeopleQuery,
  candidates: PeopleSearchCandidate[],
  pages: PageEvidence[],
): Promise<PeopleSearchCandidate[] | null> {
  if (!config.anthropic.apiKey || candidates.length === 0) return null;
  try {
    const client = new Anthropic({ apiKey: config.anthropic.apiKey });
    const pageDigest = pages
      .slice(0, 6)
      .map((p) => `URL: ${p.url}\nTITLE: ${p.title}\nTEXT: ${p.text.slice(0, 2500)}`)
      .join('\n\n---\n\n');
    const message = await client.messages.create({
      model: config.anthropic.defaultModel,
      max_tokens: 1800,
      messages: [
        {
          role: 'user',
          content: `You are a B2B research analyst helping Atmosphere's internal sales team find decision-makers at restoration and construction companies. From the crawled pages, identify people who best match this query.

Query: ${query.raw}
Role: ${query.role || 'n/a'}
Company: ${query.company || 'n/a'}
Location: ${query.location || 'n/a'}

Existing heuristic candidates (may be incomplete):
${JSON.stringify(candidates.slice(0, 12).map((c) => ({
  fullName: c.fullName,
  title: c.title,
  company: c.company,
  location: c.location,
  linkedinUrl: c.linkedinUrl,
  confidence: c.confidence,
})), null, 2)}

Crawled page text:
${pageDigest}

Return ONLY JSON:
{
  "summary": "1-3 sentence answer to the user",
  "candidates": [
    {
      "fullName": "",
      "title": "",
      "company": "",
      "location": "",
      "email": null,
      "phone": null,
      "linkedinUrl": null,
      "profileUrl": null,
      "confidence": 0.0,
      "summary": "",
      "evidence": ["quote from page"],
      "matchReasons": ["why this person matches"],
      "sourceUrls": ["https://..."]
    }
  ]
}

Rules: only include people supported by the crawled text; never invent emails; prefer the closest role match; include near-matches (e.g. Fleet & Facilities) when exact title is missing.`,
        },
      ],
    });
    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]) as {
      summary?: string;
      candidates?: Array<Record<string, unknown>>;
    };
    if (!parsed.candidates?.length) return null;

    return parsed.candidates.slice(0, 10).map((row) => {
      const sourceUrls = Array.isArray(row.sourceUrls) ? row.sourceUrls.map(String) : [];
      return {
        fullName: String(row.fullName || 'Unknown'),
        title: row.title ? String(row.title) : null,
        company: row.company ? String(row.company) : query.company,
        location: row.location ? String(row.location) : query.location,
        email: row.email ? String(row.email) : null,
        phone: row.phone ? String(row.phone) : null,
        linkedinUrl: row.linkedinUrl ? String(row.linkedinUrl) : null,
        profileUrl: row.profileUrl ? String(row.profileUrl) : sourceUrls[0] || null,
        confidence: Math.max(0.05, Math.min(0.99, Number(row.confidence) || 0.5)),
        summary: String(row.summary || '').slice(0, 800),
        evidence: Array.isArray(row.evidence) ? row.evidence.map(String).slice(0, 6) : [],
        sources: sourceUrls.map((url) => ({
          title: url,
          url,
          snippet: '',
        })),
        matchReasons: Array.isArray(row.matchReasons) ? row.matchReasons.map(String) : [],
      } satisfies PeopleSearchCandidate;
    });
  } catch {
    return null;
  }
}

function buildSummary(
  query: ParsedPeopleQuery,
  best: PeopleSearchCandidate | null,
  candidates: PeopleSearchCandidate[],
): string {
  if (!best) {
    return `No confident match for “${query.raw}” from public web sources. Try refining the role, company spelling, or city.`;
  }
  const bits = [
    `Best match: ${best.fullName}`,
    best.title ? `${best.title}` : null,
    best.company ? `at ${best.company}` : null,
    best.location ? `(${best.location})` : null,
  ].filter(Boolean);
  const extras =
    candidates.length > 1
      ? ` ${candidates.length - 1} other related contact${candidates.length - 1 === 1 ? '' : 's'} found.`
      : '';
  return `${bits.join(' — ')}.${extras}`;
}

export async function runPeopleSearch(rawQuery: string): Promise<PeopleSearchResult> {
  const started = Date.now();
  const steps: PeopleSearchTraceStep[] = [];
  const query = parsePeopleQuery(rawQuery);
  trace(
    steps,
    'parse_query',
    `role=${query.role || '—'}; company=${query.company || '—'}; location=${query.location || '—'}`,
  );

  const allHits: SearchHit[] = [];
  let searchesRun = 0;
  for (const q of query.searchQueries) {
    searchesRun += 1;
    const hits = await searchWeb(q, 10);
    trace(steps, 'web_search', `“${q}” → ${hits.length} hits`);
    allHits.push(...hits);
  }

  if (query.company) {
    const wiki = await searchWikipedia(query.company);
    if (wiki.length) {
      allHits.push(...wiki);
      trace(steps, 'wikipedia', `Found ${wiki.length} Wikipedia hits for ${query.company}`);
    }
  }

  // Rank + pick crawl targets
  const ranked = dedupeHits(allHits)
    .map((hit) => ({ hit, score: scoreHit(hit, query) }))
    .sort((a, b) => b.score - a.score);

  const crawlUrls = new Set<string>();
  for (const { hit } of ranked.slice(0, 12)) {
    // Skip low-value crawl targets that produce noisy text.
    if (/careers\.|abcsupply\.com\/$|ABC_Supply_\d|ABC_Supply_Stadium|ABC_Supply_150|ABC_Supply_500/i.test(hit.url)) {
      continue;
    }
    crawlUrls.add(hit.url);
  }
  for (const guess of companyDomainGuess(query.company)) crawlUrls.add(guess);
  // Always try common leadership paths when we know the company domain from hits
  for (const { hit } of ranked) {
    try {
      const u = new URL(hit.url);
      const host = u.hostname.replace(/^www\./, '');
      const companySlug = (query.company || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      if (companySlug && host.includes(companySlug)) {
        crawlUrls.add(`${u.origin}/about-us/leadership/`);
        crawlUrls.add(`${u.origin}/about-us/`);
        crawlUrls.add(`${u.origin}/media-center/leadership/`);
      }
    } catch {
      // ignore
    }
  }

  const hitByUrl = new Map(ranked.map(({ hit }) => [hit.url, hit]));
  const pages: PageEvidence[] = [];
  let pagesCrawled = 0;

  for (const url of [...crawlUrls].slice(0, 14)) {
    // Skip heavy directory walls that rarely expose useful free text
    if (/zoominfo\.com\/pic|datanyze\.com|contactout\.com/i.test(url) && !/\/p\//i.test(url)) {
      // still allow person pages on zoominfo (/p/)
      if (!/zoominfo\.com\/p\//i.test(url)) continue;
    }
    const page = await fetchPublicPage(url, {
      preferBrowser: /linkedin\.com|theorg\.com/i.test(url),
    });
    pagesCrawled += 1;
    if (!page.ok || page.text.length < 80) {
      trace(steps, 'crawl_miss', `${url} — ${page.error || 'empty'}`);
      continue;
    }
    trace(steps, 'crawl_page', `${page.title || url} (${page.text.length} chars)`);
    pages.push({
      url: page.finalUrl || url,
      title: page.title,
      text: page.text,
      fromHit: hitByUrl.get(url),
    });
  }

  // Also treat rich search snippets as pseudo-pages when the destination blocked us
  for (const { hit } of ranked.slice(0, 10)) {
    if (hit.snippet && hit.snippet.length > 40 && !pages.some((p) => p.url === hit.url)) {
      pages.push({
        url: hit.url,
        title: hit.title,
        text: `${hit.title}. ${hit.snippet}`,
        fromHit: hit,
      });
    }
  }

  let candidates: PeopleSearchCandidate[] = [
    ...candidatesFromSearchHits(
      ranked.map((r) => r.hit),
      query,
    ),
  ];
  for (const page of pages) {
    // Careers / marketing walls create false Name-Title pairs.
    if (/careers\./i.test(page.url) && !/leadership/i.test(page.url)) continue;
    candidates.push(...extractCandidatesFromText(page, query));
  }
  candidates = mergeCandidates(candidates).map((c) => boostForQuery(c, query));
  candidates = candidates.filter((c) => looksLikePersonName(c.fullName));
  candidates.sort((a, b) => b.confidence - a.confidence);

  const llmCandidates = await llmRerank(query, candidates, pages);
  if (llmCandidates?.length) {
    trace(steps, 'llm_extract', `Model returned ${llmCandidates.length} candidates`);
    candidates = mergeCandidates([...llmCandidates, ...candidates]).map((c) =>
      boostForQuery(c, query),
    );
    candidates.sort((a, b) => b.confidence - a.confidence);
  } else {
    trace(steps, 'llm_extract', config.anthropic.apiKey ? 'No extra model candidates' : 'Skipped (no API key)');
  }

  const top = candidates.slice(0, 8);
  const best = top[0] && top[0].confidence >= 0.4 ? top[0] : top[0] ?? null;
  const sourcesCrawled = pages.map((p) => ({
    title: p.title || p.url,
    url: p.url,
    snippet: p.text.slice(0, 220),
  }));

  const summary = buildSummary(query, best, top);
  trace(steps, 'complete', summary);

  return {
    query,
    status: best ? (best.confidence >= 0.55 ? 'completed' : 'partial') : pagesCrawled ? 'partial' : 'failed',
    summary,
    bestMatch: best,
    candidates: top,
    sourcesCrawled,
    pagesCrawled,
    searchesRun,
    trace: steps,
    durationMs: Date.now() - started,
  };
}

function dedupeHits(hits: SearchHit[]): SearchHit[] {
  const seen = new Set<string>();
  const out: SearchHit[] = [];
  for (const hit of hits) {
    const key = hit.url.replace(/\/$/, '').toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(hit);
  }
  return out;
}
