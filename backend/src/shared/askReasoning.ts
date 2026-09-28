/**
 * Multi-step Ask over lookup tools, on the strongest configured model.
 *
 * Anthropic (ANTHROPIC_MODEL) runs with extended thinking. If that call fails
 * or hits the latency cap, Gemini (ASK_ANALYSIS_MODEL / ASK_ANALYSIS_THINKING_LEVEL)
 * answers from the same tools. If both fail, the reply is only what the tools returned.
 */
import { anthropicClientForKey, tryExtractUsage, type MeasuredUsage } from '../lib/anthropic.js';
import {
  anthropicAskApiKey,
  askReasoningConfig,
  askReasoningThinkingBudget,
  askReasoningTimeoutMs,
  completeAskText,
  geminiAskModel,
} from '../lib/askModel.js';
import { googleVisionApiKey } from '../lib/visionProvider.js';
import { logger } from '../lib/logger.js';
import {
  ASK_LOOKUP_TOOLS,
  buildLookupUserPrompt,
  collectMomentSourceIds,
  executeAskLookup,
  planAskLookup,
  quotesFromTrace,
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
import { classifyAskIntent, composeGroundedAsk, polishAskProse, wrapTaskArtifact } from './askPolish.js';
import { normalizeAskSources, parseSourceTrailerIds } from './askSources.js';

const LOOKUP_SYSTEM = `You are a sharp project manager writing to a colleague or a client. You answer from this job file by looking things up. You have tools. Use them before you write.

Rules:
1. Call a tool when the answer depends on what was said, who filmed a clip, what the visits show, or what job history records. Gather what you need over several steps. Do not guess.
2. Stay strictly grounded in tool results. Never invent clips, quotes, times, people, rooms, defects, or scope.
3. If the file lacks something, say that in one short sentence, then give the best answer the file does support.
4. The first sentence is the answer. Then only the detail the reader needs. No "Certainly", "Great question", or other filler.
5. Write clean markdown: short paragraphs, bullets only for parallel items, **bold** for the key fact, a table when comparing visits. No raw ids, no UTC (use the timestamps the tools already localized), no duplicated job names, no stray transcript fragments in the prose.
6. A request to produce something (homeowner summary, scope note, visit comparison, open issues, punch list) is a task. Deliver the finished note, wrapped as:
   ⟦artifact⟧
   the copyable note
   ⟦/artifact⟧
   The sentence before that wrapper is the answer, not a preamble.
7. Cite a spoken moment as video/<jobId>/<proofId>/<slug>@<seconds> using cite and atSeconds from the tool. Omit @seconds when the tool has no timing.
8. After the prose, append exactly one sources line and, only when a tool returned a spoken excerpt the question asked for, one quotes line:
   ⟦sources: video/<jobId>/<proofId>/<slug>@<seconds>⟧
   ⟦quotes: video/<jobId>/<proofId>/<slug>@<seconds>|Speaker|verbatim excerpt⟧
9. Then append two or three follow-up questions the tool results can answer:
   ⟦followups: question one? ;; question two?⟧
10. Do not put those machine lines inside the sentences. Never write [[web:…]] or "(Source: …)".
11. On a tool-call turn, do not write the answer yet.`;

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
    case 'search_transcripts':
      return 'Searching transcripts';
    case 'get_clip':
      return 'Reading a clip';
    case 'list_person_activity':
      return 'Checking who did what';
    case 'read_job_history':
      return 'Reading job history';
    default:
      return 'Looking through the file';
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
  const kept = cited.length ? cited : [...allowed].slice(0, 4);
  text = text.replace(/(?:\n|^)\s*⟦sources:\s*[^⟧]*⟧\s*/i, '').trim();
  text = polishAskProse(text, { timeZone: catalog.timeZone, jobTitle: catalog.jobTitle });
  if (classifyAskIntent(question).kind === 'task') text = wrapTaskArtifact(text);
  const spoken = /\b(say|said|quote|transcript|tell|mention)\b/i.test(question);
  const quoteTrace = trace.filter(
    (step) => step.tool === 'search_transcripts' || (spoken && step.tool === 'get_clip'),
  );
  const quotes = quotesFromTrace(quoteTrace).filter((quote) => {
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
    return words.length > 0 && words.some((word) => hay.includes(word));
  });
  const followUps = [...modelFollows];
  for (const suggestion of suggestFollowUps(question, trace, catalog)) {
    if (followUps.length >= 3) break;
    if (!followUps.some((item) => item.toLowerCase() === suggestion.toLowerCase())) followUps.push(suggestion);
  }
  const blocks = [text.trim()];
  if (kept.length) blocks.push(`⟦sources: ${kept.join(', ')}⟧`);
  const quoteLine = formatQuoteTrailer(quotes.slice(0, 3));
  if (quoteLine) blocks.push(quoteLine);
  const followLine = formatFollowupTrailer(followUps);
  if (followLine) blocks.push(followLine);
  return {
    answer: blocks.filter(Boolean).join('\n\n').trim(),
    followUps: followLine ? parseFollowupTrailer(followLine) : [],
  };
}

