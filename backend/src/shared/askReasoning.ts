/**
 * Multi-step Ask over lookup tools.
 *
 * Simple lookups, quotes, greetings, and follow-ups use a fast model with
 * thinking off (ASK_FAST_ANTHROPIC_MODEL, otherwise Gemini Flash). Drafts,
 * comparisons, and multi-step questions stay on ANTHROPIC_MODEL with adaptive
 * thinking. If the fast model fails or returns nothing grounded, the deep
 * model answers from the same tools. If that also fails, Gemini
 * (ASK_ANALYSIS_MODEL) is the last model, then the reply is only what the
 * tools returned.
 *
 * The system prompt and the job context are a cached prefix. Text tokens are
 * forwarded as they arrive. Network Ask tools in one turn run together.
 * In-memory lookup tools are timed as one batch; they do not wait on a model.
 */
import Anthropic from '@anthropic-ai/sdk';
import { anthropicClientForKey, tryExtractUsage, type MeasuredUsage } from '../lib/anthropic.js';
import {
  anthropicAskApiKey,
  anthropicFastRequest,
  anthropicReasoningRequest,
  askFastAnthropicModel,
  askFastGeminiModel,
  askReasoningConfig,
  askReasoningTimeoutMs,
  completeAskText,
  geminiAskModel,
  logAskFailure,
  requestGemini,
} from '../lib/askModel.js';
import { googleVisionApiKey } from '../lib/visionProvider.js';
import {
  ASK_LOOKUP_TOOLS,
  asksAboutOtherJobs,
  buildLookupUserPrompt,
  collectMomentSourceIds,
  continueAskLookup,
  executeAskLookup,
  followUpAnswerable,
  planAskLookup,
  quotesFromTrace,
  scrubStoredAskText,
  splitLookupPrompt,
  suggestFollowUps,
  type AskLookupCatalog,
  type AskLookupTraceStep,
} from './askLookup.js';
import {
  formatFollowupTrailer,
  formatQuoteTrailer,
  parseFollowupTrailer,
  parseMomentSource,
  stripMomentTrailers,
} from './askMoments.js';
import {
  classifyAskIntent,
  composeGroundedAsk,
  namedSpeaker,
  polishAskProse,
  resolveAskQuestion,
  speechQuotesForQuestion,
  wrapTaskArtifact,
} from './askPolish.js';
import { normalizeAskSources, parseSourceTrailerIds } from './askSources.js';
import { formatThreadMemoryForPrompt, type LongThreadMemory } from './askMemory.js';
import { fastAnswerNeedsDeepFallback, routeAskQuestion, type AskModelRoute } from './askRoute.js';
import {
  anthropicCachedSystem,
  asAnthropicSystem,
  geminiCachedContentName,
  geminiSystemPrefix,
} from './askPromptCache.js';
import type { AskTurnClock } from './askTiming.js';

