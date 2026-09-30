/**
 * Ask web search — optional public-web supplement for job chat and general Ask.
 *
 * The job file always wins. Questions about the job, its videos, people,
 * findings, or records are answered from that file. Web search is for anything
 * the file cannot answer. The model chooses when a search would help. If the
 * user explicitly asks to search or look something up, the search always runs.
 *
 * The tool calls Tavily (POST https://api.tavily.com/search, Bearer
 * TAVILY_API_KEY) when that key is set. The key is read only from
 * TAVILY_API_KEY. When it is missing, Ask falls back to Gemini Google Search
 * grounding, then DuckDuckGo, so a missing key does not turn search off.
 * ASK_WEB_SEARCH_PROVIDER=off disables search. Queries are sanitized so
 * lockbox codes, claim numbers, and street addresses are not sent upstream.
 * The API key is never logged.
 *
 * Privacy: never reverse-image-search; never identify children; never identify
 * private job-site people from photos/video.
 */

import { logger } from '../lib/logger.js';
import { googleVisionApiKey } from '../lib/visionProvider.js';

export type AskWebHit = {
  title: string;
  url: string;
  snippet: string;
};

export type AskWebSearchProvider = 'brave' | 'serper' | 'tavily' | 'gemini';

/**
 * Unicode ⟦web:…⟧ (preferred), ASCII [[web:…]], or single [web:…].
 * Matches mid-sentence so misbehaved model trailers never stay in prose.
 */
const WEB_TRAILER_RE =
  /(?:⟦\s*web:\s*([^⟧]*)\s*⟧|\[\[\s*web:\s*((?:(?!\]\]).)*)\s*\]\]|\[\s*web:\s*([^\[\]]*)\s*\])/gi;
const WEB_PAIR_RE = /([^|,][^|]*?)\|(https?:\/\/[^\s,⟧\]]+)/g;

/** Prompt block when web hits were retrieved for this turn. */
/** Prompt note when live web search ran but returned no usable hits. */
export const ASK_WEB_EMPTY_RESULTS_NOTE = `WEB SEARCH ATTEMPTED (no usable results):
- Live public web search was attempted for this question but returned no usable results (provider and fallback both empty or unavailable).
- Do NOT invent web findings, prices, business listings, URLs, or citations.
- Say clearly that no web results were found for this query, then answer only from the job file if anything applies.
- Never claim you lack a web search tool — the tool ran; it just found nothing useful.`;

export const ASK_WEB_FORMAT_RULES = `WEB (when WEB SEARCH RESULTS are provided, or you called web_search):
- The job file wins. Never replace or override a job fact, video, person, finding, or record with a web page. Never invent what happened on this job from the web.
- Use the web for anything the job file cannot answer. Do not limit yourself to a topic list.
- Never reverse-image-search, identify children, or identify private job-site people from photos/video.
- Never put web text in quotation marks and never attribute it to a speaker. Quotation marks are only for an exact transcript substring, followed by the clip name and timestamp.
- Keep web sources in their own section, separate from job evidence. After the answer, add:

**Web results**
- [Source title](https://example.com/page) — short snippet

- Cite only URLs from WEB SEARCH RESULTS or the web_search tool. Markdown links belong in that section, not in the job-evidence sentences.
- Do not write ⟦web: …⟧, [[web: …]], or [web: …]. Skip the section when you did not use the web, or when the user only asked whether you can search.`;

function trim(value: unknown): string {
  return String(value ?? '').trim();
}

function askWebSearchDisabled(): boolean {
  const forced = trim(process.env.ASK_WEB_SEARCH_PROVIDER).toLowerCase();
  return forced === 'off' || forced === 'none' || forced === 'false';
}

export function askWebSearchProvider(): AskWebSearchProvider | null {
  if (askWebSearchDisabled()) return null;
  // Tavily when its own key is set. Otherwise Gemini grounding. DuckDuckGo
  // needs no key and is not a named provider.
  if (trim(process.env.TAVILY_API_KEY)) return 'tavily';
  if (googleVisionApiKey()) return 'gemini';
  return null;
}

export function askWebSearchApiKey(provider: AskWebSearchProvider = askWebSearchProvider() ?? 'brave'): string {
  if (provider === 'gemini') {
    return googleVisionApiKey();
  }
  const generic = trim(process.env.ASK_WEB_SEARCH_API_KEY);
  if (provider === 'brave') {
    return trim(process.env.BRAVE_SEARCH_API_KEY) || generic;
  }
  if (provider === 'serper') {
    return trim(process.env.SERPER_API_KEY) || generic;
  }
  // Tavily's key is only TAVILY_API_KEY — never ASK_WEB_SEARCH_API_KEY.
  return trim(process.env.TAVILY_API_KEY);
}

/** True unless search is explicitly off. A missing Tavily key still searches. */
export function isAskWebSearchConfigured(): boolean {
  return !askWebSearchDisabled();
}

/** Prompt rules when web search is wired (Gemini grounding or Brave/Serper/Tavily). */
export function askWebCapabilityRules(): string {
  if (isAskWebSearchConfigured()) {
    return `INTERNET / WEB ACCESS:
- You CAN search the public web for anything the job file cannot answer. Topics are not restricted.
- The job file comes first. Questions about this job, its videos, people, findings, or records are answered from the job file. Web search never replaces or overrides that evidence.
- If the user asks you to search or look something up, call web_search (or use WEB SEARCH RESULTS when they are already in the prompt). Otherwise call web_search when a public fact would help and the file does not have it.
- When you search, resolve relative days ("Thursday", "this Sunday", "tomorrow", "tonight") against CURRENT DATE AND TIME and put that calendar date in the query. Pass include_domains when the user names a site (homedepot.com, lowes.com).
- Never claim you lack a live web search tool, cannot query prices, cannot access schedules, weather, or news, are offline, or unable to search the web.
- When WEB SEARCH RESULTS are provided, answer from them. Do not soft-refuse or pretend the job file is the only source for a public question.
- If asked ONLY whether you are connected to the internet or can search the web (no specific topic), answer briefly yes — job-file evidence still wins for on-job facts. Do NOT add a Web results section and do not cite google.com or how-to-search pages.
- Cite web sources only as markdown links under a **Web results** heading, separate from job evidence. Never quote a web page as a speaker.
- Still never reverse-image-search, identify children, or identify private job-site people from photos/video.`;
  }
  return `INTERNET / WEB ACCESS:
- Public web search is not configured in this environment. If asked whether you can search the internet, say you can only use this job file and in-product tools right now — do not invent web results.`;
}

/**
 * Hard privacy blocks — we refuse to search, not merely omit results.
 * Job-file Ask can still answer from proofs/transcripts.
 */
export function askWebSearchBlockedReason(question: string): string | null {
  const q = trim(question);
  if (!q) return null;

  if (
    /reverse[\s-]*image|google\s*lens|yandex\s*image|tin[ey]e|face\s*search|find\s+(this|that)\s+face|who\s+is\s+in\s+(this|the)\s+(photo|picture|image|selfie)/i.test(
      q,
    )
  ) {
    return 'reverse_image_search';
  }
  if (
    /identify\s+(this\s+|the\s+)?(child|kid|minor|boy|girl|toddler|infant)|who\s+is\s+(this|that)\s+(child|kid|boy|girl|minor)|child\s+(in\s+)?(the\s+)?(photo|picture|image|video)/i.test(
      q,
    )
  ) {
    return 'identify_child';
  }
  if (
    /who\s+is\s+(the\s+)?(person|man|woman|guy|lady|worker|crew\s*member|homeowner)\s+in\s+(the\s+)?(photo|picture|image|video|clip|footage)|identify\s+(this\s+|the\s+)?(person|face|worker)\s+(from|in)\s+(the\s+)?(photo|picture|image|video|clip)/i.test(
      q,
    )
  ) {
    return 'identify_private_person';
  }
  return null;
}

