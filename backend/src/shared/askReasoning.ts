/**
 * Multi-step Ask over lookup tools, on the strongest configured model.
 *
 * Anthropic (ANTHROPIC_MODEL) runs with extended thinking. If that call fails
 * or hits the latency cap, Gemini (ASK_ANALYSIS_MODEL / ASK_ANALYSIS_THINKING_LEVEL)
 * answers from the same tools. If both fail, the reply is only what the tools returned.
 */
import Anthropic from '@anthropic-ai/sdk';
import { anthropicClientForKey, tryExtractUsage, type MeasuredUsage } from '../lib/anthropic.js';
import {
  anthropicAskApiKey,
  anthropicReasoningRequest,
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
 */
function anthropicLookupSession(input: {
  apiKey: string;
  onToken?: (text: string) => void;
}): (state: { system: string; user: string; trace: AskLookupTraceStep[]; signal?: AbortSignal }) => Promise<LookupModelTurn> {
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
    const shaped = anthropicReasoningRequest(askReasoningConfig().anthropicModel);
    const stream = anthropicClientForKey(input.apiKey).messages.stream(
      {
        model: askReasoningConfig().anthropicModel,
        max_tokens: shaped.max_tokens,
        system: state.system,
        messages,
        tools: LOOKUP_TOOLS,
        ...(shaped.thinking ? { thinking: shaped.thinking } : {}),
        ...(shaped.output_config ? { output_config: shaped.output_config } : {}),
      },
      state.signal ? { signal: state.signal } : undefined,
    );
    const deltas: string[] = [];
    stream.on('text', (delta: string) => {
      if (delta) deltas.push(delta);
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
    for (const delta of deltas) input.onToken?.(delta);
    return {
      model: response.model,
      text,
      calls: [],
      usage: tryExtractUsage(response.usage),
      streamed: deltas.length > 0,
    };
  };
}

async function geminiLookupTurn(input: {
  apiKey: string;
  system: string;
  user: string;
  fetchFn?: typeof fetch;
  signal?: AbortSignal;
}): Promise<LookupModelTurn> {
  const requested = geminiAskModel('reasoning');
  const posted = await requestGemini({
    apiKey: input.apiKey,
    model: requested,
    mode: 'reasoning',
    maxTokens: 8192,
    fetchFn: input.fetchFn,
    signal: input.signal,
    body: {
      system_instruction: { parts: [{ text: input.system }] },
      contents: [{ role: 'user', parts: [{ text: input.user }] }],
      tools: [
        {
          functionDeclarations: ASK_LOOKUP_TOOLS.map((tool) => ({
            name: tool.name,
            description: tool.description,
            parameters: tool.input_schema,
          })),
        },
      ],
    },
  });
  const payload = (await posted.response.json()) as {
    candidates?: Array<{
      content?: {
        parts?: Array<{ text?: string; thought?: boolean; functionCall?: { name?: string; args?: Record<string, unknown> } }>;
      };
    }>;
    modelVersion?: string;
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  };
  const parts = payload.candidates?.[0]?.content?.parts ?? [];
  const calls = parts
    .map((part) => part.functionCall)
    .filter((call): call is { name?: string; args?: Record<string, unknown> } => Boolean(call?.name))
    .map((call) => ({ name: String(call.name), input: call.args ?? {} }));
  const text = parts
    .filter((part) => !part.thought)
    .map((part) => part.text ?? '')
    .join('')
    .trim();
  const inputTokens = payload.usageMetadata?.promptTokenCount ?? 0;
  const outputTokens = payload.usageMetadata?.candidatesTokenCount ?? 0;
  return {
    model: payload.modelVersion || posted.model,
    text: calls.length ? '' : text,
    calls,
    usage: {
      inputTokens,
      outputTokens,
      cacheWrite5mTokens: 0,
      cacheWrite1hTokens: 0,
      cacheReadTokens: 0,
      totalTokens: inputTokens + outputTokens,
    },
    streamed: false,
  };
}

export function providerLookupStep(input: {
  anthropicApiKey?: string | null;
  fetchFn?: typeof fetch;
  onToken?: (text: string) => void;
}): LookupModelStep {
  const anthropicKey = (input.anthropicApiKey ?? anthropicAskApiKey()).trim();
  let provider: 'anthropic' | 'google' | 'none' = anthropicKey
    ? 'anthropic'
    : googleVisionApiKey()
      ? 'google'
      : 'none';
  const anthropic = anthropicKey
    ? anthropicLookupSession({ apiKey: anthropicKey, onToken: input.onToken })
    : null;
  const deadline = Date.now() + askReasoningTimeoutMs();
  return async (state) => {
    const left = deadline - Date.now();
    if (left < 1500) return null;
    const signal = AbortSignal.timeout(left);
    const prior = formatTrace(state.trace);
    const user = prior
      ? `${state.user}\n\nTool results so far:\n${prior}\n\nUse another tool if you still need a fact. Otherwise answer from these results only.`
      : `${state.user}\n\nLook up what you need before you answer.`;
    if (provider === 'anthropic' && anthropic) {
      try {
        return await anthropic({ system: state.system, user: state.user, trace: state.trace, signal });
      } catch (err) {
        logAskFailure('ask_lookup_anthropic_failed', err);
        provider = googleVisionApiKey() ? 'google' : 'none';
      }
    }
    if (provider === 'google') {
      try {
        return await geminiLookupTurn({
          apiKey: googleVisionApiKey(),
          system: state.system,
          user,
          fetchFn: input.fetchFn,
          signal,
        });
      } catch (err) {
        logAskFailure('ask_lookup_gemini_failed', err);
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
  /** Test double. Production uses the configured Anthropic model, then Gemini. */
  step?: LookupModelStep;
}): Promise<{
  answer: string;
  model: string | null;
  usage: MeasuredUsage | null;
  trace: AskLookupTraceStep[];
  followUps: string[];
  answeredFromLookup: true;
}> {
  const system = LOOKUP_SYSTEM;
  const resolved = resolveAskQuestion(input.question, input.history, input.catalog);
  const memoryBlock = formatThreadMemoryForPrompt(input.memory, input.catalog.timeZone);
  const user = buildLookupUserPrompt({
    question: input.question,
    resolved,
    catalog: input.catalog,
    history: input.history,
    extra: [memoryBlock, input.extra?.trim()].filter(Boolean).join('\n\n'),
  });
  const step = input.step ?? providerLookupStep({
    anthropicApiKey: input.anthropicApiKey,
    fetchFn: input.fetchFn,
    onToken: input.onToken,
  });
  const trace: AskLookupTraceStep[] = [];
  let model: string | null = null;
  let usage: MeasuredUsage | null = null;
  let prose = '';
  let streamed = false;
  const stopped = () => input.signal?.aborted === true;
  const runCall = (call: { name: string; input: Record<string, unknown> }) => {
    if (stopped()) return;
    input.onStatus?.(askLookupStatus(call.name));
    trace.push({
      tool: call.name,
      input: call.input,
      result: executeAskLookup(call.name, call.input, input.catalog),
    });
  };
  input.onStatus?.('Looking through clips…');
  let forcedOther = false;
  for (let i = 0; i < 6 && !stopped(); i += 1) {
    const turn = await step({ system, user, trace });
    if (!turn || stopped()) break;
    model = turn.model || model;
    if (turn.usage) usage = turn.usage;
    if (turn.calls.length) {
      streamed = false;
      for (const call of turn.calls.slice(0, 6)) runCall(call);
      continue;
    }
    if (
      !forcedOther &&
      asksAboutOtherJobs(resolved) &&
      !trace.some((row) => row.tool === 'search_other_jobs')
    ) {
      forcedOther = true;
      streamed = false;
      for (const call of continueAskLookup(resolved, input.catalog, trace)) runCall(call);
      continue;
    }
    prose = turn.text;
    streamed = Boolean(turn.streamed);
    break;
  }

  if (!prose && !stopped()) {
    if (!trace.length) {
      for (const call of planAskLookup(resolved, input.catalog, input.history)) runCall(call);
    }
    for (let round = 0; round < 2 && !stopped(); round += 1) {
      const more = continueAskLookup(resolved, input.catalog, trace);
      if (!more.length) break;
      for (const call of more) runCall(call);
    }
    const completed = stopped()
      ? null
      : await completeAskText({
      system,
      user: `${user}\n\nTool results so far:\n${formatTrace(trace) || '(none)'}\n\nAnswer from the job context, the earlier turns, and these tool results. If they do not contain it, say what is on the file instead.`,
      anthropicApiKey: input.anthropicApiKey,
      fetchFn: input.fetchFn,
      mode: 'reasoning',
      onToken: input.onToken,
    });
    if (completed?.text) {
      prose = completed.text;
      model = completed.model;
      usage = completed.usage;
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
  if (!streamed) input.onToken?.(answer);
  return {
    answer,
    model,
    usage,
    trace,
    followUps: finalized.followUps,
    answeredFromLookup: true,
  };
}