const LOOKUP_SYSTEM = `You are a sharp project manager writing to a colleague or a client. You answer from this job file by looking things up. You have tools. Use them before you write.

Rules:
1. The user message already includes the job context (project, address, client, clips, redacted transcripts, history, people) and earlier turns of this chat. Use that context for a broad question such as what the job is about. Call a tool when you need a cited spoken moment, one person's clips, or a detail the context does not already settle. Do not guess.
2. Stay strictly grounded in tool results. Never invent clips, quotes, times, people, rooms, defects, or scope.
3. If the file lacks something, say that in one short sentence, then give the best answer the file does support.
4. The first sentence is the answer. Then only the detail the reader needs. No "Certainly", "Great question", or other filler.
5. Write clean markdown: short paragraphs, bullets only for parallel items, **bold** for the key fact, a table when comparing visits. No raw ids, no UTC (use the timestamps the tools already localized), no duplicated job names, no stray transcript fragments in the prose.
6. A request to produce something (homeowner summary, scope note, visit comparison, open issues, punch list, email, estimate) is a task. Write a real document from the job context, wrapped as:
   ⟦artifact⟧
   the copyable note
   ⟦/artifact⟧
   The sentence before that wrapper is the answer, not a preamble. A homeowner summary is prose. An email has a greeting, a few natural sentences on what was done or seen, a next step, and a sign-off. A punch list and an estimate are different documents. None of them is a repeated list of clips. Never paste a vision clip title. Describe what happened.
7. Cite a spoken moment as video/<jobId>/<proofId>/<slug>@<seconds> using cite and atSeconds from the tool. Omit @seconds when the tool has no timing.
8. After the prose, append exactly one sources line and, only when a tool returned a spoken excerpt the question asked for, one quotes line:
   ⟦sources: video/<jobId>/<proofId>/<slug>@<seconds>⟧
   ⟦quotes: video/<jobId>/<proofId>/<slug>@<seconds>|Speaker|verbatim excerpt⟧
9. Then append two or three follow-up questions the tool results can answer:
   ⟦followups: question one? ;; question two?⟧
10. Do not put those machine lines inside the sentences. Never write [[web:…]] or "(Source: …)".
11. On a tool-call turn, do not write the answer yet.
12. This is a conversation. Answer a greeting, a thanks, or a short reaction in a natural professional voice, and say what this job can answer. "Why" and "what do you think" stay tied to lines actually on the file; do not invent a motive. If the request could mean two days or two clips and the thread does not pick one, ask one short clarifying question. If the user is wrong, answer politely and name the day: "That line is actually from Sep 21 — here's the clip." Never write "The file does have that." Use the person's name. Never write "Seated man" or another visual label when the file names who spoke. Answer first. No canned filler. Never stop at one line that only says the file does not have it.
13. A thread can span days and weeks. Older turns may be a summary; the latest turns are verbatim. Durable notes are preferences and decisions, each dated to the turn it came from. When the user says "last week you said" or asks what was decided, answer from those notes and the summary, name that day, and do not invent a decision that is not written there.
14. Sound like a warm, clear colleague. The first sentence answers the question. Write full sentences. No canned filler. Use a table, a list, or a quote only when it makes the answer easier to scan.
15. Keep calling tools until the question is answered. When the user asks about other jobs in this organization, call search_other_jobs, then get_clip on those results. Do not search other jobs unless they asked. Do not end with "I checked the clips" or any similar footer. Sources belong in the sources line, which the reader sees as citation chips.
16. A homeowner email or an estimate draft is a finished note in the artifact wrapper. Never invent a price. If prices are not on the file, say that in a sentence and draft only from what was seen. Do not repeat the clip list. Offer one next step.`;

/**
 * Fast turns already have the job file in the cached prefix. Answer from it
 * in the first response so a quote is not waiting on a tool round-trip.
 * Tools stay available when the line is not in that context.
 */
const LOOKUP_SYSTEM_FAST = `You are a sharp project manager writing to a colleague or a client. The job context in this request already includes the project, the clips, and the redacted transcripts. Answer from that context in this response.

Rules:
1. Start with the answer. The reader should see the first sentence before any tool call. Call a tool only when the spoken line or fact is not already in the job context.
2. Stay grounded in that context. Never invent clips, quotes, times, people, rooms, defects, or scope. Never repeat a line marked privacy redacted. If the file lacks it, say so in one sentence, then give the best answer the file does support.
3. Quote the words that were said. Cite the moment as video/<jobId>/<proofId>/<slug>@<seconds> using the timestamps already in the context. Omit @seconds when the line has no timing.
4. The first sentence is the answer. No "Certainly" or other filler. No raw ids, no UTC, no duplicated job names.
5. After the prose, append exactly one sources line and, when you quoted speech, one quotes line:
   ⟦sources: video/<jobId>/<proofId>/<slug>@<seconds>⟧
   ⟦quotes: video/<jobId>/<proofId>/<slug>@<seconds>|Speaker|verbatim excerpt⟧
6. Then two or three follow-ups the file can answer:
   ⟦followups: question one? ;; question two?⟧
7. Do not put those machine lines inside the sentences. Use the person's name. Never write a visual label when the file names who spoke.`;

