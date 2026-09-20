/**
 * Ask web search — optional public-web supplement for job-file Ask.
 *
 * Job evidence (proofs, transcripts, brief, scope, …) always wins. The web is
 * only for outside knowledge: codes, products, manufacturers, standards, and
 * general how-to. Soft-fails when no provider key is configured.
 *
 * Providers: Brave / Serper / Tavily search APIs, or Gemini Google Search
 * grounding via GEMINI_API_KEY (auto-detected when dedicated search keys are
 * absent). Honor ASK_WEB_SEARCH_PROVIDER=gemini|brave|serper|tavily|off.
 * When the configured provider throws or returns no hits, fall back to
 * DuckDuckGo HTML scrape (no extra API key).
 *
 * Privacy: never reverse-image-search; never identify children; never identify
 * private job-site people from photos/video. Search queries are sanitized so
 * lockbox codes, claim numbers, and street addresses are not sent upstream.
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

export const ASK_WEB_FORMAT_RULES = `WEB (when WEB SEARCH RESULTS are provided below):
- Use them ONLY for outside knowledge: building codes, product/manufacturer specs, standards, general how-to.
- Job-file evidence always wins over the web. Never invent what happened on this job from a webpage.
- Never reverse-image-search, identify children, or identify private job-site people from photos/video.
- Do not paste raw URLs in the prose. After the human answer, on its OWN line (never mid-sentence / never glued to the last word), append exactly one machine line the UI strips:
  ⟦web: Title One|https://example.com/a, Title Two|https://example.com/b⟧
- Never write ASCII [[web: …]] or [web: …] — only the unicode form ⟦web: …⟧.
- Cite only URLs that appear in WEB SEARCH RESULTS. Skip the web line when you did not use the web, or when the user only asked whether you can search.`;

function trim(value: unknown): string {
  return String(value ?? '').trim();
}

export function askWebSearchProvider(): AskWebSearchProvider | null {
  const forced = trim(process.env.ASK_WEB_SEARCH_PROVIDER).toLowerCase();
  if (forced === 'off' || forced === 'none' || forced === 'false') return null;
  if (
    forced === 'brave' ||
    forced === 'serper' ||
    forced === 'tavily' ||
    forced === 'gemini'
  ) {
    return forced;
  }
  // Auto-detect: dedicated search keys first, then Gemini Google Search grounding
  // (GEMINI_API_KEY / usable GOOGLE generative key already on Railway).
  if (trim(process.env.BRAVE_SEARCH_API_KEY)) return 'brave';
  if (trim(process.env.SERPER_API_KEY)) return 'serper';
  if (trim(process.env.TAVILY_API_KEY)) return 'tavily';
  if (trim(process.env.ASK_WEB_SEARCH_API_KEY)) return 'brave';
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
  return trim(process.env.TAVILY_API_KEY) || generic;
}

export function isAskWebSearchConfigured(): boolean {
  const provider = askWebSearchProvider();
  if (!provider) return false;
  return Boolean(askWebSearchApiKey(provider));
}

/** Prompt rules when web search is wired (Gemini grounding or Brave/Serper/Tavily). */
export function askWebCapabilityRules(): string {
  if (isAskWebSearchConfigured()) {
    return `INTERNET / WEB ACCESS:
- You CAN look up public web information for outside knowledge (codes, products, manufacturers, standards, prices/costs, general how-to) when WEB SEARCH RESULTS are provided or the user asks you to search online.
- Never claim you lack a live web search tool, cannot query prices, are offline, not connected to the internet, or unable to search the web.
- When the user asks to search the web/Google/internet *for a topic*, results are fetched for outside knowledge — say that clearly. Do not hedge that you cannot search.
- If asked ONLY whether you are connected to the internet or can search the web/Google (no specific topic), answer briefly yes — Ask can search the public web for outside knowledge; job-file evidence still always wins for on-job facts. Do NOT append a ⟦web: …⟧ trailer and do not cite google.com, search.google, wikiHow "how to search Google", or similar junk.
- Never write ASCII [[web: …]] — only unicode ⟦web: …⟧ on its own line after the answer when you actually used WEB SEARCH RESULTS.
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

/** Outside-knowledge asks that benefit from the public web. */
export function looksLikeOutsideKnowledgeAsk(question: string): boolean {
  const q = trim(question);
  if (!q) return false;
  if (looksLikeWebCapabilityAsk(q)) return true;
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
    // Price / product market asks (tile prices, material cost, how much does X cost)
    /\b(tile|material|lumber|shingle|roofing|flooring|paint|supply|product|labor)\s+(prices?|pricing|cost|costs)\b/i.test(
      q,
    ) ||
    /\b(prices?|pricing|cost|costs)\s+(for|of)\s+\w+/i.test(q) ||
    /\bhow\s+much\s+(does|do|is|are)\b/i.test(q) ||
    /\b(market|retail|wholesale)\s+(price|cost|rate)\b/i.test(q) ||
    /\b(going\s+rate|price\s+check)\b/i.test(q)
  );
}

/** @deprecated alias — prefer shouldSupplementWithWebSearch */
export function shouldSearchAskWeb(question: string, grounded: string): boolean {
  return shouldSupplementWithWebSearch(question, grounded);
}

function groundedMisses(grounded: string): boolean {
  return /does not have that|Nothing is on this job file/i.test(grounded);
}

/**
 * Search when the question needs outside knowledge, or the file clearly
 * misses and the wording still looks general (codes/products/how-to).
 * Job-evidence questions with a solid grounded hit skip the web.
 */
export function shouldSupplementWithWebSearch(question: string, grounded: string): boolean {
  if (askWebSearchBlockedReason(question)) return false;
  if (!isAskWebSearchConfigured()) return false;
  // Capability-only ("can you search the web?") — answer yes from rules; do not
  // fetch google.com homepage junk to cite.
  if (looksLikePureWebCapabilityAsk(question)) return false;
  if (looksLikeOutsideKnowledgeAsk(question)) return true;
  if (
    groundedMisses(grounded) &&
    /\b(code|standard|product|manufacturer|spec|install|warranty|how|what is|who makes)\b/i.test(question)
  ) {
    return true;
  }
  return false;
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

async function searchBrave(
  query: string,
  apiKey: string,
  limit: number,
  fetchFn: typeof fetch,
): Promise<AskWebHit[]> {
  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', query);
  url.searchParams.set('count', String(Math.min(Math.max(limit, 1), 8)));
  const res = await fetchFn(url, {
    headers: {
      Accept: 'application/json',
      'X-Subscription-Token': apiKey,
    },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) {
    const body = (await res.text().catch(() => '')).slice(0, 240);
    throw new Error(`brave_search_${res.status}:${body}`);
  }
  const body = (await res.json()) as {
    web?: { results?: Array<{ title?: string; url?: string; description?: string }> };
  };
  const hits: AskWebHit[] = [];
  for (const row of body.web?.results ?? []) {
    pushHit(hits, {
      title: trim(row.title),
      url: trim(row.url),
      snippet: trim(row.description),
    });
    if (hits.length >= limit) break;
  }
  return hits;
}

async function searchSerper(
  query: string,
  apiKey: string,
  limit: number,
  fetchFn: typeof fetch,
): Promise<AskWebHit[]> {
  const res = await fetchFn('https://google.serper.dev/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': apiKey,
    },
    body: JSON.stringify({ q: query, num: Math.min(Math.max(limit, 1), 8) }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) {
    const body = (await res.text().catch(() => '')).slice(0, 240);
    throw new Error(`serper_search_${res.status}:${body}`);
  }
  const body = (await res.json()) as {
    organic?: Array<{ title?: string; link?: string; snippet?: string }>;
  };
  const hits: AskWebHit[] = [];
  for (const row of body.organic ?? []) {
    pushHit(hits, {
      title: trim(row.title),
      url: trim(row.link),
      snippet: trim(row.snippet),
    });
    if (hits.length >= limit) break;
  }
  return hits;
}

async function searchTavily(
  query: string,
  apiKey: string,
  limit: number,
  fetchFn: typeof fetch,
): Promise<AskWebHit[]> {
  const res = await fetchFn('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: 'basic',
      max_results: Math.min(Math.max(limit, 1), 8),
      include_answer: false,
    }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) {
    const body = (await res.text().catch(() => '')).slice(0, 240);
    throw new Error(`tavily_search_${res.status}:${body}`);
  }
  const body = (await res.json()) as {
    results?: Array<{ title?: string; url?: string; content?: string }>;
  };
  const hits: AskWebHit[] = [];
  for (const row of body.results ?? []) {
    pushHit(hits, {
      title: trim(row.title),
      url: trim(row.url),
      snippet: trim(row.content),
    });
    if (hits.length >= limit) break;
  }
  return hits;
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

  // groundingSupports may reference chunk indices; fold segment text as snippet filler.
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

  // Last resort: any http(s) URI nested under groundingMetadata.
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

/**
 * Gemini generateContent + Google Search grounding.
 * Parses groundingMetadata chunks and/or JSON hit lists from model text.
 */
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
    throw new Error(`gemini_search_${res.status}:${errBody}`);
  }
  const payload = (await res.json()) as GeminiGeneratePayload;
  const fromGrounding = hitsFromGeminiGrounding(payload, limit);
  const text = (payload.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('\n');
  const fromJson = parseGeminiAskWebHitsJson(text, limit);

  // Prefer grounding URIs (server-attested) and fill gaps from JSON parts.
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

async function runConfiguredProvider(
  provider: AskWebSearchProvider,
  query: string,
  apiKey: string,
  limit: number,
  fetchFn: typeof fetch,
): Promise<AskWebHit[]> {
  if (provider === 'brave') return searchBrave(query, apiKey, limit, fetchFn);
  if (provider === 'serper') return searchSerper(query, apiKey, limit, fetchFn);
  if (provider === 'tavily') return searchTavily(query, apiKey, limit, fetchFn);
  return searchGemini(query, apiKey, limit, fetchFn);
}

/**
 * Public web search for Ask. Returns [] when unset, blocked, or all providers fail.
 * Tries the configured provider first; on throw or empty hits, falls back to DuckDuckGo.
 */
export async function searchAskWeb(
  question: string,
  opts?: { fetchFn?: typeof fetch; limit?: number },
): Promise<AskWebHit[]> {
  if (askWebSearchBlockedReason(question)) return [];
  const provider = askWebSearchProvider();
  if (!provider) return [];
  const apiKey = askWebSearchApiKey(provider);
  if (!apiKey) return [];

  const query = sanitizeAskWebQuery(question);
  if (!query || query.length < 3) return [];

  const limit = opts?.limit ?? 5;
  const fetchFn = opts?.fetchFn ?? fetch;

  let hits: AskWebHit[] = [];
  let primaryError: string | null = null;
  try {
    hits = await runConfiguredProvider(provider, query, apiKey, limit, fetchFn);
    logger.info('ask_web_search_primary', {
      provider,
      queryLen: query.length,
      hitCount: hits.length,
      model: provider === 'gemini' ? geminiWebSearchModel() : undefined,
    });
  } catch (err) {
    primaryError = (err instanceof Error ? err.message : String(err)).slice(0, 280);
    // Never log API keys — error messages must not include the key header value.
    logger.warn('ask_web_search_failed', {
      provider,
      detail: primaryError.replace(/AIza[0-9A-Za-z_-]{10,}/g, '[redacted]'),
    });
    hits = [];
  }

  if (hits.length) return hits;

  try {
    const ddgHits = await searchDuckDuckGo(query, limit, fetchFn);
    logger.info('ask_web_search_ddg_fallback', {
      provider,
      queryLen: query.length,
      hitCount: ddgHits.length,
      primaryEmpty: !primaryError,
      primaryError: primaryError
        ? primaryError.replace(/AIza[0-9A-Za-z_-]{10,}/g, '[redacted]').slice(0, 200)
        : undefined,
    });
    return ddgHits;
  } catch (err) {
    const detail = (err instanceof Error ? err.message : String(err)).slice(0, 200);
    logger.warn('ask_web_search_ddg_fallback_failed', { provider, detail });
    return [];
  }
}

export function formatAskWebContext(hits: AskWebHit[]): string {
  if (!hits.length) return '';
  return hits
    .map((hit, i) => `${i + 1}. ${hit.title}\n   URL: ${hit.url}\n   ${hit.snippet || '(no snippet)'}`)
    .join('\n');
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
