/**
 * Public questions in job Chat: web search results turned into an answer.
 */
import { askFastAnthropicModel, completeAskText, isAskModelConfigured } from '../lib/askModel.js';
import type { AskTurnClock } from './askTiming.js';
import { CHAT_VOICE_RULES, normalizeAskProse, trimChatFiller } from './askProse.js';
import { type MeasuredUsage } from '../lib/anthropic.js';
import {
  askClockSystemRules,
  composeAskWebAnswer,
  composedAnswerIsWebProse,
  ensureWebResultsSection,
  scrubWebDerivedAskAnswer,
  formatAskWebContext,
  includeDomainsForAsk,
  searchAskWebDetailed,
  asksAboutJobFile,
  type AskWebHit,
  type AskWebSearchFn,
  type AskWebSearchOutcome,
} from './askWebSearch.js';
import { trim, formatJobFileRecord } from './jobFileAskRecord.js';
import type { JobFileAskTurn, JobFileAskContext } from './jobFileAskRecord.js';

export function webFallbackAnswer(input: {
  question: string;
  jobAnswer?: string | null;
  webAnswer?: string | null;
  hits: AskWebHit[];
}): { answer: string; webDerived: boolean } {
  const answer = composeAskWebAnswer(input);
  const webDerived = composedAnswerIsWebProse(input);
  return { answer: webDerived ? scrubWebDerivedAskAnswer(answer) : answer, webDerived };
}

export const GENERAL_ANSWER_SYSTEM = `You answer a contractor's quick public question in Chat (sports, weather, news, codes, products, prices) from the WEB SEARCH RESULTS given.

${CHAT_VOICE_RULES}

Rules:
- Lead with a direct, useful answer in 1–3 short sentences, like a sharp friend who just checked. Never open with what you could not find.
- Predictions ("who's going to win", "will it rain"): give a quick take. Say who is favored and the one or two reasons the results support (odds, records, standings, starters, home field, forecast). One light hedge at most.
- A vague subject ("the ball game", "the game tonight"): use CURRENT DATE AND TIME and cover the one or two most likely matches in a line each. Do not ask which one.
- Scores, times, odds, prices, and names must come from the results. If the results are thin, give the best general take and say in one short clause that live details were not in the results.
- A short "-" list only for a schedule or a few options, one item per line, in your own words.
- No links or URLs, no headings, no "[...]", no quotation marks around web text, no page labels. The app shows the sources separately.
- Trade, code, how-to, math and definition questions may also use what you know. The THIS JOB card is the open job file: use it when the question touches the job (its city for weather, its type of loss), and never invent job facts beyond it.`;

/** A short card of the open job for a general turn (weather at the site, codes for its city). */
export function generalJobCard(file: JobFileAskContext | null | undefined, budget = 1200): string {
  if (!file) return '';
  const record = formatJobFileRecord({
    ...file,
    clips: [],
    messages: [],
    documents: [],
    workLogs: [],
    memory: [],
    tasks: [],
    mentionSupplement: null,
  }).trim();
  if (!record) return '';
  return record.length > budget ? `${record.slice(0, budget).trimEnd()}…` : record;
}

/**
 * A public question with nothing to do with the job: one web search (often
 * already running from the start of the turn) and one fast, streamed answer.
 * No job lookup loop, no second search round, no reasoning model.
 */
export async function answerGeneralQuestion(input: {
  question: string;
  history?: JobFileAskTurn[] | null;
  apiKey?: string | null;
  webSearch?: AskWebSearchFn | null;
  fetchFn?: typeof fetch;
  onToken?: (text: string) => void;
  onStatus?: (phase: string) => void;
  signal?: AbortSignal;
  timing?: AskTurnClock | null;
  now?: Date;
  timeZone?: string;
  complete?: typeof completeAskText;
  /** The open job, so a general answer can still use it (see generalJobCard). */
  jobCard?: string | null;
}): Promise<{
  answer: string;
  model: string | null;
  usage: MeasuredUsage | null;
  webHits: AskWebHit[];
  webAnswer: string;
} | null> {
  const zone = input.timeZone || 'America/Chicago';
  input.onStatus?.('Searching the web…');
  const started = performance.now();
  const search = input.webSearch ?? ((query: string, opts?: Parameters<AskWebSearchFn>[1]) => searchAskWebDetailed(query, opts));
  const outcome: AskWebSearchOutcome = await search(input.question, {
    fetchFn: input.fetchFn,
    limit: 5,
    includeDomains: includeDomainsForAsk(input.question),
    now: input.now,
    timeZone: zone,
  }).catch(() => ({ hits: [], answer: '' }));
  input.timing?.addTool('web_search', performance.now() - started);
  if (input.signal?.aborted) return null;
  const complete = input.complete ?? completeAskText;
  if (!input.complete && !isAskModelConfigured(trim(input.apiKey) || null)) return null;
  const history = (input.history ?? [])
    .filter((turn) => trim(turn.text) && turn.officeOnly !== true)
    .slice(-6)
    .map((turn) => `${turn.role === 'assistant' ? 'Assistant' : 'User'}: ${trim(turn.text).slice(0, 600)}`)
    .join('\n');
  const results = formatAskWebContext(outcome.hits, outcome.answer);
  input.onStatus?.('Writing the answer…');
  const completed = await complete({
    system: `${GENERAL_ANSWER_SYSTEM}\n\n${askClockSystemRules(input.now ?? new Date(), zone)}`,
    user:
      `WEB SEARCH RESULTS (public web):\n${results || '(none: live search returned nothing usable)'}` +
      (trim(input.jobCard) ? `\n\nTHIS JOB (the open job file, for context):\n${trim(input.jobCard)}` : '') +
      (history ? `\n\nEarlier in this chat:\n${history}` : '') +
      `\n\nQuestion: ${input.question}`,
    anthropicApiKey: trim(input.apiKey) || null,
    anthropicModel: askFastAnthropicModel(),
    mode: 'interactive',
    maxTokens: 600,
    onToken: input.onToken,
    signal: input.signal,
    fetchFn: input.fetchFn,
  }).catch(() => null);
  const text = completed?.text
    ? scrubWebDerivedAskAnswer(ensureWebResultsSection(normalizeAskProse(completed.text)))
    : '';
  if (!trim(text)) return null;
  return {
    answer: trimChatFiller(text, { question: input.question }),
    model: completed?.model ?? null,
    usage: completed?.usage ?? null,
    webHits: outcome.hits,
    webAnswer: outcome.answer,
  };
}

