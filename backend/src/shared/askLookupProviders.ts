/**
 * Lookup Ask on each model provider: the tool list, the Anthropic tool session,
 * the Gemini turn, and the one step function that picks between them.
 */
import { CHAT_VOICE_RULES } from './askProse.js';
import Anthropic from '@anthropic-ai/sdk';
import { anthropicClientForKey, tryExtractUsage } from '../lib/anthropic.js';
import { geminiMeasuredUsage } from '../lib/providerUsage.js';
import {
  anthropicAskApiKey,
  anthropicFastRequest,
  anthropicReasoningRequest,
  askFastAnthropicModel,
  askFastGeminiModel,
  askReasoningConfig,
  type AnthropicEffort,
  askReasoningTimeoutMs,
  geminiAskModel,
  logAskFailure,
  requestGemini,
} from '../lib/askModel.js';
import { googleVisionApiKey } from '../lib/visionProvider.js';
import { toGeminiFunctionDeclaration } from './geminiSchema.js';
import { ASK_LOOKUP_TOOLS, type AskLookupTraceStep } from './askLookup.js';
import { type AskModelRoute } from './askRoute.js';
import {
  anthropicCachedSystem,
  asAnthropicSystem,
  geminiCachedContentName,
  geminiSystemPrefix,
} from './askPromptCache.js';
import {
  askClockSystemRules,
  askWebCapabilityRules,
  isAskWebSearchConfigured,
  plainWebModelText,
  searchAskWebDetailed,
  webSearchModelPayload,
} from './askWebSearch.js';

import { formatTrace } from './askLookupPrompts.js';
import type { LookupModelTurn, LookupModelStep } from './askLookupPrompts.js';

export const LOOKUP_TOOLS = ASK_LOOKUP_TOOLS.map((tool) => ({
  name: tool.name,
  description: tool.description,
  input_schema: tool.input_schema as { type: 'object'; properties?: unknown },
}));

export const WEB_SEARCH_MODEL_TOOL = {
  name: 'web_search',
  description:
    'Search the public web for anything the job file cannot answer. Do not use it to override job evidence. Include a resolved calendar date in the query for relative days. Optional include_domains limits results to hostnames such as homedepot.com or lowes.com.',
  input_schema: {
    type: 'object' as const,
    properties: {
      query: { type: 'string', description: 'Search query, including the calendar date when the user named a relative day.' },
      include_domains: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional hostnames, for example homedepot.com or lowes.com.',
      },
    },
    required: ['query'],
  },
};

/**
 * `includeWeb: false` when this turn already ran its one web search: the model
 * answers from those results instead of starting a second search round.
 */
/**
 * Office job Chat: the model may hand the turn to Computer (a real browser
 * with the company's saved Logins) when the person asks it to sign in to or
 * work on an outside site. The model decides; the server runs the task.
 */
export const START_COMPUTER_MODEL_TOOL = {
  name: 'start_computer_task',
  description:
    'Start Computer: open a real browser and do the work on an outside website or app for the person (Restore 365 / DASH, Xactimate, ' +
    'Outlook, Gmail, AccuLynx, JobNimbus, supplier portals, permit sites, or any saved Login). Call it whenever they ask you to log in to, ' +
    'sign in to, go into, open, check, look up, pull up or do something on a site or app outside Atmosphere — for example ' +
    '"log in to Restore 365 and tell me what jobs are running". Computer signs in with the saved Login (Company ID, username and password are typed ' +
    'by the server, never by you), shows a live view, and asks before anything is submitted. Never answer such a request from the job ' +
    'evidence and never say "Not found" for it. Do NOT call it for questions about this job file, earlier answers, or results Computer already returned.',
  input_schema: {
    type: 'object' as const,
    properties: {
      instructions: { type: 'string', description: 'What to do on the site, in the person\'s words, with any detail from earlier turns resolved.' },
      start_url: { type: 'string', description: 'Website to open first, only if the person named one.' },
    },
    required: ['instructions'],
  },
};

/** Words that make a turn a command for the office action tools. */
export const ASK_ACTION_COMMAND =
  /\b(?:text|sms|send|remove|revoke|update|change|rename|set|save|add (?:a |this )?note|log (?:a |this )?note)\b/i;

/** An office action Chat may call mid-answer (propose a text, update the file, read the CRM). */
export type AskActionModelTool = {
  name: string;
  description: string;
  input_schema: { type: 'object'; properties?: unknown; [key: string]: unknown };
};

export function lookupModelTools(includeWeb = true, includeComputer = false, actionTools: AskActionModelTool[] = []) {
  const base = !includeWeb || !isAskWebSearchConfigured() ? LOOKUP_TOOLS : [...LOOKUP_TOOLS, WEB_SEARCH_MODEL_TOOL];
  const withComputer = includeComputer ? [...base, START_COMPUTER_MODEL_TOOL] : base;
  return actionTools.length ? [...withComputer, ...actionTools] : withComputer;
}