export type LookupModelTurn = {
  model: string;
  text: string;
  calls: Array<{ name: string; input: Record<string, unknown> }>;
  usage?: MeasuredUsage | null;
  /** True when visible tokens were already forwarded. */
  streamed?: boolean;
};

export type LookupModelStep = (input: {
  system: string;
  /** Stable job context. Cached with the system prompt; omitted from the volatile user text. */
  stable?: string;
  user: string;
  trace: AskLookupTraceStep[];
}) => Promise<LookupModelTurn | null>;

export function askLookupStatus(tool: string): string {
  switch (tool) {
    case 'read_job_history':
      return 'Reading the job history…';
    case 'search_transcripts':
    case 'search_other_jobs':
    case 'get_clip':
    case 'list_person_activity':
      return 'Looking through clips…';
    default:
      return 'Looking through clips…';
  }
}

function formatTrace(trace: AskLookupTraceStep[]): string {
  if (!trace.length) return '';
  return trace
    .map((step) => {
      const payload = step.result.data != null ? `\n${JSON.stringify(step.result.data).slice(0, 6000)}` : '';
      return `### ${step.tool} (${step.result.ok ? 'ok' : 'failed'})\n${step.result.summary}${payload}`;
    })
    .join('\n\n');
}

export function finalizeLookupAnswer(
  prose: string,
  trace: AskLookupTraceStep[],
  catalog: AskLookupCatalog,
  question: string,
): { answer: string; followUps: string[] } {
  const allowed = new Set(collectMomentSourceIds(trace));
  let text = stripMomentTrailers(prose);
  text = normalizeAskSources(text);
  const cited = parseSourceTrailerIds(text).filter((id) => {
    const moment = parseMomentSource(id);
    if (!moment) return true;
    if (!allowed.size) return false;
    return [...allowed].some((cite) => cite === id || cite.startsWith(`video/${moment.jobId}/${moment.proofId}/`));
  });
  const datedQuotes = speechQuotesForQuestion(question, trace, catalog);
  const kept = cited.length
    ? cited
    : datedQuotes?.length
      ? datedQuotes.map((quote) => quote.sourceId)
      : [...allowed].slice(0, 6);
  text = text.replace(/(?:\n|^)\s*⟦sources:\s*[^⟧]*⟧\s*/i, '').trim();
  text = polishAskProse(text, {
    timeZone: catalog.timeZone,
    jobTitle: catalog.jobTitle,
    speakerName: namedSpeaker(catalog),
  });
  if (classifyAskIntent(question).kind === 'task') text = wrapTaskArtifact(text);
  const spoken = /\b(say|said|quote|transcript|tell|mention)\b/i.test(question);
  const quoteTrace = trace.filter(
    (step) => step.tool === 'search_transcripts' || (spoken && step.tool === 'get_clip'),
  );
  const quotes = (datedQuotes ?? quotesFromTrace(quoteTrace)).filter((quote) => {
    const moment = parseMomentSource(quote.sourceId);
    if (!moment) return false;
    return kept.some((id) => {
      const parsed = parseMomentSource(id);
      return parsed?.proofId === moment.proofId;
    }) || allowed.has(quote.sourceId);
  });
  const modelFollows = parseFollowupTrailer(prose).filter((item) => {
    const hay = JSON.stringify(trace).toLowerCase();
    const words = item
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length > 4 && !['about', 'there', 'would', 'could', 'their'].includes(word));
    return words.length > 0 && words.some((word) => hay.includes(word)) && followUpAnswerable(item, catalog);
  });
  const followUps = [...modelFollows];
  for (const suggestion of suggestFollowUps(question, trace, catalog)) {
    if (followUps.length >= 3) break;
    if (!followUps.some((item) => item.toLowerCase() === suggestion.toLowerCase())) followUps.push(suggestion);
  }
  const blocks = [text.trim()];
  if (kept.length) blocks.push(`⟦sources: ${kept.join(', ')}⟧`);
  const quoteLine = formatQuoteTrailer(quotes.slice(0, 4));
  if (quoteLine) blocks.push(quoteLine);
  const followLine = formatFollowupTrailer(followUps);
  if (followLine) blocks.push(followLine);
  return {
    answer: blocks.filter(Boolean).join('\n\n').trim(),
    followUps: followLine ? parseFollowupTrailer(followLine) : [],
  };
}