/** Capability / connectivity asks — trigger search so Ask can prove web access. */
export function looksLikeWebCapabilityAsk(question: string): boolean {
  const q = trim(question);
  if (!q) return false;
  return (
    /\b(connected to (the )?internet|have (internet|web) access|online access)\b/i.test(q) ||
    // "can you/u/ya search google", "can you search the web", "could you look up…"
    /\b(can|could)\s+(you|u|ya)\s+(search|browse|look\s*up|google|use)\b/i.test(q) ||
    /\b(are you able to|do you)\s+(search|browse|look\s*up|use)\s+(the\s+)?(web|internet|online|google)?\b/i.test(
      q,
    ) ||
    // "search the web for X", "search google for…", "search the internet…"
    /\bsearch\s+(the\s+)?(web|internet|google|online)\b/i.test(q) ||
    /\b(search|look\s*(this|it|that)?\s*up|find)\s+(online|on the web|on the internet|via google)\b/i.test(q) ||
    /\b(look\s+(this|it|that)?\s*up\s+online|google\s+(this|that|it)|web[\s-]?search)\b/i.test(q) ||
    // "google tile prices", "google IRC R905"
    /\bgoogle\s+\S+/i.test(q) ||
    // "what can you search", "what can you search for"
    /\bwhat\s+can\s+you\s+search\b/i.test(q) ||
    /\bwhat\s+(do|can)\s+you\s+(look\s*up|search\s+for)\b/i.test(q) ||
    // "find prices online", "look up cost online"
    /\b(find|look\s*up|search).{0,48}\bonline\b/i.test(q) ||
    /\bare you (online|offline|connected)\b/i.test(q)
  );
}

/**
 * Capability / connectivity only — no topical "search for X".
 * These should get a short yes without google.com homepage citations.
 */
export function looksLikePureWebCapabilityAsk(question: string): boolean {
  const q = trim(question);
  if (!q) return false;
  if (!looksLikeWebCapabilityAsk(q)) return false;

  // Connectivity / meta "what can you search"
  if (
    /\b(connected to (the )?internet|have (internet|web) access|online access)\b/i.test(q) ||
    /\bare you (online|offline|connected)\b/i.test(q) ||
    /\bwhat\s+can\s+you\s+search\b/i.test(q) ||
    /\bwhat\s+(do|can)\s+you\s+(look\s*up|search\s+for)\b/i.test(q)
  ) {
    return true;
  }

  // "can you search the web/google?" without a real topic after for/about
  const topic = q.match(
    /\b(?:search|browse|look\s*up|google|find)\s+(?:the\s+)?(?:web|internet|google|online)?\s*(?:for|about)\s+(.+)$/i,
  )?.[1];
  if (topic) {
    const t = trim(topic).replace(/[?.!]+$/, '');
    // "for me" / "for us" / "for the web" are not topics
    if (
      t &&
      !/^(me|us|this|that)$/i.test(t) &&
      !/^(the\s+)?(web|internet|google|online)$/i.test(t)
    ) {
      return false;
    }
  }

  // "google tile prices" / "search online for shingles" style — has substance after the verb
  if (/\bgoogle\s+\S+/i.test(q)) {
    const after = trim(q.replace(/^.*?\bgoogle\s+/i, '')).replace(/[?.!]+$/, '');
    if (after && !/^(it|this|that|please|now)$/i.test(after)) return false;
  }
  if (/\b(find|look\s*up|search).{0,48}\bonline\b/i.test(q) && /\bonline\s+(for|about)\s+\S+/i.test(q)) {
    return false;
  }
  if (/\bsearch\s+(the\s+)?(web|internet|google|online)\s+for\s+\S+/i.test(q)) {
    const afterFor = trim(q.replace(/^.*?\bfor\s+/i, '')).replace(/[?.!]+$/, '');
    if (
      afterFor &&
      !/^(me|us|this|that)$/i.test(afterFor) &&
      !/^(the\s+)?(web|internet|google|online)$/i.test(afterFor)
    ) {
      return false;
    }
  }

  // Bare capability: can/could/are you able / do you + search/google…
  return (
    /\b(can|could)\s+(you|u|ya)\s+(search|browse|look\s*up|google|use)\b/i.test(q) ||
    /\b(are you able to|do you)\s+(search|browse|look\s*up|use)\s+(the\s+)?(web|internet|online|google)?\b/i.test(
      q,
    ) ||
    /\b(search|look\s*(this|it|that)?\s*up|find)\s+(online|on the web|on the internet|via google)\s*[?.!]*$/i.test(
      q,
    ) ||
    /\bweb[\s-]?search\s*[?.!]*$/i.test(q) ||
    /\bsearch\s+(the\s+)?(web|internet|google|online)\s*[?.!]*$/i.test(q)
  );
}

/**
 * Deterministic 1–3 sentence reply for capability-only asks.
 * Avoids LLM star soup and google.com junk citations entirely.
 */
export function professionalWebCapabilityAnswer(question?: string): string {
  const q = trim(question ?? '').toLowerCase();
  if (!isAskWebSearchConfigured()) {
    return (
      'I can only use this job file and in-product tools right now — public web search is not configured in this environment. ' +
      'Ask about anything on the file and I will ground the answer there.'
    );
  }

  if (/\bwhat\s+(can|do)\s+you\s+(search|look\s*up)/i.test(q)) {
    return (
      'Yes — I can search the public web for outside knowledge like codes, products, manufacturers, standards, prices, weather, news, and sports schedules. ' +
      'Job-file evidence still always wins for on-job facts. ' +
      'Tell me what you want looked up and I will search for it.'
    );
  }

  return (
    'Yes — I can search the public web for outside knowledge when you need it. ' +
    'Job-file evidence still always wins for on-job facts. ' +
    'Want me to look something specific up?'
  );
}

/**
 * Live topical asks that need the public web (not the job file): sports
 * schedules/scores, weather, news/current events, and broad product lookups.
 * Deliberately avoids job-schedule wording ("what is the schedule on this job").
 */