export type LookupCall = { id: string; name: string; input: Record<string, unknown> };

export function toolUses(blocks: Anthropic.ContentBlock[]): LookupCall[] {
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

export function withAskSituation(system: string, timeZone?: string | null): string {
  return `${system}\n\n${CHAT_VOICE_RULES}\n\n${askClockSystemRules(new Date(), timeZone || 'America/Chicago')}\n\n${askWebCapabilityRules()}`;
}

export async function webSearchLookupResult(
  raw: Record<string, unknown>,
  fetchFn: typeof fetch | undefined,
  timeZone: string | null | undefined,
): Promise<{ ok: boolean; tool: string; summary: string; data?: unknown }> {
  const query = String(raw.query ?? raw.q ?? '').trim();
  if (!query) return { ok: false, tool: 'web_search', summary: 'Missing search query.' };
  const explicit = raw.include_domains ?? raw.includeDomains;
  const outcome = await searchAskWebDetailed(query, {
    fetchFn,
    limit: 5,
    includeDomains: Array.isArray(explicit) ? explicit.map((item) => String(item)) : undefined,
    timeZone: timeZone || 'America/Chicago',
  });
  return {
    ok: true,
    tool: 'web_search',
    summary: outcome.answer
      ? plainWebModelText(outcome.answer)
      : outcome.hits.length
        ? `Found ${outcome.hits.length} web result(s). Do not treat them as job evidence.`
        : 'No web results were found.',
    data: { answer: outcome.answer, results: outcome.hits },
  };
}

export function textFromBlocks(blocks: Anthropic.ContentBlock[]): string {
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
export function anthropicLookupSession(input: {
  apiKey: string;
  model: string;
  maxTokens: number;
  thinking?: { type: 'adaptive' } | { type: 'enabled'; budget_tokens: number };
  outputConfig?: { effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max' };
  onToken?: (text: string) => void;
  includeWeb?: boolean;
  includeComputer?: boolean;
  actionTools?: AskActionModelTool[];
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
          const web = step?.tool === 'web_search' || tool.name === 'web_search';
          const payload = step
            ? {
                ok: step.result.ok,
                summary: web ? plainWebModelText(step.result.summary) : step.result.summary,
                data: web ? webSearchModelPayload(step.result.data ?? null) : (step.result.data ?? null),
              }
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
        tools: lookupModelTools(input.includeWeb !== false, input.includeComputer === true, input.actionTools ?? []),
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
        usage: tryExtractUsage(response.usage, response.model ?? null),
        streamed: false,
      };
    }
    return {
      model: response.model,
      text,
      calls: [],
      usage: tryExtractUsage(response.usage, response.model ?? null),
      streamed: deltas.length > 0,
    };
  };
}

export type GeminiPart = { text?: string; thought?: boolean; functionCall?: { name?: string; args?: Record<string, unknown> } };

export function geminiLookupTools(includeWeb = true, includeComputer = false, actionTools: AskActionModelTool[] = []) {
  return [
    {
      functionDeclarations: lookupModelTools(includeWeb, includeComputer, actionTools).map(toGeminiFunctionDeclaration),
    },
  ];
}

export function turnFromGeminiParts(
  parts: GeminiPart[],
  model: string,
  usageMetadata: unknown,
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
  return {
    model,
    text: calls.length ? '' : text,
    calls,
    // Provider-reported: prompt includes cached tokens, output adds thinking.
    usage: geminiMeasuredUsage(usageMetadata, model),
    streamed: streamed && !calls.length,
  };
}

export async function readGeminiLookupStream(
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
  let usageMetadata: unknown = null;
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
        usageMetadata?: Record<string, unknown>;
        modelVersion?: string;
      };
      try {
        payload = JSON.parse(raw) as typeof payload;
      } catch {
        continue;
      }
      if (payload.modelVersion) modelVersion = payload.modelVersion;
      // Each chunk carries the running usageMetadata; the last one is final.
      if (payload.usageMetadata) usageMetadata = payload.usageMetadata;
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
  return turnFromGeminiParts(parts, modelVersion || model, usageMetadata, streamed);
}

