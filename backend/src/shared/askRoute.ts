/**
 * Cheap routing for one Ask turn.
 *
 * Fast (Sonnet 5.5 / Gemini Flash, trimmed job context): inventory, status,
 * counts, lists, who/when on the job, and other single-fact lookups.
 * Deep (Opus 5.5, full context): quotes, evidence, multi-clip summaries,
 * drafts, estimates, disputes, comparisons, corrections, other-job search.
 *
 * Heuristics decide first. When the result is unsure, an optional Flash
 * classifier picks FAST or DEEP (no thinking, few tokens). Anything still
 * uncertain stays on deep.
 */
import { asksAboutOtherJobs, type AskLookupCatalog } from './askLookup.js';
import { askFastGeminiModel, scrubProviderDetail } from '../lib/askModel.js';
import { googleVisionApiKey } from '../lib/visionProvider.js';
import { classifyAskIntent, classifyChatTurn, isJobContentsQuestion, isJobOverview } from './askPolish.js';

export type AskModelRoute = 'fast' | 'deep';

export type AskRouteDecision = {
  route: AskModelRoute;
  reason: string;
  /** Heuristic was not confident; a Flash pass may refine this. */
  unsure?: boolean;
};

const GREETING = /^(?:hi|hey|hello|hiya|good morning|good afternoon|good evening|thanks|thank you|thx|ty)[!.?\s]*$/i;

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** A walk through the whole file, not one dated line. */
function isFileNarrative(question: string): boolean {
  return (
    /\bwhat(?:'s| has| have)?(?: all)? happened\b/i.test(question) &&
    /\b(file|job|project|so far)\b/i.test(question)
  );
}

function isMultiStep(question: string): boolean {
  const q = question.trim();
  if ((q.match(/\?/g) ?? []).length >= 2) return true;
  if (/\b(compare|versus|difference between|both visits|across visits)\b/i.test(q)) return true;
  if (wordCount(q) >= 14 && /\b(and|then|also)\b/i.test(q) && /\b(why|draft|write|estimate|compare|summar)/i.test(q)) {
    return true;
  }
  return false;
}

/** Quotes, spoken evidence, disputes, and long-form synthesis stay on Opus. */
export function needsDeepEvidence(question: string): boolean {
  const q = question.trim();
  if (!q) return false;
  if (/\b(?:quote|verbatim|exact words|word for word)\b/i.test(q)) return true;
  if (
    /\b(?:say|said|says|saying|mention(?:ed|s)?|told|tell|discuss(?:ed|ing)?|spoke|speaking)\b/i.test(q) &&
    !/\b(?:how many|list|what kind|do we have|are there)\b/i.test(q)
  ) {
    return true;
  }
  if (/\b(?:dispute|disputed|denied|denial|carrier|liability|coverage fight)\b/i.test(q)) return true;
  if (/\b(?:summar(?:y|ize|ise)|overview|walk(?:\s+me)?\s+through|recap)\b/i.test(q)) return true;
  if (/\b(?:estimate|punch list|scope of work|change order)\b/i.test(q)) return true;
  if (/\b(?:draft|write)\b[\s\S]{0,24}\b(?:email|letter|note|summary|estimate)\b/i.test(q)) return true;
  if (/\b(?:compare|versus|vs\.?|difference between|both (?:visits|days|clips))\b/i.test(q)) return true;
  if (/\bwhy\b/i.test(q) && wordCount(q) >= 5 && !/\b(?:status|how many)\b/i.test(q)) return true;
  // Money, safety, hard dates / deadlines always stay on Opus.
  if (/\b(?:\$|price|cost|invoice|payment|paid|owe|deductible|settlement|approved amount)\b/i.test(q)) return true;
  if (/\b(?:unsafe|safety|hazard|emergency|gas leak|structural|collapse|asbestos|mold remediation)\b/i.test(q)) {
    return true;
  }
  if (/\b(?:deadline|due (?:date|by)|must (?:be|finish)|by (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d))\b/i.test(q)) {
    return true;
  }
  if (/\b(?:when is|what(?:'s| is) the date)\b/i.test(q) && /\b(?:due|deadline|inspection|closing)\b/i.test(q)) {
    return true;
  }
  return false;
}

/**
 * Single-fact or inventory asks that Sonnet/Flash can answer from a trimmed
 * job card (CRM fields, clip list, people, dates, status).
 */
export function isSimpleFactQuestion(question: string): boolean {
  const q = question.trim();
  if (!q || needsDeepEvidence(q)) return false;
  if (isJobContentsQuestion(q)) return true;
  if (/\b(?:what(?:'s| is)|whats)\b[\s\S]{0,28}\bstatus\b/i.test(q)) return true;
  if (
    /\b(?:how many|count(?:\s+of)?|number of)\b/i.test(q) &&
    wordCount(q) <= 18 &&
    !/\b(?:times? (?:he|she|they|someone)\s+(?:said|mentioned))\b/i.test(q)
  ) {
    return true;
  }
  if (
    /\b(?:what(?:'s| is)|whats|where(?:'s| is)|which)\b[\s\S]{0,48}\b(?:address|claim(?:\s*#| number)?|job(?:\s*#| number)?|homeowner|client|customer|phone|email|policy)\b/i.test(
      q,
    )
  ) {
    return true;
  }
  if (/^\s*who\b/i.test(q) && wordCount(q) <= 14 && !/\b(?:said|say|told|committed|promised|agreed)\b/i.test(q)) {
    return true;
  }
  if (
    /\b(?:when|what days?|which days?)\b/i.test(q) &&
    /\b(?:filmed|recorded|shot|visit|opened|created|started)\b/i.test(q) &&
    wordCount(q) <= 16
  ) {
    return true;
  }
  if (/^\s*(?:list|show(?:\s+me)?)\b/i.test(q) && wordCount(q) <= 14) return true;
  return false;
}

/**
 * `resolved` is the follow-up rewritten against the thread, when that differs
 * from the text the user just typed.
 */
export function routeAskQuestion(input: {
  question: string;
  resolved?: string | null;
  history?: Array<{ role?: string | null; text?: string | null }> | null;
  catalog?: AskLookupCatalog | null;
}): AskRouteDecision {
  const asked = input.question.trim();
  const resolved = (input.resolved ?? asked).trim() || asked;
  const intent = classifyAskIntent(resolved);
  if (intent.kind === 'task') return { route: 'deep', reason: `task_${intent.task}` };
  if (asksAboutOtherJobs(asked) || asksAboutOtherJobs(resolved)) return { route: 'deep', reason: 'other_jobs' };
  if (isJobOverview(resolved) || isJobOverview(asked) || isFileNarrative(resolved) || isFileNarrative(asked)) {
    return { route: 'deep', reason: 'overview' };
  }
  if (needsDeepEvidence(resolved) || needsDeepEvidence(asked)) {
    return { route: 'deep', reason: 'evidence' };
  }
  if (isMultiStep(resolved) || isMultiStep(asked)) return { route: 'deep', reason: 'multi_step' };

  if (isJobContentsQuestion(resolved) || isJobContentsQuestion(asked)) {
    return { route: 'fast', reason: 'job_contents' };
  }
  if (isSimpleFactQuestion(resolved) || isSimpleFactQuestion(asked)) {
    return { route: 'fast', reason: 'simple_fact' };
  }

  const catalog = input.catalog;
  if (catalog) {
    const chat = classifyChatTurn(resolved, input.history, catalog);
    if (chat === 'greeting' || chat === 'thanks' || chat === 'ack' || chat === 'restate' || chat === 'clarify') {
      return { route: 'fast', reason: chat };
    }
    if (chat === 'correction') return { route: 'deep', reason: 'correction' };
  } else if (GREETING.test(asked)) {
    return { route: 'fast', reason: 'greeting' };
  }

  // Unsure — prefer deep unless a Flash classifier says otherwise.
  return { route: 'deep', reason: 'default', unsure: true };
}

const HEDGE =
  /\b(i don't know|i do not know|not sure|i'm not sure|i am not sure|cannot tell|can't tell|no information|not in the (?:file|transcript)|nothing (?:in|on) (?:the |this )?file)\b/i;

/**
 * The fast model failed to ground a lookup or quote. The deep model should answer.
 * Greetings and ordinary prose are left alone. Checked on the model text, before
 * the server adds citation chips.
 */
export function fastAnswerNeedsDeepFallback(
  question: string,
  prose: string,
  traceHasHit: boolean,
): boolean {
  const text = prose.replace(/⟦[^⟧]*⟧/g, '').trim();
  if (!text) return true;
  const wantsEvidence = /\b(say|said|quote|transcript|what did|when did|who )\b/i.test(question);
  if (!wantsEvidence && !traceHasHit) return false;
  if (HEDGE.test(text) && (traceHasHit || wantsEvidence)) return true;
  return false;
}

const CLASSIFIER_SYSTEM = `You route one construction-job Chat question. Reply with exactly one word: FAST or DEEP.
FAST = inventory, counts, lists, status, who/when on the job, address/claim/homeowner, a single CRM fact.
DEEP = quotes or what someone said, evidence, multi-clip summary, draft/email/estimate, dispute, comparison, why/reasoning, other jobs.
When unsure, answer DEEP.`;

/**
 * Flash pass for unsure heuristic decisions. Returns null when disabled or the
 * classifier is unavailable — callers keep the heuristic deep default.
 */
export async function refineAskRouteWithClassifier(input: {
  question: string;
  heuristic: AskRouteDecision;
  fetchFn?: typeof fetch;
  apiKey?: string | null;
}): Promise<AskRouteDecision> {
  if (!input.heuristic.unsure) return input.heuristic;
  if ((process.env.ASK_ROUTE_CLASSIFIER ?? '1').trim() === '0') return input.heuristic;
  const apiKey = (input.apiKey ?? googleVisionApiKey() ?? '').trim();
  if (!apiKey) return input.heuristic;
  const model = askFastGeminiModel();
  const fetchFn = input.fetchFn ?? fetch;
  const base = (process.env.GOOGLE_BASE_URL || 'https://generativelanguage.googleapis.com').replace(/\/+$/, '');
  const url = `${base}/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  try {
    const response = await fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: CLASSIFIER_SYSTEM }] },
        contents: [{ role: 'user', parts: [{ text: input.question.trim().slice(0, 500) }] }],
        generationConfig: { maxOutputTokens: 8, temperature: 0 },
      }),
      signal: AbortSignal.timeout(4_000),
    });
    if (!response.ok) {
      throw new Error(`Gemini classifier ${response.status}: ${await response.text()}`);
    }
    const payload = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('') ?? '';
    const word = text.trim().toUpperCase().split(/\s+/)[0] ?? '';
    if (word.startsWith('FAST')) {
      return { route: 'fast', reason: 'classifier_fast' };
    }
    if (word.startsWith('DEEP')) {
      return { route: 'deep', reason: 'classifier_deep' };
    }
  } catch (err) {
    // Keep the safe deep default; never fail the Ask turn on the classifier.
    const detail = scrubProviderDetail(err instanceof Error ? err.message : String(err));
    if (detail) {
      // eslint-disable-next-line no-console
      console.warn(`[ask-route] classifier failed: ${detail.slice(0, 160)}`);
    }
  }
  return { ...input.heuristic, unsure: undefined };
}

/** Heuristics, then optional Flash when unsure. */
export async function resolveAskRoute(input: {
  question: string;
  resolved?: string | null;
  history?: Array<{ role?: string | null; text?: string | null }> | null;
  catalog?: AskLookupCatalog | null;
  fetchFn?: typeof fetch;
  classifierApiKey?: string | null;
}): Promise<AskRouteDecision> {
  const heuristic = routeAskQuestion(input);
  return refineAskRouteWithClassifier({
    question: (input.resolved ?? input.question).trim() || input.question,
    heuristic,
    fetchFn: input.fetchFn,
    apiKey: input.classifierApiKey,
  });
}

export type AskRouteLogRow = {
  at: string;
  orgId?: string | null;
  jobId?: string | null;
  question: string;
  route: AskModelRoute;
  reason: string;
  unsure?: boolean;
  modelHint: string;
};

/** In-memory ring for tests + process diagnostics. */
const recentRouteDecisions: AskRouteLogRow[] = [];
const ROUTE_LOG_MAX = 200;

export function recentAskRouteDecisionsForTests(): AskRouteLogRow[] {
  return [...recentRouteDecisions];
}

export function resetAskRouteLogForTests(): void {
  recentRouteDecisions.length = 0;
}

/**
 * Durable routing log: always keep a process ring; when a Supabase admin client
 * is provided, also insert into public.ask_route_decisions (migration). Failures
 * never break the Ask turn. Also stamps token_usage metadata via returned row.
 */
export async function logAskRouteDecision(
  row: Omit<AskRouteLogRow, 'at' | 'modelHint'> & { modelHint?: string; admin?: { from: (t: string) => any } | null },
): Promise<AskRouteLogRow> {
  const entry: AskRouteLogRow = {
    at: new Date().toISOString(),
    orgId: row.orgId ?? null,
    jobId: row.jobId ?? null,
    question: row.question.slice(0, 500),
    route: row.route,
    reason: row.reason,
    unsure: row.unsure,
    modelHint: row.modelHint ?? (row.route === 'fast' ? 'claude-sonnet-5-5|gemini-3.8-flash' : 'claude-opus-5-5'),
  };
  recentRouteDecisions.push(entry);
  while (recentRouteDecisions.length > ROUTE_LOG_MAX) recentRouteDecisions.shift();
  const admin = row.admin;
  if (admin?.from) {
    try {
      await admin.from('ask_route_decisions').insert({
        org_id: entry.orgId,
        job_id: entry.jobId,
        question: entry.question,
        route: entry.route,
        reason: entry.reason,
        unsure: Boolean(entry.unsure),
        model_hint: entry.modelHint,
        created_at: entry.at,
      });
    } catch {
      // table may not exist until migration ships
    }
  }
  return entry;
}