const LOOKUP_TOOLS = ASK_LOOKUP_TOOLS.map((tool) => ({
  name: tool.name,
  description: tool.description,
  input_schema: tool.input_schema as { type: 'object'; properties?: unknown },
}));

type LookupCall = { id: string; name: string; input: Record<string, unknown> };

function toolUses(blocks: Anthropic.ContentBlock[]): LookupCall[] {
  const calls: LookupCall[] = [];
  for (const block of blocks) {
    if (block.type !== 'tool_use') continue;
    calls.push({
      id: block.id,
      name: block.name,
      input: block.input && typeof block.input === 'object' ? (block.input as Record<string, unknown>) : {},
    });
  }
  return calls.filter((call) => call.name);
}

function textFromBlocks(blocks: Anthropic.ContentBlock[]): string {
  return blocks
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('\n')
    .trim();
}

/**
 * One Anthropic tool loop. Assistant turns, including thinking blocks, are
 * sent back unmodified. Text and tool calls are chosen by block type.
 * Visible text is forwarded as it arrives. A tool call later in the same
 * turn is not the answer; the caller clears that preface with a status.
 */
function anthropicLookupSession(input: {
  apiKey: string;
  model: string;
  maxTokens: number;
  thinking?: { type: 'adaptive' } | { type: 'enabled'; budget_tokens: number };
  outputConfig?: { effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max' };
  onToken?: (text: string) => void;
}): (state: { system: string; stable?: string; user: string; trace: AskLookupTraceStep[]; signal?: AbortSignal }) => Promise<LookupModelTurn> {
  const messages: Anthropic.MessageParam[] = [];
  let traced = 0;
  let pending: { blocks: Anthropic.ContentBlock[]; tools: LookupCall[] } | null = null;
  return async (state) => {
    if (!messages.length) {
      messages.push({ role: 'user', content: state.user });
    }
    if (pending) {
      const fresh = state.trace.slice(traced);
      messages.push({ role: 'assistant', content: pending.blocks });
      messages.push({
        role: 'user',
        content: pending.tools.map((tool, index) => {
          const step = fresh[index];
          const payload = step
            ? { ok: step.result.ok, summary: step.result.summary, data: step.result.data ?? null }
            : { ok: false, summary: 'Not run.' };
          return {
            type: 'tool_result' as const,
            tool_use_id: tool.id,
            content: JSON.stringify(payload).slice(0, 8000),
            is_error: !step?.result.ok,
          };
        }),
      });
      pending = null;
    }
    traced = state.trace.length;
    const stream = anthropicClientForKey(input.apiKey).messages.stream(
      {
        model: input.model,
        max_tokens: input.maxTokens,
        system: asAnthropicSystem(anthropicCachedSystem(state.system, state.stable ?? '')),
        messages,
        tools: LOOKUP_TOOLS,
        ...(input.thinking ? { thinking: input.thinking } : {}),
        ...(input.outputConfig ? { output_config: input.outputConfig } : {}),
      },
      state.signal ? { signal: state.signal } : undefined,
    );
    const deltas: string[] = [];
    let sawTool = false;
    stream.on('text', (delta: string) => {
      if (!delta || sawTool) return;
      deltas.push(delta);
      input.onToken?.(delta);
    });
    stream.on('streamEvent', (event: { type?: string; content_block?: { type?: string } }) => {
      if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
        sawTool = true;
      }
    });
    const response = await stream.finalMessage();
    const blocks = response.content;
    const calls = toolUses(blocks);
    const text = deltas.join('').trim() || textFromBlocks(blocks);
    if (calls.length) {
      // Keep the provider blocks, thinking included, for the next turn.
      pending = { blocks, tools: calls };
      return {
        model: response.model,
        text: '',
        calls: calls.map((call) => ({ name: call.name, input: call.input })),
        usage: tryExtractUsage(response.usage),
        streamed: false,
      };
    }
    return {
      model: response.model,
      text,
      calls: [],
      usage: tryExtractUsage(response.usage),
      streamed: deltas.length > 0,
    };
  };
}