function errorDetail(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).replace(/\s+/g, ' ').slice(0, 280);
}

async function anthropicLookupTurn(input: {
  apiKey: string;
  system: string;
  user: string;
  signal?: AbortSignal;
  onToken?: (text: string) => void;
}): Promise<LookupModelTurn> {
  const config = askReasoningConfig();
  const budget = askReasoningThinkingBudget();
  const maxTokens = Math.max(2048, (budget ?? 0) + 1024);
  const stream = anthropicClientForKey(input.apiKey).messages.stream(
    {
      model: config.anthropicModel,
      max_tokens: maxTokens,
      system: input.system,
      messages: [{ role: 'user', content: input.user }],
      tools: ASK_LOOKUP_TOOLS.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.input_schema as { type: 'object'; properties?: unknown },
      })),
      ...(budget ? { thinking: { type: 'enabled' as const, budget_tokens: budget } } : {}),
    },
    input.signal ? { signal: input.signal } : undefined,
  );
  let streamed = false;
  const deltas: string[] = [];
  // Hold text until the turn is finished. A tool_use turn often starts with a
  // short preface; forwarding it would paint text the caller then discards.
  stream.on('text', (delta: string) => {
    if (!delta) return;
    deltas.push(delta);
  });
  const response = await stream.finalMessage();
  const calls = response.content
    .filter((block: { type: string }) => block.type === 'tool_use')
    .map((block: { type: string; name?: string; input?: unknown }) => ({
      name: String(block.name ?? ''),
      input: block.input && typeof block.input === 'object' ? (block.input as Record<string, unknown>) : {},
    }))
    .filter((call) => call.name);
  const text =
    deltas.join('').trim() ||
    response.content
      .filter((block: { type: string }) => block.type === 'text')
      .map((block: { type: string; text?: string }) => block.text ?? '')
      .join('\n')
      .trim();
  if (!calls.length) {
    for (const delta of deltas) {
      streamed = true;
      input.onToken?.(delta);
    }
  }
  return {
    model: response.model,
    text: calls.length ? '' : text,
    calls,
    usage: tryExtractUsage(response.usage),
    streamed: calls.length ? false : streamed,
  };
}