export const WEB_SUMMARY_SYSTEM = `You answer one public question for a contractor's Chat from the WEB SEARCH RESULTS given. Write the answer yourself.

${CHAT_VOICE_RULES}

Rules:
- Lead with the answer in 1–3 short plain sentences. A schedule, a set of scores or a few options may be a short "-" list, one item per line, each in your own words.
- Use only what the results say. If they do not answer the question, say so in one sentence. Never invent games, times, prices, names or URLs.
- Never paste or stitch together result text. No markdown headings (#), no "[...]", no page labels ("Team Logo", "Watch Replay", "Final"), no links or URLs, no quotation marks around web text. The app shows the sources separately.`;

/**
 * The job-file model declined a public question (or wrote nothing) although
 * web results came back. Write a short answer from those results with the
 * same Chat model, instead of pasting a raw result snippet. Null when no
 * model is configured or it fails; the caller then uses composeAskWebAnswer.
 */
export async function summarizeWebResultsForAsk(input: {
  question: string;
  hits: AskWebHit[];
  webAnswer: string;
  apiKey?: string | null;
  fetchFn?: typeof fetch;
  now?: Date;
  timeZone?: string;
  complete?: typeof completeAskText;
}): Promise<{ answer: string; model: string | null; usage: MeasuredUsage | null } | null> {
  if (!input.hits.length && !trim(input.webAnswer)) return null;
  const complete = input.complete ?? completeAskText;
  if (!input.complete && !isAskModelConfigured(trim(input.apiKey) || null)) return null;
  try {
    const completed = await complete({
      system: `${WEB_SUMMARY_SYSTEM}\n\n${askClockSystemRules(input.now ?? new Date(), input.timeZone || 'America/Chicago')}`,
      user: `WEB SEARCH RESULTS (public web):\n${formatAskWebContext(input.hits, input.webAnswer)}\n\nQuestion: ${input.question}`,
      anthropicApiKey: trim(input.apiKey) || null,
      anthropicModel: askFastAnthropicModel(),
      mode: 'interactive',
      maxTokens: 500,
      fetchFn: input.fetchFn,
    });
    const text = completed?.text ? scrubWebDerivedAskAnswer(ensureWebResultsSection(normalizeAskProse(completed.text))) : '';
    if (!trim(text)) return null;
    return { answer: trimChatFiller(text, { question: input.question }), model: completed?.model ?? null, usage: completed?.usage ?? null };
  } catch {
    return null;
  }
}

export type WebSummaryOptions = Omit<Parameters<typeof summarizeWebResultsForAsk>[0], 'question' | 'hits' | 'webAnswer'>;

export async function applyWebResults(
  answer: string,
  question: string,
  hits: AskWebHit[],
  webAnswer: string,
  summary?: WebSummaryOptions,
): Promise<{ answer: string; webDerived: boolean; usage?: MeasuredUsage | null }> {
  const stripped = ensureWebResultsSection(answer);
  if (!hits.length && !trim(webAnswer)) return { answer: stripped, webDerived: false };
  const refused =
    /does not have that|not on (this )?file|cannot search|can't search|unable to search|do not have (web|internet) access|aren'?t connected/i.test(
      answer,
    );
  if (!asksAboutJobFile(question) && (refused || !trim(stripped))) {
    // Write a clean answer from the results; never paste raw result text.
    const written = summary ? await summarizeWebResultsForAsk({ ...summary, question, hits, webAnswer }) : null;
    if (written) return { answer: written.answer, webDerived: true, usage: written.usage };
    return webFallbackAnswer({ question, jobAnswer: '', webAnswer, hits });
  }
  return { answer: stripped, webDerived: false };
}