type GeminiPart = { text?: string; thought?: boolean; functionCall?: { name?: string; args?: Record<string, unknown> } };

function geminiLookupTools() {
  return [
    {
      functionDeclarations: ASK_LOOKUP_TOOLS.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.input_schema,
      })),
    },
  ];
}

function turnFromGeminiParts(
  parts: GeminiPart[],
  model: string,
  usage: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number },
  streamed: boolean,
): LookupModelTurn {
  const calls = parts
    .map((part) => part.functionCall)
    .filter((call): call is { name?: string; args?: Record<string, unknown> } => Boolean(call?.name))
    .map((call) => ({ name: String(call.name), input: call.args ?? {} }));
  const text = parts
    .filter((part) => !part.thought)
    .map((part) => part.text ?? '')
    .join('')
    .trim();
  const inputTokens = usage.inputTokens ?? 0;
  const outputTokens = usage.outputTokens ?? 0;
  const cacheReadTokens = usage.cacheReadTokens ?? 0;
  return {
    model,
    text: calls.length ? '' : text,
    calls,
    usage: {
      inputTokens,
      outputTokens,
      cacheWrite5mTokens: 0,
      cacheWrite1hTokens: 0,
      cacheReadTokens,
      totalTokens: inputTokens + outputTokens + cacheReadTokens,
    },
    streamed: streamed && !calls.length,
  };
}

async function readGeminiLookupStream(
  response: Response,
  onToken: ((text: string) => void) | undefined,
  model: string,
): Promise<LookupModelTurn> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Gemini Ask stream returned no body');
  const decoder = new TextDecoder();
  let buffer = '';
  const parts: GeminiPart[] = [];
  let streamed = false;
  let modelVersion = model;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let sawCall = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split('\n');
    buffer = chunks.pop() ?? '';
    for (const line of chunks) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const raw = trimmed.slice(5).trim();
      if (!raw || raw === '[DONE]') continue;
      let payload: {
        candidates?: Array<{ content?: { parts?: GeminiPart[] } }>;
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; cachedContentTokenCount?: number };
        modelVersion?: string;
      };
      try {
        payload = JSON.parse(raw) as typeof payload;
      } catch {
        continue;
      }
      if (payload.modelVersion) modelVersion = payload.modelVersion;
      if (payload.usageMetadata?.promptTokenCount != null) inputTokens = payload.usageMetadata.promptTokenCount;
      if (payload.usageMetadata?.candidatesTokenCount != null) outputTokens = payload.usageMetadata.candidatesTokenCount;
      if (payload.usageMetadata?.cachedContentTokenCount != null) {
        cacheReadTokens = payload.usageMetadata.cachedContentTokenCount;
      }
      for (const part of payload.candidates?.[0]?.content?.parts ?? []) {
        parts.push(part);
        if (part.functionCall?.name) sawCall = true;
        const delta = part.thought ? '' : (part.text ?? '');
        if (delta && !sawCall) {
          streamed = true;
          onToken?.(delta);
        }
      }
    }
  }
  return turnFromGeminiParts(parts, modelVersion || model, { inputTokens, outputTokens, cacheReadTokens }, streamed);
}

