/**
 * Ask web search — optional public-web supplement for job-file Ask.
 *
 * Job evidence (proofs, transcripts, brief, scope, …) always wins. The web is
 * only for outside knowledge: codes, products, manufacturers, standards, and
 * general how-to. Soft-fails when no provider key is configured.
 *
 * Privacy: never reverse-image-search; never identify children; never identify
 * private job-site people from photos/video. Search queries are sanitized so
 * lockbox codes, claim numbers, and street addresses are not sent upstream.
 */

import { logger } from '../lib/logger.js';

export type AskWebHit = {
  title: string;
  url: string;
  snippet: string;
};

export type AskWebSearchProvider = 'brave' | 'serper' | 'tavily';

const WEB_TRAILER_RE = /(?:\n|^)\s*⟦web:\s*([^⟧]+)⟧\s*/i;

/** Prompt block when web hits were retrieved for this turn. */
export const ASK_WEB_FORMAT_RULES = `WEB (when WEB SEARCH RESULTS are provided below):
- Use them ONLY for outside knowledge: building codes, product/manufacturer specs, standards, general how-to.
- Job-file evidence always wins over the web. Never invent what happened on this job from a webpage.
- Never reverse-image-search, identify children, or identify private job-site people from photos/video.
- Do not paste raw URLs in the prose. After the human answer, append one machine line the UI strips:
  ⟦web: Title One|https://example.com/a, Title Two|https://example.com/b⟧
- Cite only URLs that appear in WEB SEARCH RESULTS. Skip the web line when you did not use the web.`;

function trim(value: unknown): string {
  return String(value ?? '').trim();
}

export function askWebSearchProvider(): AskWebSearchProvider | null {
  const forced = trim(process.env.ASK_WEB_SEARCH_PROVIDER).toLowerCase();
  if (forced === 'off' || forced === 'none' || forced === 'false') return null;
  if (forced === 'brave' || forced === 'serper' || forced === 'tavily') {
    return forced;
  }
  // Auto-detect from whichever key is present (Brave preferred when generic key only).
  if (trim(process.env.BRAVE_SEARCH_API_KEY)) return 'brave';
  if (trim(process.env.SERPER_API_KEY)) return 'serper';
  if (trim(process.env.TAVILY_API_KEY)) return 'tavily';
  if (trim(process.env.ASK_WEB_SEARCH_API_KEY)) return 'brave';
  return null;
}

export function askWebSearchApiKey(provider: AskWebSearchProvider = askWebSearchProvider() ?? 'brave'): string {
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

/** Outside-knowledge asks that benefit from the public web. */
export function looksLikeOutsideKnowledgeAsk(question: string): boolean {
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
    /\bwho\s+makes\b|\bwho\s+manufactures\b|\bpart\s*#?\s*\d/i.test(q)
  );
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

function pushHit(hits: AskWebHit[], next: AskWebHit | null) {
  if (!next) return;
  if (!next.title || !next.url) return;
  if (!/^https?:\/\//i.test(next.url)) return;
  if (hits.some((h) => h.url === next.url)) return;
  hits.push({
    title: next.title.slice(0, 160),
    url: next.url.slice(0, 500),
    snippet: next.snippet.slice(0, 400),
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
    throw new Error(`brave_search_${res.status}`);
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
    throw new Error(`serper_search_${res.status}`);
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
    throw new Error(`tavily_search_${res.status}`);
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

/**
 * Public web search for Ask. Returns [] when unset, blocked, or upstream fails.
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
  try {
    if (provider === 'brave') return await searchBrave(query, apiKey, limit, fetchFn);
    if (provider === 'serper') return await searchSerper(query, apiKey, limit, fetchFn);
    return await searchTavily(query, apiKey, limit, fetchFn);
  } catch (err) {
    const detail = (err instanceof Error ? err.message : String(err)).slice(0, 200);
    logger.warn('ask_web_search_failed', { provider, detail });
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

export function parseWebTrailer(raw: string): AskWebHit[] {
  const match = trim(raw).match(WEB_TRAILER_RE);
  if (!match) return [];
  const hits: AskWebHit[] = [];
  const blob = match[1] ?? '';
  // Entries are "Title|https://…" — match each title|url pair.
  const pairRe = /([^|,][^|]*?)\|(https?:\/\/[^,\s⟧]+)/g;
  let m: RegExpExecArray | null;
  while ((m = pairRe.exec(blob)) !== null) {
    pushHit(hits, { title: trim(m[1]), url: trim(m[2]), snippet: '' });
  }
  return hits;
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
 * Strip ⟦web: …⟧ from prose and re-attach a validated trailer.
 * When the model omitted citations but we supplied hits, attach those hits.
 */
export function normalizeAskWebCitations(
  answer: string,
  supplied: AskWebHit[],
  opts?: { attachIfMissing?: boolean },
): string {
  let text = String(answer ?? '');
  if (!text) return text;

  const cited = filterWebHitsToAllowed(parseWebTrailer(text), supplied);
  text = text.replace(WEB_TRAILER_RE, '').trimEnd();
  text = text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const attach =
    cited.length > 0
      ? cited
      : opts?.attachIfMissing !== false && supplied.length
        ? supplied.slice(0, 3)
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
  return String(answer ?? '').replace(WEB_TRAILER_RE, '').trimEnd();
}