async function geminiLookupTurn(input: {
  apiKey: string;
  system: string;
  user: string;
  fetchFn?: typeof fetch;
  signal?: AbortSignal;
}): Promise<LookupModelTurn> {
  const model = geminiAskModel('reasoning');
  const fetchFn = input.fetchFn ?? fetch;
  const base = (process.env.GOOGLE_BASE_URL || 'https://generativelanguage.googleapis.com').replace(/\/+$/, '');
  const url = `${base}/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const response = await fetchFn(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': input.apiKey },
    signal: input.signal,
    body: JSON.stringify({
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
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 4096,
        thinkingConfig: { thinkingBudget: askReasoningThinkingBudget() ?? 0 },
      },
    }),
  });
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini lookup error ${response.status}: ${errText.slice(0, 300)}`);
  }
  const payload = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string; functionCall?: { name?: string; args?: Record<string, unknown> } }> } }>;
    modelVersion?: string;
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  };
  const parts = payload.candidates?.[0]?.content?.parts ?? [];
  const calls = parts
    .map((part) => part.functionCall)
    .filter((call): call is { name?: string; args?: Record<string, unknown> } => Boolean(call?.name))
    .map((call) => ({ name: String(call.name), input: call.args ?? {} }));
  const text = parts.map((part) => part.text ?? '').join('').trim();
  const inputTokens = payload.usageMetadata?.promptTokenCount ?? 0;
  const outputTokens = payload.usageMetadata?.candidatesTokenCount ?? 0;
  return {
    model: payload.modelVersion || model,
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
  let provider: 'anthropic' | 'google' | 'none' = (input.anthropicApiKey ?? anthropicAskApiKey()).trim()
    ? 'anthropic'
    : googleVisionApiKey()
      ? 'google'
      : 'none';
  const deadline = Date.now() + askReasoningTimeoutMs();
  return async (state) => {
    const left = deadline - Date.now();
    if (left < 1500) return null;
    const signal = AbortSignal.timeout(left);
    const prior = formatTrace(state.trace);
    const user = prior
      ? `${state.user}\n\nTool results so far:\n${prior}\n\nUse another tool if you still need a fact. Otherwise answer from these results only.`
      : `${state.user}\n\nLook up what you need before you answer.`;
    if (provider === 'anthropic') {
      try {
        return await anthropicLookupTurn({
          apiKey: (input.anthropicApiKey ?? anthropicAskApiKey()).trim(),
          system: state.system,
          user,
          signal,
          onToken: input.onToken,
        });
      } catch (err) {
        logger.warn('ask_lookup_anthropic_failed', { detail: errorDetail(err) });
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
        logger.warn('ask_lookup_gemini_failed', { detail: errorDetail(err) });
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
  extra?: string | null;
  anthropicApiKey?: string | null;
  fetchFn?: typeof fetch;
  onToken?: (text: string) => void;
  onStatus?: (phase: string) => void;
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
  const user = buildLookupUserPrompt({
    question: input.question,
    catalog: input.catalog,
    history: input.history,
    extra: input.extra,
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
  input.onStatus?.('thinking');
  for (let i = 0; i < 4; i += 1) {
    const turn = await step({ system, user, trace });
    if (!turn) break;
    model = turn.model || model;
    if (turn.usage) usage = turn.usage;
    if (turn.calls.length) {
      streamed = false;
      for (const call of turn.calls.slice(0, 3)) {
        input.onStatus?.(askLookupStatus(call.name));
        trace.push({
          tool: call.name,
          input: call.input,
          result: executeAskLookup(call.name, call.input, input.catalog),
        });
      }
      continue;
    }
    prose = turn.text;
    streamed = Boolean(turn.streamed);
    break;
  }

  if (!prose) {
    if (!trace.length) {
      for (const call of planAskLookup(input.question, input.catalog)) {
        input.onStatus?.(askLookupStatus(call.name));
        trace.push({
          tool: call.name,
          input: call.input,
          result: executeAskLookup(call.name, call.input, input.catalog),
        });
      }
    }
    const completed = await completeAskText({
      system,
      user: `${user}\n\nTool results so far:\n${formatTrace(trace) || '(none)'}\n\nAnswer only from those results. If they do not contain it, say it is not in the file.`,
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
      prose = composeGroundedAsk(input.question, trace, input.catalog);
      model = null;
      streamed = false;
    }
  }

  const finalized = finalizeLookupAnswer(prose, trace, input.catalog, input.question);
  if (!streamed) input.onToken?.(finalized.answer);
  return {
    answer: finalized.answer,
    model,
    usage,
    trace,
    followUps: finalized.followUps,
    answeredFromLookup: true,
  };
}