async function geminiLookupTurn(input: {
  apiKey: string;
  system: string;
  stable?: string;
  user: string;
  route: AskModelRoute;
  fetchFn?: typeof fetch;
  signal?: AbortSignal;
  onToken?: (text: string) => void;
  onCache?: (state: 'hit' | 'miss' | 'skip') => void;
}): Promise<LookupModelTurn> {
  const fast = input.route === 'fast';
  const requested = fast ? askFastGeminiModel() : geminiAskModel('reasoning');
  const tools = geminiLookupTools();
  const stable = input.stable ?? '';
  const cacheName = geminiCachedContentName({
    apiKey: input.apiKey,
    model: requested,
    system: input.system,
    stable,
    tools,
    fetchFn: input.fetchFn,
  });
  input.onCache?.(cacheName ? 'hit' : stable.trim().length >= 800 ? 'miss' : 'skip');
  const body = cacheName
    ? {
        cachedContent: cacheName,
        contents: [{ role: 'user', parts: [{ text: input.user }] }],
      }
    : {
        system_instruction: { parts: [{ text: geminiSystemPrefix(input.system, stable) }] },
        contents: [{ role: 'user', parts: [{ text: input.user }] }],
        tools,
      };
  const posted = await requestGemini({
    apiKey: input.apiKey,
    model: requested,
    mode: fast ? 'interactive' : 'reasoning',
    maxTokens: fast ? 4096 : 8192,
    fetchFn: input.fetchFn,
    signal: input.signal,
    stream: Boolean(input.onToken),
    body,
  });
  if (input.onToken && posted.response.body) {
    return readGeminiLookupStream(posted.response, input.onToken, posted.model);
  }
  const payload = (await posted.response.json()) as {
    candidates?: Array<{ content?: { parts?: GeminiPart[] } }>;
    modelVersion?: string;
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; cachedContentTokenCount?: number };
  };
  const parts = payload.candidates?.[0]?.content?.parts ?? [];
  const turn = turnFromGeminiParts(
    parts,
    payload.modelVersion || posted.model,
    {
      inputTokens: payload.usageMetadata?.promptTokenCount,
      outputTokens: payload.usageMetadata?.candidatesTokenCount,
      cacheReadTokens: payload.usageMetadata?.cachedContentTokenCount,
    },
    false,
  );
  if (!turn.calls.length && turn.text && input.onToken) {
    input.onToken(turn.text);
    turn.streamed = true;
  }
  return turn;
}

export function providerLookupStep(input: {
  anthropicApiKey?: string | null;
  fetchFn?: typeof fetch;
  onToken?: (text: string) => void;
  /** Fast turns skip thinking. Deep turns keep adaptive thinking, then Gemini. */
  route?: AskModelRoute;
  onCache?: (state: 'hit' | 'miss' | 'skip') => void;
}): LookupModelStep {
  const route = input.route ?? 'deep';
  const anthropicKey = (input.anthropicApiKey ?? anthropicAskApiKey()).trim();
  const fastModel = askFastAnthropicModel();
  const deepModel = askReasoningConfig().anthropicModel;
  const shaped = route === 'fast' ? null : anthropicReasoningRequest(deepModel);
  const anthropic =
    anthropicKey
      ? anthropicLookupSession({
          apiKey: anthropicKey,
          model: route === 'fast' ? fastModel : deepModel,
          maxTokens: shaped?.max_tokens ?? anthropicFastRequest().max_tokens,
          thinking: shaped?.thinking,
          outputConfig: shaped?.output_config,
          onToken: input.onToken,
        })
      : null;
  let provider: 'anthropic' | 'google' | 'none' = anthropic
    ? 'anthropic'
    : googleVisionApiKey()
      ? 'google'
      : 'none';
  const deadline = Date.now() + (route === 'fast' ? Math.min(askReasoningTimeoutMs(), 18_000) : askReasoningTimeoutMs());
  return async (state) => {
    const left = deadline - Date.now();
    if (left < 1500) return null;
    const signal = AbortSignal.timeout(left);
    const prior = formatTrace(state.trace);
    const user = prior
      ? `${state.user}\n\nTool results so far:\n${prior}\n\nUse another tool if you still need a fact. Otherwise answer from these results only.`
      : route === 'fast'
        ? state.user
        : `${state.user}\n\nLook up what you need before you answer.`;
    if (provider === 'anthropic' && anthropic) {
      try {
        return await anthropic({
          system: state.system,
          stable: state.stable,
          user: state.user,
          trace: state.trace,
          signal,
        });
      } catch (err) {
        logAskFailure(route === 'fast' ? 'ask_lookup_fast_failed' : 'ask_lookup_anthropic_failed', err);
        if (route === 'fast') return null;
        provider = googleVisionApiKey() ? 'google' : 'none';
      }
    }
    if (route === 'fast' && provider === 'anthropic') return null;
    if (provider === 'google' || (route === 'fast' && googleVisionApiKey() && !anthropic)) {
      try {
        return await geminiLookupTurn({
          apiKey: googleVisionApiKey(),
          system: state.system,
          stable: state.stable,
          user,
          route,
          fetchFn: input.fetchFn,
          signal,
          onToken: input.onToken,
          onCache: input.onCache,
        });
      } catch (err) {
        logAskFailure(route === 'fast' ? 'ask_lookup_fast_failed' : 'ask_lookup_gemini_failed', err);
        provider = 'none';
      }
    }
    return null;
  };
}