export function looksLikeLiveTopicalAsk(question: string): boolean {
  const q = trim(question);
  if (!q) return false;

  // Sports leagues / games on today / scores (NFL screenshot refusal case)
  if (
    /\b(NFL|NBA|MLB|NHL|MLS|NCAA|WNBA|PGA|UFC|Premier\s+League|World\s+Cup|Super\s+Bowl)\b/i.test(q) ||
    /\b(football|basketball|baseball|hockey|soccer|tennis)\s+(games?|scores?|schedule|standings|match(es)?)\b/i.test(
      q,
    ) ||
    /\b(games?|matches?)\s+(on|today|tonight|this\s+(week|weekend)|tomorrow)\b/i.test(q) ||
    /\b(sports?)\s+(schedule|scores?|standings|games?|on\s+today)\b/i.test(q) ||
    /\bwhat\s+(nfl|nba|mlb|nhl)?\s*games?\s+(are\s+)?(on|playing)\b/i.test(q) ||
    /\bwho\s+(is\s+)?(playing|won)\b/i.test(q)
  ) {
    return true;
  }

  // Weather
  if (
    /\b(weather|forecast|temperature|radar)\b/i.test(q) &&
    /\b(today|tonight|tomorrow|this\s+week|weekend|in\s+\w+|outside|will\s+it)\b/i.test(q)
  ) {
    return true;
  }
  if (/\b(what('s|\s+is)\s+the\s+)?weather\b/i.test(q)) return true;
  if (/\b(will\s+it\s+rain|chance\s+of\s+rain|uv\s+index)\b/i.test(q)) return true;

  // News / current events / headlines
  if (
    /\b(breaking\s+news|latest\s+news|headlines|current\s+events|news\s+today)\b/i.test(q) ||
    /\b(news|headline)s?\s+(about|on|for)\b/i.test(q) ||
    /\bwhat('s|\s+is)\s+(happening|going\s+on)\s+(in\s+the\s+news|today)\b/i.test(q)
  ) {
    return true;
  }

  // Broader public product lookups (SKU / buy / where to get) beyond codes/how-to
  if (
    /\b(where\s+(can|do)\s+I\s+(buy|get|find)|buy\s+online|amazon|home\s*depot|lowe'?s|grainger)\b/i.test(
      q,
    ) ||
    /\b(product\s+lookup|model\s+(number|#)|SKU|UPC)\b/i.test(q)
  ) {
    return true;
  }

  return false;
}

/** Outside-knowledge asks that benefit from the public web. */
export function looksLikeOutsideKnowledgeAsk(question: string): boolean {
  const q = trim(question);
  if (!q) return false;
  if (looksLikeWebCapabilityAsk(q)) return true;
  if (looksLikeLiveTopicalAsk(q)) return true;
  return looksLikeOutsideKnowledgeSubject(q);
}

/** @deprecated alias — prefer shouldSupplementWithWebSearch */
export function shouldSearchAskWeb(question: string, grounded: string): boolean {
  return shouldSupplementWithWebSearch(question, grounded);
}

/** Ask resolves relative days in this zone unless the caller passes another IANA zone. */
export const ASK_USER_TIME_ZONE = 'America/Chicago';

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;

type ZonedYmd = { year: number; month: number; day: number; weekday: string };

function zonedYmd(now: Date, timeZone: string): ZonedYmd {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'long',
  });
  const bag = Object.fromEntries(fmt.formatToParts(now).map((part) => [part.type, part.value]));
  return {
    year: Number(bag.year),
    month: Number(bag.month),
    day: Number(bag.day),
    weekday: String(bag.weekday ?? '').toLowerCase(),
  };
}

function addCalendarDays(ymd: ZonedYmd, days: number): ZonedYmd {
  const utc = new Date(Date.UTC(ymd.year, ymd.month - 1, ymd.day + days, 18, 0, 0));
  return zonedYmd(utc, 'UTC');
}

function longDate(ymd: ZonedYmd): string {
  const utc = new Date(Date.UTC(ymd.year, ymd.month - 1, ymd.day, 18, 0, 0));
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(utc);
}

function daysInMonth(month: number): number {
  return [0, 31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month] ?? 0;
}

function plausibleMonthDay(month: number, day: number): boolean {
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(month);
}

/** A weekday or "on"/"dated" makes 10/8 a date. "3/4 inch" stays a size. */
function numericDateContext(query: string, index: number, length: number): boolean {
  const before = query.slice(Math.max(0, index - 32), index);
  const after = query.slice(index + length, index + length + 24);
  if (
    /^(?:\s*["″]|[\s-]*(?:inch(?:es)?|in\.?|ft|foot|feet|mm|cm|plywood|osb|drywall|shingle|board|sheet|lumber|thick|gauge|pitch|tab)\b)/i.test(
      after,
    )
  ) {
    return false;
  }
  return (
    /\b(?:on|dated|date|due|scheduled)\s*$/i.test(before) ||
    /\b(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b\s*,?\s*$/i.test(before)
  );
}

function weekdayIndex(name: string): number {
  return WEEKDAYS.indexOf(name.toLowerCase() as (typeof WEEKDAYS)[number]);
}

/**
 * Days until the named weekday. "this"/bare means the upcoming one, including
 * today. "next" means the same, except when today is that weekday, then +7.
 */
function daysUntilWeekday(today: string, target: string, mode: 'this' | 'next'): number {
  const from = weekdayIndex(today);
  const to = weekdayIndex(target);
  if (from < 0 || to < 0) return 0;
  let delta = (to - from + 7) % 7;
  if (mode === 'next' && delta === 0) delta = 7;
  return delta;
}

/** Clock line for the system prompt. Defaults to America/Chicago. */
export function askClockSystemRules(now: Date = new Date(), timeZone: string = ASK_USER_TIME_ZONE): string {
  const zone = trim(timeZone) || ASK_USER_TIME_ZONE;
  let when = '';
  try {
    const date = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    }).format(now);
    const time = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    }).format(now);
    when = `${date}, ${time}`;
  } catch {
    when = now.toISOString();
  }
  return `CURRENT DATE AND TIME: ${when} (${zone}).
Resolve relative days against this clock before you answer or search. "Thursday" means the upcoming Thursday, or today if it is Thursday. "this Sunday" means the upcoming Sunday, or today if it is Sunday. "tomorrow" and "tonight" use this clock. When you call web_search, the query must include that calendar date (for example "NFL game Thursday, October 1, 2026"), not only the weekday.`;
}

/**
 * Rewrite a search query so "Thursday" / "this Sunday" / "tomorrow" include the
 * calendar date in the user's timezone (America/Chicago by default).
 */
/** A calendar date already written in the query. Bare weekdays, fractions, and ranges are not dates. */
function hasExplicitCalendarDate(query: string): boolean {
  if (
    /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?\b/i.test(
      query,
    )
  ) {
    return true;
  }
  for (const match of query.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    if (plausibleMonthDay(Number(match[2]), Number(match[3]))) return true;
  }
  // M/D/YYYY or M-D-YYYY. A hyphen pair with no year (2-3) is a range.
  for (const match of query.matchAll(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b/g)) {
    const yearRaw = match[3] ?? '';
    const year = Number(yearRaw);
    const yearOk = yearRaw.length === 4 ? year >= 1900 && year <= 2100 : yearRaw.length === 2;
    if (yearOk && plausibleMonthDay(Number(match[1]), Number(match[2]))) return true;
  }
  // Bare M/D. 3/4 and 5/8 are sizes unless the words around them are a date.
  for (const match of query.matchAll(/\b(\d{1,2})\/(\d{1,2})\b/g)) {
    const month = Number(match[1]);
    const day = Number(match[2]);
    if (!plausibleMonthDay(month, day)) continue;
    if (day <= 12 && !numericDateContext(query, match.index ?? 0, match[0].length)) continue;
    return true;
  }
  return false;
}

/**
 * The weekday or relative day is already tied to a calendar date
 * ("Thursday, October 8, 2026", "Thursday night, October 8").
 * A size such as 3/4 does not count.
 */
function relativeDayAlreadyDated(text: string, index: number, length: number): boolean {
  const after = text.slice(index + length, index + length + 64);
  const before = text.slice(Math.max(0, index - 64), index);
  const afterCore = after.replace(
    /^\s*(?:(?:,|\(|-|–|—|:)\s*)?(?:(?:on|night|morning|evening|afternoon|game|games)\b\s*,?\s*){0,2}/i,
    '',
  );
  const beforeCore = before.replace(
    /(?:\s*,?\s*(?:on|night|morning|evening|afternoon|game|games)\b){0,2}\s*(?:(?:,|\)|-|–|—|:)\s*)?$/i,
    '',
  );
  return hasExplicitCalendarDate(afterCore) || hasExplicitCalendarDate(beforeCore);
}

export function resolveAskSearchQuery(
  query: string,
  now: Date = new Date(),
  timeZone: string = ASK_USER_TIME_ZONE,
): string {
  const original = trim(query);
  if (!original) return original;
  // An explicit date stays as written. Do not append a weekday's next occurrence.
  if (hasExplicitCalendarDate(original)) return original;
  const zone = trim(timeZone) || ASK_USER_TIME_ZONE;
  let today: ZonedYmd;
  try {
    today = zonedYmd(now, zone);
  } catch {
    return original;
  }
  const notes: string[] = [];
  const add = (ymd: ZonedYmd) => {
    const label = longDate(ymd);
    if (!original.includes(label) && !notes.includes(label)) notes.push(label);
  };

  const rel =
    /\b(today|tonight|tomorrow|yesterday)\b|\b(this|next)\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b|\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/gi;
  let match: RegExpExecArray | null;
  while ((match = rel.exec(original)) !== null) {
    if (relativeDayAlreadyDated(original, match.index, match[0].length)) continue;
    if (match[1]) {
      const word = match[1].toLowerCase();
      const delta = word === 'tomorrow' ? 1 : word === 'yesterday' ? -1 : 0;
      add(addCalendarDays(today, delta));
      continue;
    }
    if (match[2] && match[3]) {
      add(addCalendarDays(today, daysUntilWeekday(today.weekday, match[3], match[2].toLowerCase() === 'next' ? 'next' : 'this')));
      continue;
    }
    if (match[4]) {
      add(addCalendarDays(today, daysUntilWeekday(today.weekday, match[4], 'this')));
    }
  }
  if (!notes.length) return original;
  return `${original} (${notes.join('; ')})`.slice(0, 400);
}

/** Hostnames the user named, plus any the model passed. Empty when none. */
export function includeDomainsForAsk(question: string, explicit?: unknown): string[] {
  const out: string[] = [];
  const push = (raw: unknown) => {
    let host = trim(raw).toLowerCase();
    if (!host) return;
    host = host.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0] ?? '';
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) return;
    if (!out.includes(host)) out.push(host);
  };
  if (Array.isArray(explicit)) {
    for (const item of explicit) push(item);
  } else if (typeof explicit === 'string') {
    for (const item of explicit.split(/[,\s]+/)) push(item);
  }
  if (/home\s*depot/i.test(question)) push('homedepot.com');
  if (/lowe'?s/i.test(question)) push('lowes.com');
  return out.slice(0, 8);
}

/**
 * The user asked to search or look something up (any topic).
 * Capability-only questions ("can you search?") are not a request to run one.
 * "Search the transcript" stays on the job file.
 */
export function looksLikeExplicitWebSearchRequest(question: string): boolean {
  const q = trim(question);
  if (!q || looksLikePureWebCapabilityAsk(q)) return false;
  if (
    /\b(search|look\s*up|lookup)\s+(the\s+)?(transcript|clip|clips|video|videos|job file|file|notes|recordings)\b/i.test(
      q,
    ) &&
    !/\b(web|internet|google|online)\b/i.test(q)
  ) {
    return false;
  }
  return (
    /\b(search(?:\s+the)?(?:\s+web|\s+internet|\s+google)?|look\s*(?:this|it|that)?\s*up|lookup|google)\b/i.test(q) ||
    /\b(find|check)\s+(?:online|on the (?:web|internet))\b/i.test(q) ||
    /\bweb[\s-]?search\b/i.test(q)
  );
}

function looksLikeSmallTalk(question: string): boolean {
  return /^(?:hi|hey|hello|hiya|thanks|thank you|thx|ty|ok|okay|got it|cool|sounds good)[.!?\s]*$/i.test(
    trim(question),
  );
}

/** Codes, prices, and how-to subjects. A bare "search the web" is not a subject. */
function looksLikeOutsideKnowledgeSubject(question: string): boolean {
  const q = trim(question);
  if (!q) return false;
  return (
    /\b(IRC|IBC|NEC|IMC|IPC|IECC|ASTM|UL\s*\d|NFPA|OSHA)\b/i.test(q) ||
    /\b(building|electrical|plumbing|mechanical|fire)\s+code\b/i.test(q) ||
    /\b(manufacturer|product\s*(spec|data|sheet)|data\s*sheet|SDS|MSDS|spec\s*sheet)\b/i.test(q) ||
    /\b(install(?:ation)?\s+(guide|instructions|manual)|how\s+(do|to|should)\s+I\b|what\s+does\s+.+\s+mean)\b/i.test(
      q,
    ) ||
    /\b(R-?value|gauge\s+steel|nail\s+pattern|flashing\s+detail|underlayment\s+spec)\b/i.test(q) ||
    /\b(warranty|standard\s+practice|best\s+practice|code\s+requirement)\b/i.test(q) ||
    /\bwho\s+makes\b|\bwho\s+manufactures\b|\bpart\s*#?\s*\d/i.test(q) ||
    /\b(tile|material|lumber|shingle|roofing|flooring|paint|supply|product|labor)\s+(prices?|pricing|cost|costs)\b/i.test(
      q,
    ) ||
    /\b(prices?|pricing|cost|costs)\s+(for|of)\s+\w+/i.test(q) ||
    /\bhow\s+much\s+(does|do|is|are)\b/i.test(q) ||
    /\b(market|retail|wholesale)\s+(price|cost|rate)\b/i.test(q) ||
    /\b(going\s+rate|price\s+check)\b/i.test(q)
  );
}

function looksLikePublicTopic(question: string): boolean {
  return looksLikeLiveTopicalAsk(question) || looksLikeOutsideKnowledgeSubject(question);
}

/**
 * Questions the job file is supposed to answer: this job's videos, people,
 * findings, or records. Shared words (job, claim, permit, homeowner, "how
 * many", "what did") do not by themselves make a public question job-only.
 */
const PUBLIC_JOB_TAIL =
  'market|markets|opening|openings|posting|postings|board|boards|description|descriptions|title|titles|listing|listings|growth|report|reports|cuts|creation|losses';

/** "the job market" is public. "this job" and "the job file" are this file. */
function mentionsThisJobRecord(q: string): boolean {
  if (new RegExp(`\\b(?:the|this|our|my)\\s+job\\s+(?:${PUBLIC_JOB_TAIL})\\b`, 'i').test(q)) return false;
  if (/\b(?:this|our|my)\s+(?:job|file|claim|permit|visit|notes?|evidence|scope)\b/i.test(q)) return true;
  if (/\bthe\s+(?:job\s+file|file|claim|visit|notes?|evidence|scope)\b/i.test(q)) return true;
  if (/\bthe\s+job\b/i.test(q)) return true;
  if (/\b(?:on|in)\s+(?:this|the|our)\s+(?:job|file)\b/i.test(q)) return true;
  return false;
}

/**
 * Questions about this recording: what was said, what happened, a timestamp,
 * or whether something in the clip is on. A public subject ("is the game on")
 * is not one of these.
 */
function asksAboutThisRecording(q: string): boolean {
  if (looksLikeLiveTopicalAsk(q)) return false;
  return (
    /\b(time ?stamps?)\b/i.test(q) ||
    /\bwhat was said\b/i.test(q) ||
    /\bwhat are they talking about\b/i.test(q) ||
    /\btalking about\b/i.test(q) ||
    /\bdid (?:they|he|she|anyone|anything)\b/i.test(q) ||
    /\b(?:anyone|they|he|she) mention(?:ed)?\b/i.test(q) ||
    /\bagree(?:d)? on\b/i.test(q) ||
    /\bis the (?:tv|light|fan|switch|screen|power|water|heater|ac|heat) (?:on|off)\b/i.test(q) ||
    /\b(?:the|this) worker\b/i.test(q) ||
    /\b(?:in|on) (?:the|this) (?:clip|video|recording|footage)\b/i.test(q)
  );
}

export function asksAboutJobFile(question: string): boolean {
  const q = trim(question);
  if (!q) return false;
  if (asksAboutThisRecording(q)) return true;
  const publicTopic = looksLikePublicTopic(q);
  // These name this file's records even when the user also says "search".
  if (/\b(lockbox|transcript|punch|access roster|on site|work logs?)\b/i.test(q)) return true;
  if (/\b(clips?|videos?|footage|recordings?|mic|crew|speaker|findings?)\b/i.test(q)) {
    if (publicTopic && !/\b(this|the|our|my)\s+(?:clip|video|recording|transcript|job|file)\b/i.test(q)) {
      return false;
    }
    return true;
  }
  if (/\bhomeowner\s+(?:said|says|say|asked|told)\b/i.test(q)) return true;
  if (/\b(?:what did|who said)\b/i.test(q) && /\b(?:homeowner|adjuster|crew|speaker|tech|guy|they|he|she|anyone)\b/i.test(q)) {
    return true;
  }
  if (mentionsThisJobRecord(q) && !publicTopic) return true;
  if (/\b(?:the|this|our|my)\s+homeowner\b/i.test(q) && !publicTopic) return true;
  if (/\b(?:the|this|our|my)\s+permit\b/i.test(q) && !publicTopic) return true;
  if (/\b(?:job|claim|permit)\s*(?:#|number|num)\b/i.test(q)) return true;
  if (
    /\bhow many\b/i.test(q) &&
    /\b(?:clips?|videos?|lines?|notes?|findings?|speakers?|quotes?|people|tasks?)\b/i.test(q) &&
    !publicTopic
  ) {
    return true;
  }
  if (/\b(?:this|the|our)\s+(?:visit|day)\b/i.test(q) && !publicTopic) return true;
  return false;
}

export function looksLikeJobEvidenceQuestion(question: string): boolean {
  if (looksLikeExplicitWebSearchRequest(question)) return false;
  return asksAboutJobFile(question);
}

/**
 * Run web search for anything the job file is not meant to answer, and always
 * when the user asks to search or look something up. Job evidence questions
 * are not auto-searched — the model may still call web_search, and the answer
 * must not let the web override the file. Topics are not restricted.
 */
export function shouldSupplementWithWebSearch(question: string, grounded = ''): boolean {
  void grounded;
  if (askWebSearchBlockedReason(question)) return false;
  if (!isAskWebSearchConfigured()) return false;
  if (looksLikePureWebCapabilityAsk(question)) return false;
  if (looksLikeSmallTalk(question)) return false;
  if (looksLikeExplicitWebSearchRequest(question)) return true;
  if (looksLikeJobEvidenceQuestion(question)) return false;
  return true;
}

/**
 * Strip job PII before upstream search — lockbox codes, claim/policy numbers,
 * street addresses, long digit runs.
 */
export function sanitizeAskWebQuery(question: string): string {
  let q = trim(question);
  if (!q) return q;
  q = q.replace(/\b(lockbox|gate|access|code|pin|password)\b[^.,;?\n]{0,40}\b\d{3,}\b/gi, '$1');
  q = q.replace(/\b(CLM|claim|policy|permit)[-#:\s]*[A-Z0-9-]{4,}\b/gi, '$1');
  q = q.replace(/\b\d{1,5}\s+[A-Za-z0-9.' -]{2,40}\b(?:Ave|Avenue|St|Street|Rd|Road|Dr|Drive|Blvd|Ln|Lane|Ct|Court|Way|Cir|Circle)\b\.?/gi, '');
  q = q.replace(/\b\d{5}(?:-\d{4})?\b/g, '');
  q = q.replace(/\b(?:\d[ -]*?){10,}\b/g, '');
  return q.replace(/\s{2,}/g, ' ').trim().slice(0, 240);
}

function hostnameFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '') || '';
  } catch {
    return '';
  }
}

function titleForHit(title: string, url: string): string {
  const t = trim(title);
  if (t) return t;
  return hostnameFromUrl(url) || 'Web result';
}

function pushHit(hits: AskWebHit[], next: AskWebHit | null) {
  if (!next) return;
  const url = trim(next.url);
  if (!url) return;
  if (!/^https?:\/\//i.test(url)) return;
  if (hits.some((h) => h.url === url)) return;
  hits.push({
    title: titleForHit(next.title, url).slice(0, 160),
    url: url.slice(0, 500),
    snippet: trim(next.snippet).slice(0, 400),
  });
}

const TAVILY_SEARCH_URL = 'https://api.tavily.com/search';
const TAVILY_TIMEOUT_MS = 9_000;
const TAVILY_MAX_RESULTS = 5;

let askWebSearchCount = 0;

function redactSecrets(detail: string): string {
  const key = trim(process.env.TAVILY_API_KEY);
  let out = detail.replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').replace(/tvly-[A-Za-z0-9_-]+/g, '[redacted]');
  if (key) out = out.split(key).join('[redacted]');
  return out;
}

export type AskWebSearchOutcome = {
  hits: AskWebHit[];
  /** Tavily's short answer, when the API returned one. */
  answer: string;
};

async function searchTavily(
  query: string,
  apiKey: string,
  limit: number,
  fetchFn: typeof fetch,
  includeDomains?: string[],
): Promise<AskWebSearchOutcome> {
  const maxResults = Math.min(Math.max(limit, 1), TAVILY_MAX_RESULTS);
  const body: Record<string, unknown> = {
    query,
    search_depth: 'basic',
    max_results: maxResults,
    include_answer: true,
  };
  if (includeDomains?.length) body.include_domains = includeDomains;
  const res = await fetchFn(TAVILY_SEARCH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TAVILY_TIMEOUT_MS),
  });
  if (!res.ok) {
    const errBody = (await res.text().catch(() => '')).slice(0, 240);
    throw new Error(`tavily_search_${res.status}:${redactSecrets(errBody)}`);
  }
  const payload = (await res.json()) as {
    answer?: string;
    results?: Array<{ title?: string; url?: string; content?: string }>;
  };
  const hits: AskWebHit[] = [];
  for (const row of payload.results ?? []) {
    pushHit(hits, {
      title: trim(row.title),
      url: trim(row.url),
      snippet: trim(row.content),
    });
    if (hits.length >= maxResults) break;
  }
  return { hits, answer: trim(payload.answer).slice(0, 1200) };
}

/** Prefer ASK_WEB_SEARCH_MODEL; never inherit verification models that may lack google_search. */
export function geminiWebSearchModel(): string {
  const forced = trim(process.env.ASK_WEB_SEARCH_MODEL);
  if (forced) return forced;
  return 'gemini-2.5-flash';
}

function geminiWebSearchBaseUrl(): string {
  return (process.env.GOOGLE_BASE_URL || 'https://generativelanguage.googleapis.com').replace(/\/+$/, '');
}

type GeminiGroundingChunk = {
  web?: { uri?: string; title?: string; snippet?: string };
};
type GeminiGroundingSupport = {
  groundingChunkIndices?: number[];
  segment?: { text?: string };
};
type GeminiGeneratePayload = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    groundingMetadata?: {
      groundingChunks?: GeminiGroundingChunk[];
      groundingSupports?: GeminiGroundingSupport[];
      webSearchQueries?: string[];
    };
  }>;
};

/** Parse {"hits":[{title,url,snippet}]} (or a bare array) from model text. */
export function parseGeminiAskWebHitsJson(raw: string, limit = 5): AskWebHit[] {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return [];
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fence?.[1] ?? trimmed).trim();
  const startObj = body.indexOf('{');
  const startArr = body.indexOf('[');
  let data: unknown;
  try {
    if (startObj >= 0 && (startArr < 0 || startObj < startArr)) {
      const end = body.lastIndexOf('}');
      if (end <= startObj) return [];
      data = JSON.parse(body.slice(startObj, end + 1));
    } else if (startArr >= 0) {
      const end = body.lastIndexOf(']');
      if (end <= startArr) return [];
      data = JSON.parse(body.slice(startArr, end + 1));
    } else {
      return [];
    }
  } catch {
    return [];
  }
  const rows: unknown[] = Array.isArray(data)
    ? data
    : Array.isArray((data as { hits?: unknown }).hits)
      ? ((data as { hits: unknown[] }).hits)
      : Array.isArray((data as { results?: unknown }).results)
        ? ((data as { results: unknown[] }).results)
        : [];
  const hits: AskWebHit[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    pushHit(hits, {
      title: trim(r.title ?? r.name),
      url: trim(r.url ?? r.link ?? r.uri),
      snippet: trim(r.snippet ?? r.description ?? r.content ?? ''),
    });
    if (hits.length >= limit) break;
  }
  return hits;
}