export async function geminiLookupTurn(input: {
  apiKey: string;
  system: string;
  stable?: string;
  user: string;
  route: AskModelRoute;
  fetchFn?: typeof fetch;
  signal?: AbortSignal;
  onToken?: (text: string) => void;
  onCache?: (state: 'hit' | 'miss' | 'skip') => void;
  includeWeb?: boolean;
  includeComputer?: boolean;
  actionTools?: AskActionModelTool[];
}): Promise<LookupModelTurn> {
  const fast = input.route === 'fast';
  const requested = fast ? askFastGeminiModel() : geminiAskModel('reasoning');
  const tools = geminiLookupTools(input.includeWeb !== false, input.includeComputer === true, input.actionTools ?? []);
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
    usageMetadata?: Record<string, unknown>;
  };
  const parts = payload.candidates?.[0]?.content?.parts ?? [];
  const turn = turnFromGeminiParts(parts, payload.modelVersion || posted.model, payload.usageMetadata ?? null, false);
  if (!turn.calls.length && turn.text && input.onToken) {
    input.onToken(turn.text);
    turn.streamed = true;
  }
  return turn;
}

/** Absolute time the single pass must stop. Fast turns stay inside 18s of the Ask timeout. */
export function askLookupDeadlineAt(startedAt: number, route: AskModelRoute, timeoutMs = askReasoningTimeoutMs()): number {
  const windowMs = route === 'fast' ? Math.min(timeoutMs, 18_000) : timeoutMs;
  return startedAt + windowMs;
}

export function providerLookupStep(input: {
  anthropicApiKey?: string | null;
  fetchFn?: typeof fetch;
  onToken?: (text: string) => void;
  /** Fast turns skip thinking. Deep turns keep adaptive thinking, then Gemini. */
  route?: AskModelRoute;
  onCache?: (state: 'hit' | 'miss' | 'skip') => void;
  /**
   * When set, the turn uses this absolute deadline instead of starting a new
   * window. Research fallback passes the deadline captured when Ask began.
   */
  deadlineAt?: number;
  /** False when the turn already searched the web once (one search round max). */
  webTool?: boolean;
  /** Deep turns only: Opus effort for this question (see askInteractiveDeepEffort). */
  effort?: AnthropicEffort | null;
  /** Offer start_computer_task to the model (office job Chat with Computer). */
  computerTool?: boolean;
  /** Office actions the model may call (texts, file updates, CRM, access). */
  actionTools?: AskActionModelTool[];
}): LookupModelStep {
  const includeComputer = input.computerTool === true;
  const actionTools = input.actionTools ?? [];
  const route = input.route ?? 'deep';
  const includeWeb = input.webTool !== false;
  const anthropicKey = (input.anthropicApiKey ?? anthropicAskApiKey()).trim();
  const fastModel = askFastAnthropicModel();
  const deepModel = askReasoningConfig().anthropicModel;
  const shaped = route === 'fast' ? null : anthropicReasoningRequest(deepModel, input.effort ?? null);
  const anthropic =
    anthropicKey
      ? anthropicLookupSession({
          apiKey: anthropicKey,
          model: route === 'fast' ? fastModel : deepModel,
          maxTokens: shaped?.max_tokens ?? anthropicFastRequest().max_tokens,
          thinking: shaped?.thinking,
          outputConfig: shaped?.output_config,
          onToken: input.onToken,
          includeWeb,
          includeComputer,
          actionTools,
        })
      : null;
  // Simple / lookup (fast): prefer Gemini Flash — cheapest capable on providers we
  // already use. Deep keeps Anthropic-first. Critical escalation stays in askRoute.
  const googleKey = googleVisionApiKey();
  let provider: 'anthropic' | 'google' | 'none' =
    route === 'fast'
      ? googleKey
        ? 'google'
        : anthropic
          ? 'anthropic'
          : 'none'
      : anthropic
        ? 'anthropic'
        : googleKey
          ? 'google'
          : 'none';
  const deadline = input.deadlineAt ?? askLookupDeadlineAt(Date.now(), route);
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
    if (provider === 'google' && googleKey) {
      try {
        return await geminiLookupTurn({
          apiKey: googleKey,
          system: state.system,
          stable: state.stable,
          user,
          route,
          fetchFn: input.fetchFn,
          signal,
          onToken: input.onToken,
          onCache: input.onCache,
          includeWeb,
          includeComputer,
          actionTools,
        });
      } catch (err) {
        logAskFailure(route === 'fast' ? 'ask_lookup_fast_failed' : 'ask_lookup_gemini_failed', err);
        // Fast: fall through to Anthropic Sonnet if Gemini fails; deep already may have used Anthropic first.
        provider = route === 'fast' && anthropic ? 'anthropic' : 'none';
        if (provider === 'none') return null;
      }
    }
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
        provider = googleKey ? 'google' : 'none';
        if (provider === 'google') {
          try {
            return await geminiLookupTurn({
              apiKey: googleKey,
              system: state.system,
              stable: state.stable,
              user,
              route,
              fetchFn: input.fetchFn,
              signal,
              onToken: input.onToken,
              onCache: input.onCache,
              includeWeb,
              includeComputer,
              actionTools,
            });
          } catch (err2) {
            logAskFailure('ask_lookup_gemini_failed', err2);
            return null;
          }
        }
        return null;
      }
    }
    return null;
  };
}