export async function answerFromAskLookup(input: {
  question: string;
  catalog: AskLookupCatalog;
  history?: Array<{ role?: string | null; text?: string | null }> | null;
  /** Rolling summary and durable notes for turns older than the verbatim window. */
  memory?: LongThreadMemory | null;
  extra?: string | null;
  anthropicApiKey?: string | null;
  fetchFn?: typeof fetch;
  onToken?: (text: string) => void;
  onStatus?: (phase: string) => void;
  /** Set when the reader stops the answer. A stopped turn is not stored. */
  signal?: AbortSignal;
  /** Test double. Production routes by difficulty, then falls back to the deep model. */
  step?: LookupModelStep;
  /** Filled with model, route, tool durations, and cache reads. No transcript text. */
  timing?: AskTurnClock | null;
}): Promise<{
  answer: string;
  model: string | null;
  usage: MeasuredUsage | null;
  trace: AskLookupTraceStep[];
  followUps: string[];
  answeredFromLookup: true;
}> {
  const resolved = resolveAskQuestion(input.question, input.history, input.catalog);
  const memoryBlock = formatThreadMemoryForPrompt(input.memory, input.catalog.timeZone);
  const promptInput = {
    question: input.question,
    resolved,
    catalog: input.catalog,
    history: input.history,
    extra: [memoryBlock, input.extra?.trim()].filter(Boolean).join('\n\n'),
  };
  const fullUser = buildLookupUserPrompt(promptInput);
  const parts = splitLookupPrompt(promptInput);
  const onToken = (text: string) => {
    if (text) input.timing?.markFirstToken();
    input.onToken?.(text);
  };
  const trace: AskLookupTraceStep[] = [];
  let model: string | null = null;
  let usage: MeasuredUsage | null = null;
  let prose = '';
  let streamed = false;
  const stopped = () => input.signal?.aborted === true;
  const runCalls = (calls: Array<{ name: string; input: Record<string, unknown> }>) => {
    if (stopped() || !calls.length) return;
    const batch = calls.slice(0, 6);
    input.onStatus?.(askLookupStatus(batch[0]!.name));
    const rows = batch.map((call) => {
      const started = performance.now();
      const result = executeAskLookup(call.name, call.input, input.catalog);
      input.timing?.addTool(call.name, performance.now() - started);
      return { tool: call.name, input: call.input, result };
    });
    trace.push(...rows);
  };
  input.onStatus?.('Looking through clips…');
  let forcedOther = false;
  const consume = async (active: LookupModelStep, userText: string, limit: number, systemText = LOOKUP_SYSTEM) => {
    for (let i = 0; i < limit && !stopped(); i += 1) {
      const turn = await active({ system: systemText, stable: parts.stable, user: userText, trace });
      if (!turn || stopped()) break;
      model = turn.model || model;
      input.timing?.noteModel(model);
      if (turn.usage) {
        usage = turn.usage;
        input.timing?.addCacheRead(turn.usage.cacheReadTokens);
      }
      if (turn.calls.length) {
        streamed = false;
        runCalls(turn.calls);
        continue;
      }
      if (
        !forcedOther &&
        asksAboutOtherJobs(resolved) &&
        !trace.some((row) => row.tool === 'search_other_jobs')
      ) {
        forcedOther = true;
        streamed = false;
        runCalls(continueAskLookup(resolved, input.catalog, trace));
        continue;
      }
      prose = turn.text;
      streamed = Boolean(turn.streamed);
      break;
    }
  };

  if (input.step) {
    input.timing?.noteRoute('deep', 'provided_step');
    await consume(input.step, fullUser, 6);
  } else {
    const decision = routeAskQuestion({
      question: input.question,
      resolved,
      history: input.history,
      catalog: input.catalog,
    });
    input.timing?.noteRoute(decision.route, decision.reason);
    if (input.timing) {
      input.timing.promptCache = Boolean((input.anthropicApiKey ?? anthropicAskApiKey()).trim());
    }
    const stepFor = (route: AskModelRoute) =>
      providerLookupStep({
        route,
        anthropicApiKey: input.anthropicApiKey,
        fetchFn: input.fetchFn,
        onToken,
        onCache: (state) => input.timing?.noteGeminiCache(state),
      });
    if (decision.route === 'fast') {
      await consume(stepFor('fast'), parts.volatile, 3, LOOKUP_SYSTEM_FAST);
      const traceHasHit = trace.some(
        (step) => step.result.ok && JSON.stringify(step.result.data ?? '').length > 40,
      );
      if (!stopped() && fastAnswerNeedsDeepFallback(resolved, prose, traceHasHit)) {
        input.timing?.noteRoute('deep', decision.reason, true);
        prose = '';
        streamed = false;
        input.onStatus?.('Looking through clips…');
        const deepUser = trace.length
          ? `${parts.volatile}\n\nTool results so far:\n${formatTrace(trace)}\n\nAnswer from these results. Use another tool only if a fact is still missing.`
          : parts.volatile;
        await consume(stepFor('deep'), deepUser, 4);
      }
    } else {
      await consume(stepFor('deep'), parts.volatile, 6);
    }
  }

  if (!prose && !stopped()) {
    if (!trace.length) {
      runCalls(planAskLookup(resolved, input.catalog, input.history));
    }
    for (let round = 0; round < 2 && !stopped(); round += 1) {
      const more = continueAskLookup(resolved, input.catalog, trace);
      if (!more.length) break;
      runCalls(more);
    }
    const completed = stopped()
      ? null
      : await completeAskText({
      system: LOOKUP_SYSTEM,
      user: `${fullUser}\n\nTool results so far:\n${formatTrace(trace) || '(none)'}\n\nAnswer from the job context, the earlier turns, and these tool results. If they do not contain it, say what is on the file instead.`,
      anthropicApiKey: input.anthropicApiKey,
      fetchFn: input.fetchFn,
      mode: 'reasoning',
      onToken,
    });
    if (completed?.text) {
      prose = completed.text;
      model = completed.model;
      input.timing?.noteModel(model);
      usage = completed.usage;
      if (completed.usage) input.timing?.addCacheRead(completed.usage.cacheReadTokens);
      streamed = true;
    } else {
      prose = composeGroundedAsk(resolved, trace, input.catalog, input.history, input.memory);
      model = null;
      streamed = false;
    }
  }

  if (stopped()) {
    return {
      answer: scrubStoredAskText(prose, input.catalog.clips),
      model,
      usage,
      trace,
      followUps: [],
      answeredFromLookup: true,
    };
  }

  const finalized = finalizeLookupAnswer(prose, trace, input.catalog, resolved);
  const answer = scrubStoredAskText(finalized.answer, input.catalog.clips);
  if (!streamed) onToken(answer);
  return {
    answer,
    model,
    usage,
    trace,
    followUps: finalized.followUps,
    answeredFromLookup: true,
  };
}