function collectUrisFromUnknown(value: unknown, into: Set<string>, depth = 0) {
  if (depth > 6 || value == null) return;
  if (typeof value === 'string') {
    const s = value.trim();
    if (/^https?:\/\//i.test(s)) into.add(s);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectUrisFromUnknown(item, into, depth + 1);
    return;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    for (const key of ['uri', 'url', 'link', 'web']) {
      if (key in obj) collectUrisFromUnknown(obj[key], into, depth + 1);
    }
    if (obj.web && typeof obj.web === 'object') {
      collectUrisFromUnknown(obj.web, into, depth + 1);
    }
  }
}

function hitsFromGeminiGrounding(payload: GeminiGeneratePayload, limit: number): AskWebHit[] {
  const meta = payload.candidates?.[0]?.groundingMetadata;
  const chunks = meta?.groundingChunks ?? [];
  const supports = meta?.groundingSupports ?? [];
  const hits: AskWebHit[] = [];

  for (const chunk of chunks) {
    const web = chunk.web;
    if (!web) continue;
    pushHit(hits, {
      title: trim(web.title),
      url: trim(web.uri),
      snippet: trim(web.snippet),
    });
    if (hits.length >= limit) break;
  }

  if (hits.length < limit) {
    for (const support of supports) {
      const indices = support.groundingChunkIndices ?? [];
      const segmentText = trim(support.segment?.text);
      for (const idx of indices) {
        const web = chunks[idx]?.web;
        if (!web?.uri) continue;
        const existing = hits.find((h) => h.url === trim(web.uri));
        if (existing && !existing.snippet && segmentText) {
          existing.snippet = segmentText.slice(0, 400);
        } else if (!existing) {
          pushHit(hits, {
            title: trim(web.title),
            url: trim(web.uri),
            snippet: segmentText,
          });
        }
        if (hits.length >= limit) break;
      }
      if (hits.length >= limit) break;
    }
  }

  if (hits.length < limit && meta) {
    const uris = new Set<string>();
    collectUrisFromUnknown(meta, uris);
    for (const uri of uris) {
      pushHit(hits, { title: '', url: uri, snippet: '' });
      if (hits.length >= limit) break;
    }
  }

  return hits;
}

/** Gemini generateContent + Google Search grounding. Used when Tavily's key is missing. */
async function searchGemini(
  query: string,
  apiKey: string,
  limit: number,
  fetchFn: typeof fetch,
): Promise<AskWebHit[]> {
  const model = geminiWebSearchModel();
  const url = `${geminiWebSearchBaseUrl()}/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const system = [
    'You search the public web and return citation-ready hits.',
    `Reply JSON only: {"hits":[{"title":"...","url":"https://...","snippet":"..."}]} with up to ${limit} results.`,
    'Prefer official codes, manufacturer docs, and standards. Never invent URLs.',
    'Never reverse-image-search or identify private people.',
  ].join(' ');
  const body = {
    system_instruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: `Search the public web for:\n${query}` }] }],
    tools: [{ google_search: {} }],
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 2048,
    },
  };
  const res = await fetchFn(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const errBody = (await res.text().catch(() => '')).slice(0, 240);
    throw new Error(`gemini_search_${res.status}:${redactSecrets(errBody)}`);
  }
  const payload = (await res.json()) as GeminiGeneratePayload;
  const fromGrounding = hitsFromGeminiGrounding(payload, limit);
  const text = (payload.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('\n');
  const fromJson = parseGeminiAskWebHitsJson(text, limit);
  const hits: AskWebHit[] = [];
  for (const hit of [...fromGrounding, ...fromJson]) {
    pushHit(hits, hit);
    if (hits.length >= limit) break;
  }
  return hits;
}

const DDG_UA =
  'Mozilla/5.0 (compatible; AtmosphereAsk/1.0; +https://atmosphereteam.com)';

/** Unwrap DuckDuckGo redirect links (uddg=) to the destination URL. */
export function unwrapDuckDuckGoUrl(href: string): string {
  const raw = trim(href).replace(/&amp;/g, '&');
  if (!raw) return '';
  try {
    const abs = raw.startsWith('//') ? `https:${raw}` : raw;
    const u = new URL(abs, 'https://duckduckgo.com');
    const uddg = u.searchParams.get('uddg');
    if (uddg) {
      const decoded = decodeURIComponent(uddg);
      if (/^https?:\/\//i.test(decoded)) return decoded;
    }
  } catch {
    /* fall through */
  }
  if (/^https?:\/\//i.test(raw) && !/duckduckgo\.com\/l\/?\?/i.test(raw)) {
    return raw;
  }
  return '';
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => {
      const code = Number(n);
      return Number.isFinite(code) ? String.fromCharCode(code) : _;
    });
}

function stripTags(s: string): string {
  return decodeHtmlEntities(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/** Parse DuckDuckGo HTML / lite result pages into AskWebHit[]. */
export function parseDuckDuckGoHtml(html: string, limit = 5): AskWebHit[] {
  const hits: AskWebHit[] = [];
  const src = String(html || '');
  if (!src) return hits;

  // html.duckduckgo.com: <a class="result__a" href="...">Title</a>
  const resultA = /<a[^>]*\bclass="[^"]*\bresult__a\b[^"]*"[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  const blocks: Array<{ url: string; title: string; index: number }> = [];
  while ((m = resultA.exec(src)) !== null) {
    const url = unwrapDuckDuckGoUrl(m[1] ?? '');
    const title = stripTags(m[2] ?? '');
    if (url) blocks.push({ url, title, index: m.index });
  }

  // lite.duckduckgo.com fallback: class="result-link"
  if (!blocks.length) {
    const lite = /<a[^>]*\bclass="[^"]*\bresult-link\b[^"]*"[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    while ((m = lite.exec(src)) !== null) {
      const url = unwrapDuckDuckGoUrl(m[1] ?? '');
      const title = stripTags(m[2] ?? '');
      if (url) blocks.push({ url, title, index: m.index });
    }
  }

  for (const block of blocks) {
    // Snippet: nearest result__snippet after this link
    const window = src.slice(block.index, block.index + 1200);
    const snipMatch =
      window.match(/class="[^"]*\bresult__snippet\b[^"]*"[^>]*>([\s\S]*?)<\/a>/i) ||
      window.match(/class="[^"]*\bresult-snippet\b[^"]*"[^>]*>([\s\S]*?)<\//i);
    const snippet = snipMatch ? stripTags(snipMatch[1] ?? '') : '';
    pushHit(hits, { title: block.title, url: block.url, snippet });
    if (hits.length >= limit) break;
  }

  return hits;
}

function hitsFromDuckDuckGoInstantAnswer(body: unknown, limit: number): AskWebHit[] {
  const hits: AskWebHit[] = [];
  if (!body || typeof body !== 'object') return hits;
  const data = body as {
    AbstractURL?: string;
    AbstractText?: string;
    Heading?: string;
    Results?: Array<{ FirstURL?: string; Text?: string }>;
    RelatedTopics?: Array<{ FirstURL?: string; Text?: string; Topics?: Array<{ FirstURL?: string; Text?: string }> }>;
  };

  const pushTopic = (firstUrl?: string, text?: string) => {
    const url = trim(firstUrl);
    if (!url) return;
    const label = trim(text);
    const title = label.includes(' - ') ? label.split(' - ')[0]!.trim() : label;
    const snippet = label.includes(' - ') ? label.slice(label.indexOf(' - ') + 3).trim() : '';
    pushHit(hits, { title, url, snippet });
  };

  if (trim(data.AbstractURL)) {
    pushHit(hits, {
      title: trim(data.Heading),
      url: trim(data.AbstractURL),
      snippet: trim(data.AbstractText),
    });
  }
  for (const row of data.Results ?? []) {
    pushTopic(row.FirstURL, row.Text);
    if (hits.length >= limit) return hits;
  }
  for (const topic of data.RelatedTopics ?? []) {
    if (topic.FirstURL) pushTopic(topic.FirstURL, topic.Text);
    for (const nested of topic.Topics ?? []) {
      pushTopic(nested.FirstURL, nested.Text);
      if (hits.length >= limit) return hits;
    }
    if (hits.length >= limit) return hits;
  }
  return hits;
}

/**
 * DuckDuckGo fallback — Instant Answer JSON + HTML scrape.
 * No API key. Timeout ~10s. Soft-fails to [] on network/parse errors.
 */
export async function searchDuckDuckGo(
  query: string,
  limit: number,
  fetchFn: typeof fetch,
): Promise<AskWebHit[]> {
  const hits: AskWebHit[] = [];
  const q = trim(query);
  if (!q) return hits;

  // 1) Instant Answer (often sparse for local queries — still free structured URLs)
  try {
    const iaUrl = new URL('https://api.duckduckgo.com/');
    iaUrl.searchParams.set('q', q);
    iaUrl.searchParams.set('format', 'json');
    iaUrl.searchParams.set('no_html', '1');
    iaUrl.searchParams.set('skip_disambig', '1');
    const iaRes = await fetchFn(iaUrl, {
      headers: { Accept: 'application/json', 'User-Agent': DDG_UA },
      signal: AbortSignal.timeout(10_000),
    });
    if (iaRes.ok) {
      const iaBody = await iaRes.json().catch(() => null);
      for (const hit of hitsFromDuckDuckGoInstantAnswer(iaBody, limit)) {
        pushHit(hits, hit);
        if (hits.length >= limit) return hits;
      }
    } else {
      logger.info('ask_web_search_ddg_ia_status', {
        status: iaRes.status,
        body: (await iaRes.text().catch(() => '')).slice(0, 160),
      });
    }
  } catch (err) {
    const detail = (err instanceof Error ? err.message : String(err)).slice(0, 160);
    logger.info('ask_web_search_ddg_ia_failed', { detail });
  }

  // 2) HTML scrape (primary source of organic results)
  const htmlEndpoints: Array<{ url: string; method: 'GET' | 'POST'; body?: string }> = [
    {
      url: `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`,
      method: 'GET',
    },
    {
      url: 'https://html.duckduckgo.com/html/',
      method: 'POST',
      body: `q=${encodeURIComponent(q)}&b=`,
    },
    {
      url: `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(q)}`,
      method: 'GET',
    },
  ];

  for (const endpoint of htmlEndpoints) {
    if (hits.length >= limit) break;
    try {
      const res = await fetchFn(endpoint.url, {
        method: endpoint.method,
        headers: {
          Accept: 'text/html',
          'User-Agent': DDG_UA,
          ...(endpoint.method === 'POST'
            ? { 'Content-Type': 'application/x-www-form-urlencoded' }
            : {}),
        },
        body: endpoint.body,
        signal: AbortSignal.timeout(10_000),
        redirect: 'follow',
      });
      if (!res.ok) {
        logger.info('ask_web_search_ddg_html_status', {
          status: res.status,
          endpoint: endpoint.url.slice(0, 80),
          body: (await res.text().catch(() => '')).slice(0, 160),
        });
        continue;
      }
      const html = await res.text();
      for (const hit of parseDuckDuckGoHtml(html, limit)) {
        pushHit(hits, hit);
        if (hits.length >= limit) break;
      }
      if (hits.length) break;
    } catch (err) {
      const detail = (err instanceof Error ? err.message : String(err)).slice(0, 160);
      logger.info('ask_web_search_ddg_html_failed', {
        detail,
        endpoint: endpoint.url.slice(0, 80),
      });
    }
  }

  return hits.slice(0, limit);
}

export type AskWebSearchOptions = {
  fetchFn?: typeof fetch;
  limit?: number;
  includeDomains?: string[];
  /** Pins "Thursday" / "this Sunday" in tests. */
  now?: Date;
  timeZone?: string;
};

/**
 * Public web search for Ask. Tavily when TAVILY_API_KEY is set. Otherwise
 * Gemini Google Search grounding, then DuckDuckGo. A missing Tavily key does
 * not turn search off. ASK_WEB_SEARCH_PROVIDER=off does.
 */
export async function searchAskWebDetailed(
  question: string,
  opts?: AskWebSearchOptions,
): Promise<AskWebSearchOutcome> {
  const empty: AskWebSearchOutcome = { hits: [], answer: '' };
  if (askWebSearchBlockedReason(question)) return empty;
  if (!isAskWebSearchConfigured()) return empty;

  const sanitized = sanitizeAskWebQuery(question);
  const query = resolveAskSearchQuery(sanitized, opts?.now ?? new Date(), opts?.timeZone ?? ASK_USER_TIME_ZONE);
  if (!query || query.length < 3) return empty;

  const limit = Math.min(opts?.limit ?? TAVILY_MAX_RESULTS, TAVILY_MAX_RESULTS);
  const fetchFn = opts?.fetchFn ?? fetch;
  const includeDomains = includeDomainsForAsk(question, opts?.includeDomains);
  askWebSearchCount += 1;
  const searches = askWebSearchCount;
  const tavilyKey = trim(process.env.TAVILY_API_KEY);
  if (tavilyKey) {
    try {
      const outcome = await searchTavily(query, tavilyKey, limit, fetchFn, includeDomains);
      // Count of searches only — never the key, the Authorization header, or the query.
      logger.info('ask_web_search', { searches, results: outcome.hits.length });
      return outcome;
    } catch (err) {
      const detail = redactSecrets((err instanceof Error ? err.message : String(err)).slice(0, 280));
      logger.warn('ask_web_search_failed', { searches, detail });
      return empty;
    }
  }

  const geminiKey = googleVisionApiKey();
  if (geminiKey) {
    try {
      const hits = await searchGemini(query, geminiKey, limit, fetchFn);
      if (hits.length) {
        logger.info('ask_web_search', { searches, results: hits.length });
        return { hits, answer: '' };
      }
    } catch (err) {
      const detail = redactSecrets((err instanceof Error ? err.message : String(err)).slice(0, 280));
      logger.warn('ask_web_search_failed', { searches, detail });
    }
  }

  try {
    const hits = await searchDuckDuckGo(query, limit, fetchFn);
    logger.info('ask_web_search', { searches, results: hits.length });
    return { hits, answer: '' };
  } catch (err) {
    const detail = redactSecrets((err instanceof Error ? err.message : String(err)).slice(0, 280));
    logger.warn('ask_web_search_failed', { searches, detail });
    return empty;
  }
}

export async function searchAskWeb(question: string, opts?: AskWebSearchOptions): Promise<AskWebHit[]> {
  const outcome = await searchAskWebDetailed(question, opts);
  return outcome.hits;
}

export function formatAskWebContext(hits: AskWebHit[], answer = ''): string {
  if (!hits.length && !trim(answer)) return '';
  const lines = hits
    .map((hit, i) => `${i + 1}. ${hit.title}\n   URL: ${hit.url}\n   ${hit.snippet || '(no snippet)'}`)
    .join('\n');
  const lead = trim(answer) ? `Tavily answer: ${trim(answer).replace(/[“”"]/g, '')}\n` : '';
  return `${lead}${lines}`.trim();
}

const WEB_SECTION_RE = /(?:^|\n+)(\*\*Web results\*\*[\s\S]*)$/i;

/** Split a labeled Web results section off the answer so job checks leave it intact. */
export function splitWebResultsSection(answer: string): { body: string; section: string } {
  const text = String(answer ?? '');
  const match = text.match(WEB_SECTION_RE);
  if (!match || match.index == null) return { body: text, section: '' };
  return { body: text.slice(0, match.index).trim(), section: (match[1] ?? '').trim() };
}

export function joinWebResultsSection(body: string, section: string): string {
  return [trim(body), trim(section)].filter(Boolean).join('\n\n');
}

function plainWebSnippet(snippet: string): string {
  return trim(snippet).replace(/[“”"]/g, '').replace(/\s+/g, ' ').slice(0, 280);
}

/** Markdown links in a section kept separate from job evidence. */
export function formatWebResultsSection(hits: AskWebHit[]): string {
  if (!hits.length) return '';
  const lines = hits.slice(0, TAVILY_MAX_RESULTS).map((hit) => {
    const title = (hit.title || 'Source').replace(/[\[\]]/g, '').trim() || 'Source';
    const snippet = plainWebSnippet(hit.snippet);
    const link = `[${title}](${hit.url})`;
    return snippet ? `- ${link} — ${snippet}` : `- ${link}`;
  });
  return `**Web results**\n${lines.join('\n')}`;
}

/** Replace any Web results section with links for the hits the server actually retrieved. */
export function ensureWebResultsSection(answer: string, hits: AskWebHit[]): string {
  const { body } = splitWebResultsSection(stripWebTrailer(answer));
  const section = formatWebResultsSection(hits);
  if (!section) return body.trim();
  return joinWebResultsSection(body, section);
}

function plainWebAnswer(text: string): string {
  return trim(text).replace(/[“”"]/g, '').replace(/\s+/g, ' ');
}

/**
 * Job evidence stays in front. Public questions use Tavily's answer, then the
 * Web results section. Web text is never wrapped in quotation marks.
 */
export function composeAskWebAnswer(input: {
  question: string;
  jobAnswer?: string | null;
  webAnswer?: string | null;
  hits: AskWebHit[];
}): string {
  const section = formatWebResultsSection(input.hits);
  const job = trim(input.jobAnswer);
  const jobUseful = Boolean(job) && !/does not have that|nothing is on this job file/i.test(job);
  const webLead = plainWebAnswer(input.webAnswer ?? '') || plainWebSnippet(input.hits[0]?.snippet ?? '');
  if (asksAboutJobFile(input.question) && jobUseful) {
    return joinWebResultsSection(job, section);
  }
  return joinWebResultsSection(webLead || job, section);
}

export function formatWebTrailer(hits: AskWebHit[]): string {
  if (!hits.length) return '';
  const parts = hits.map((hit) => `${hit.title.replace(/[|,⟦⟧]/g, ' ')}|${hit.url}`);
  return `⟦web: ${parts.join(', ')}⟧`;
}

function webTrailerBlobs(raw: string): string[] {
  const blobs: string[] = [];
  const re = new RegExp(WEB_TRAILER_RE.source, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(String(raw ?? ''))) !== null) {
    const blob = m[1] ?? m[2] ?? m[3] ?? '';
    if (trim(blob)) blobs.push(blob);
  }
  return blobs;
}

function parseWebCitationBlob(blob: string): AskWebHit[] {
  const hits: AskWebHit[] = [];
  const pairRe = new RegExp(WEB_PAIR_RE.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = pairRe.exec(blob)) !== null) {
    pushHit(hits, { title: trim(m[1]), url: trim(m[2]), snippet: '' });
  }
  return hits;
}

export function parseWebTrailer(raw: string): AskWebHit[] {
  const hits: AskWebHit[] = [];
  for (const blob of webTrailerBlobs(raw)) {
    for (const hit of parseWebCitationBlob(blob)) {
      pushHit(hits, hit);
    }
  }
  return hits;
}

/**
 * Google homepage / search UI and "how to search Google" pages are useless
 * citations — especially for capability-only asks.
 */
export function isLowValueWebCitation(hit: { title?: string; url: string }): boolean {
  const title = trim(hit.title).toLowerCase();
  let host = '';
  let path = '';
  try {
    const u = new URL(hit.url);
    host = u.hostname.replace(/^www\./i, '').toLowerCase();
    path = (u.pathname || '/').toLowerCase();
  } catch {
    return false;
  }

  const isGoogleSearchUi =
    host === 'google.com' ||
    host === 'search.google' ||
    host === 'search.google.com' ||
    /^google\.[a-z.]+$/.test(host);

  if (isGoogleSearchUi) {
    if (
      host === 'search.google' ||
      host === 'search.google.com' ||
      path === '/' ||
      path === '' ||
      path.startsWith('/search') ||
      path.startsWith('/xhtml') ||
      path.startsWith('/webhp') ||
      path.startsWith('/url')
    ) {
      return true;
    }
  }

  if (
    /^google(\s+search)?$/.test(title) ||
    /how\s+to\s+(search|use|google)\b/.test(title) ||
    /search(ing)?\s+(the\s+)?(web|google|internet)\b/.test(title)
  ) {
    return true;
  }
  if (/wikihow\.com$/i.test(host) && /search|google/i.test(title)) return true;
  return false;
}

export function filterLowValueWebCitations<T extends { title?: string; url: string }>(hits: T[]): T[] {
  return hits.filter((h) => !isLowValueWebCitation(h));
}

/** Keep only URLs the server actually retrieved (block model-hallucinated links). */
export function filterWebHitsToAllowed(cited: AskWebHit[], allowed: AskWebHit[]): AskWebHit[] {
  if (!allowed.length) return [];
  const allowedUrls = new Set(allowed.map((h) => h.url.toLowerCase()));
  const out: AskWebHit[] = [];
  for (const hit of cited) {
    const key = hit.url.toLowerCase();
    if (!allowedUrls.has(key)) continue;
    const full = allowed.find((a) => a.url.toLowerCase() === key) ?? hit;
    pushHit(out, { title: hit.title || full.title, url: full.url, snippet: full.snippet });
  }
  return out;
}

/**
 * Strip any web trailer (unicode or ASCII) from prose and re-attach a validated
 * unicode trailer. When the model omitted citations but we supplied hits, attach
 * those hits — except for capability-only asks / low-value google junk.
 */
export function normalizeAskWebCitations(
  answer: string,
  supplied: AskWebHit[],
  opts?: { attachIfMissing?: boolean; question?: string },
): string {
  let text = String(answer ?? '');
  if (!text) return text;

  const question = opts?.question ?? '';
  const capabilityOnly = question ? looksLikePureWebCapabilityAsk(question) : false;

  // Drop google homepage / "how to search" junk from citations always.
  let cited = filterLowValueWebCitations(filterWebHitsToAllowed(parseWebTrailer(text), supplied));
  const usableSupplied = filterLowValueWebCitations(supplied);

  text = stripWebTrailer(text);
  text = text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  // Capability-only: never leave a web trailer (clean yes; no google.com chips).
  if (capabilityOnly) return text;

  const attach =
    cited.length > 0
      ? cited
      : opts?.attachIfMissing !== false && usableSupplied.length
        ? usableSupplied.slice(0, 3)
        : [];

  // Only auto-attach when the answer looks like it used outside knowledge —
  // not when it clearly said the file lacks the fact and gave no supplement.
  if (!cited.length && attach.length && /does not have that/i.test(text) && !looksLikeOutsideKnowledgeAsk(text)) {
    // If model refused and didn't weave web content, skip noisy citations.
    if (!/\b(code|standard|manufacturer|spec|IRC|IBC|NEC|install)/i.test(text)) {
      return text;
    }
  }

  if (!attach.length) return text;
  return `${text}\n\n${formatWebTrailer(attach)}`;
}

export function stripWebTrailer(answer: string): string {
  return String(answer ?? '')
    .replace(new RegExp(WEB_TRAILER_RE.source, 'gi'), '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd();
}
