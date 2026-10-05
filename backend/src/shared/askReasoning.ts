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
import { CHAT_VOICE_RULES } from './askProse.js';
import Anthropic from '@anthropic-ai/sdk';
import { anthropicClientForKey, tryExtractUsage, type MeasuredUsage } from '../lib/anthropic.js';
import { geminiMeasuredUsage, mergeMeasuredUsages } from '../lib/providerUsage.js';
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
import { toGeminiFunctionDeclaration } from './geminiSchema.js';
import {
  ASK_LOOKUP_TOOLS,
  asksAboutOtherJobs,
  buildLookupUserPrompt,
  clipsInScope,
  collectMomentSourceIds,
  continueAskLookup,
  executeAskLookup,
  followUpAnswerable,
  formatAskJobContext,
  planAskLookup,
  quotesFromTrace,
  redactClipTranscriptForAsk,
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
  localStamp,
  polishAskProse,
  resolveAskQuestion,
  speechQuotesForQuestion,
  wrapTaskArtifact,
} from './askPolish.js';
import { normalizeAskSources, parseSourceTrailerIds } from './askSources.js';
import { formatThreadMemoryForPrompt, type LongThreadMemory } from './askMemory.js';
import { fastAnswerNeedsDeepFallback, routeAskQuestion, type AskModelRoute } from './askRoute.js';
import {
  ASK_RESEARCH_BUDGET_MS,
  ASK_RESEARCH_SYNTHESIS_RESERVE_MS,
  logAskResearch,
  routeAskResearch,
  runAskResearch,
  type AskResearchTrace,
  type ResearchComplete,
} from './askResearch.js';
import {
  anthropicCachedSystem,
  asAnthropicSystem,
  geminiCachedContentName,
  geminiSystemPrefix,
} from './askPromptCache.js';
import type { AskTurnClock } from './askTiming.js';
import {
  evidenceTraceStep,
  formatEvidenceForPrompt,
  isTopicSpeechQuestion,
  retrievedChunksFor,
} from './askEvidenceAnswer.js';
import { enforceQuoteGrounding } from './askQuoteGrounding.js';
import { chunkClipTranscript, retrieveAskEvidence, type TranscriptChunk } from './askTranscriptIndex.js';
import {
  ASK_REPAIR_SYSTEM,
  buildGroundingIndex,
  formatRepairPrompt,
  normalizeForMatch,
  stripUnsupported,
  supportedProse,
  verifyAskAnswer,
} from './askVerify.js';
import {
  askClockSystemRules,
  askWebCapabilityRules,
  isAskWebSearchConfigured,
  plainWebModelText,
  searchAskWebDetailed,
  scrubWebDerivedAskAnswer,
  stripExternalAskLinks,
  webSearchModelPayload,
} from './askWebSearch.js';

const LOOKUP_SYSTEM = `You are a sharp project manager who knows every detail of this job — every clip, transcript, note, document, CRM field, room, and timeline event. The job context in this request already includes that file. You also have tools for deeper lookups. Use tools when a fact is missing from the context; otherwise answer from what you already have.

Rules:
1. The user message already includes the job context (project, address, client, clips, redacted transcripts, history, people) and earlier turns of this chat. Use that context for a broad question such as what the job is about. Call a tool when you need a cited spoken moment, one person's clips, or a detail the context does not already settle. Do not guess.
1b. Inventory questions ("what videos/clips do we have", "how many videos", "who is on this job", "what rooms", "what days were filmed") are answered from that job context: lead with the count, then one clean bullet per item with the date, the length when known, and what it shows. Never open with "nothing matches" or "this file does not have that" when the clips or people are listed in the context, and never dump truncated blurbs on one semicolon-joined line.
2. Stay strictly grounded in tool results. Never invent clips, quotes, times, people, rooms, defects, or scope.
3. If the file lacks something, say that in one short sentence, then give the best answer the file does support.
4. The first sentence is the answer. Then only the detail the reader needs. No "Certainly", "Great question", or other filler.
5. Write clean markdown: short paragraphs, bullets only for parallel items, **bold** sparingly for one key fact, a table when comparing visits. No raw ids, no UTC (use the timestamps the tools already localized), no duplicated job names, no stray transcript fragments in the prose.
6. A request to produce something (homeowner summary, scope note, visit comparison, open issues, punch list, email, estimate) is a task. Write a real document from the job context, wrapped as:
   ⟦artifact⟧
   the copyable note
   ⟦/artifact⟧
   The sentence before that wrapper is the answer, not a preamble. A homeowner summary is prose. An email has a greeting, a few natural sentences on what was done or seen, a next step, and a sign-off. A punch list and an estimate are different documents. None of them is a repeated list of clips. Never paste a vision clip title. Describe what happened.
7. Cite a spoken moment as video/<jobId>/<proofId>/<slug>@<seconds> using cite and atSeconds from the tool. Omit @seconds when the tool has no timing.
8. After the prose, append exactly one sources line and, only when a tool returned a spoken excerpt the question asked for, one quotes line:
   ⟦sources: video/<jobId>/<proofId>/<slug>@<seconds>⟧
   ⟦quotes: video/<jobId>/<proofId>/<slug>@<seconds>|Speaker label|verbatim excerpt|clip=Clip name⟧
9. Then append two or three follow-up questions the tool results can answer:
   ⟦followups: question one? ;; question two?⟧
10. Do not put those machine lines inside the sentences. Never write [[web:…]] or "(Source: …)".
11. On a tool-call turn, do not write the answer yet.
12. This is a conversation. Answer a greeting, a thanks, or a short reaction in a natural professional voice, and say what this job can answer. "Why" and "what do you think" stay tied to lines actually on the file; do not invent a motive. If the request could mean two days or two clips and the thread does not pick one, ask one short clarifying question. If the user is wrong, answer politely and name the day: "That line is actually from Sep 21 — here's the clip." Never write "The file does have that." Answer first. No canned filler. Never stop at one line that only says the file does not have it. A very short message ("?", "ok", "hi", "thanks") is conversation, not a question the file failed to answer: reply in a sentence or two and offer what this job can answer.
13. A thread can span days and weeks. Older turns may be a summary; the latest turns are verbatim. Durable notes are preferences and decisions, each dated to the turn it came from. When the user says "last week you said" or asks what was decided, answer from those notes and the summary, name that day, and do not invent a decision that is not written there.
14. Sound like a warm, clear colleague. The first sentence answers the question. Write full sentences. No canned filler. Use a table, a list, or a quote only when it makes the answer easier to scan.
15. Keep calling tools until the question is answered. When the user asks about other jobs in this organization, call search_other_jobs, then get_clip on those results. Do not search other jobs unless they asked. Do not end with "I checked the clips" or any similar footer. Sources belong in the sources line, which the reader sees as citation chips.
16. A homeowner email or an estimate draft is a finished note in the artifact wrapper. Never invent a price. If prices are not on the file, say that in a sentence and draft only from what was seen. Do not repeat the clip list. Offer one next step.
17. Use only the job context, the tool results, and the earlier turns in this request. No guessing and no outside knowledge about this job. When a fact is missing, write that it is not on file.
18. Quote only words that appear in a transcript line, exactly as written there, and cite that clip at the time the line was said. Put every quote in “ ” and follow it with the clip name and time, like “We need the permit.” (Kitchen walkthrough, 0:15). Never paraphrase inside quotation marks. When the request lists "Retrieved transcript lines", those are the exact lines that match the question: quote from them. If that list says nothing matched, say the transcripts do not mention it and do not quote other lines as if they were about it. Times, dates, clip clocks, job numbers, and names must be ones that appear in the context or tool results.
19. Speakers: use only diarization labels ("Speaker 1", "Speaker 2") or a name the file explicitly attaches to that speaker. Otherwise write "an unidentified speaker" and append nothing. Never infer a name (not even from who filmed the clip), a role (homeowner, adjuster, contractor, client), a posture, or a relationship, and never write visual labels such as "Person 1 (Seated…)" or "Seated man". When asked who committed to or will do something and the file does not identify that speaker, say the owner is an unidentified speaker.
20. Your answer is checked against the file before anyone sees it. Unsupported quotes, times, names, and speech counts are removed.
21. Each clip card gives the raw transcript (authoritative) and an AI summary (may be stale). The raw transcript decides what was said and how much. When the AI summary disagrees with the transcript, follow the transcript and do not repeat the summary's claim.
22. When the question asks how many (lines, utterances, quotes, times something was said), the first sentence is the number, counted from the raw transcript lines, for example "There are **5** lines in the transcript." Then list them if asked. Never lead with a summary.
23. When the question assumes something the file does not show (an object, a brand, an install, a person, an event, a visual detail), say that plainly in the first sentence, for example "The file does not show a ceiling light being installed, and no brand is visible or mentioned." Do not guess, and do not answer with a nearby detail as if it were the thing asked.
24. For a specific question, look up the exact transcript lines and timed events first (search_transcripts / get_clip); the AI summary is supplementary. Answer in one direct sentence, then only the supporting quotes with their times. Never paste a whole transcript for a narrow question.`;

/**
 * Fast turns already have the job file in the cached prefix. Answer from it
 * in the first response so a quote is not waiting on a tool round-trip.
 * Tools stay available when the line is not in that context.
 */
const LOOKUP_SYSTEM_FAST = `You are a sharp project manager writing to a colleague or a client. The job context in this request already includes the project, the clips, and the redacted transcripts. Answer from that context in this response.

Rules:
1. Start with the answer. The reader should see the first sentence before any tool call. Call a tool only when the spoken line or fact is not already in the job context.
1b. Inventory questions about the job's own videos, people, rooms, or filming days: answer from the job context with a count, then one bullet per item (date, length when known, what it shows). Never say "nothing matches" when those clips or people are listed, and never paste truncated one-line dumps.
2. Stay grounded in that context. Never invent clips, quotes, times, people, rooms, defects, or scope. Never repeat a line marked privacy redacted. If the file lacks it, say so in one sentence, then give the best answer the file does support.
3. Quote the words that were said. Cite the moment as video/<jobId>/<proofId>/<slug>@<seconds> using the timestamps already in the context. Omit @seconds when the line has no timing.
4. The first sentence is the answer. No "Certainly" or other filler. No raw ids, no UTC, no duplicated job names.
5. After the prose, append exactly one sources line and, when you quoted speech, one quotes line:
   ⟦sources: video/<jobId>/<proofId>/<slug>@<seconds>⟧
   ⟦quotes: video/<jobId>/<proofId>/<slug>@<seconds>|Speaker label|verbatim excerpt|clip=Clip name⟧
6. Then two or three follow-ups the file can answer:
   ⟦followups: question one? ;; question two?⟧
7. Do not put those machine lines inside the sentences.
8. Use only this context and tool results. No guessing. When a fact is missing, write that it is not on file.
9. Quote only exact words from a transcript line and cite that clip at the time the line was said. Put every quote in “ ” followed by the clip name and time, like “We need the permit.” (Kitchen walkthrough, 0:15). Never paraphrase inside quotation marks. When the request lists "Retrieved transcript lines", quote from them; if it says nothing matched, say the transcripts do not mention it. Times, dates, and names must appear in the context.
10. Speakers: only diarization labels ("Speaker 1") or a name the file explicitly gives that speaker. Otherwise write "an unidentified speaker" and append nothing. Never infer a name, role, posture, or relationship, and never write labels like "Person 1 (Seated…)". If asked who committed to something and the speaker is not identified, say the owner is an unidentified speaker.
11. The raw transcript (authoritative) decides what was said and how much. The AI summary may be stale; when they disagree, follow the transcript and do not repeat the summary's claim.
12. A "how many" question gets the number first, counted from the raw transcript lines: "There are **5** lines in the transcript." Then list them if asked.
13. When the question assumes something the file does not show (an object, a brand, an install, a person, a visual detail), say plainly in the first sentence that it is not in the evidence. Do not guess.
14. For a specific question, answer in one direct sentence from the exact transcript lines and timed events, then only the supporting quotes with their times. The AI summary is supplementary. Never paste a whole transcript for a narrow question.
15. A very short message ("?", "ok", "hi", "thanks") is conversation, not a question the file failed to answer: reply in a sentence or two and offer what this job can answer.`;

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
      const web = step.tool === 'web_search';
      const data = web ? webSearchModelPayload(step.result.data) : step.result.data;
      const payload = data != null ? `\n${JSON.stringify(data).slice(0, 6000)}` : '';
      const summary = web ? plainWebModelText(step.result.summary) : step.result.summary;
      return `### ${step.tool} (${step.result.ok ? 'ok' : 'failed'})\n${summary}${payload}`;
    })
    .join('\n\n');
}

export function finalizeLookupAnswer(
  prose: string,
  trace: AskLookupTraceStep[],
  catalog: AskLookupCatalog,
  question: string,
  opts?: { modelProduced?: boolean },
): { answer: string; followUps: string[] } {
  const modelProduced = opts?.modelProduced !== false;
  // No-model and model-failure prose is not a place to parse control markers.
  // Web text that leaked into that prose is stripped before any trailer parse.
  const sourceProse = modelProduced ? prose : scrubWebDerivedAskAnswer(prose);
  const allowed = new Set(collectMomentSourceIds(trace));
  let text = stripMomentTrailers(sourceProse);
  text = normalizeAskSources(text);
  const cited = (modelProduced ? parseSourceTrailerIds(text) : []).filter((id) => {
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
  const modelFollows = (modelProduced ? parseFollowupTrailer(sourceProse) : []).filter((item) => {
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

const WEB_SEARCH_MODEL_TOOL = {
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

function lookupModelTools() {
  if (!isAskWebSearchConfigured()) return LOOKUP_TOOLS;
  return [...LOOKUP_TOOLS, WEB_SEARCH_MODEL_TOOL];
}

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

function withAskSituation(system: string, timeZone?: string | null): string {
  return `${system}\n\n${CHAT_VOICE_RULES}\n\n${askClockSystemRules(new Date(), timeZone || 'America/Chicago')}\n\n${askWebCapabilityRules()}`;
}

async function webSearchLookupResult(
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
        tools: lookupModelTools(),
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

type GeminiPart = { text?: string; thought?: boolean; functionCall?: { name?: string; args?: Record<string, unknown> } };

export function geminiLookupTools() {
  return [
    {
      functionDeclarations: lookupModelTools().map(toGeminiFunctionDeclaration),
    },
  ];
}

function turnFromGeminiParts(
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

function groundingSourceText(
  catalog: AskLookupCatalog,
  trace: AskLookupTraceStep[],
  extra: string | null,
): string {
  const clips = clipsInScope(catalog)
    .map((clip) => {
      const when = clip.capturedAt || clip.workDate;
      const stamp = when ? localStamp(when, catalog.timeZone) || when : 'Undated';
      const transcript = redactClipTranscriptForAsk(clip);
      return `Clip ${clip.title} (${stamp}) cite video/${clip.jobId}/${clip.proofId}\n${transcript || '(no transcript)'}`;
    })
    .join('\n\n');
  return [formatAskJobContext(catalog), clips, extra?.trim() ?? '', formatTrace(trace)].filter(Boolean).join('\n\n');
}

function groundingFallback(
  resolved: string,
  trace: AskLookupTraceStep[],
  catalog: AskLookupCatalog,
  history: Array<{ role?: string | null; text?: string | null }> | null | undefined,
  memory: LongThreadMemory | null | undefined,
): string {
  const composed = stripMomentTrailers(composeGroundedAsk(resolved, trace, catalog, history, memory))
    .replace(/(?:\n|^)\s*⟦sources:[^⟧]*⟧\s*/gi, '')
    .trim();
  if (composed) return composed;
  const clips = clipsInScope(catalog);
  if (!clips.length) return 'This job file has no clips yet. Ask about the job details, the notes, or the history instead.';
  const list = clips
    .slice(0, 6)
    .map((clip) => `${clip.workDate ? localStamp(clip.workDate, catalog.timeZone) || clip.workDate : 'Undated'} — ${clip.title}`)
    .join('; ');
  return `Here is what is on this file: ${clips.length} clip${clips.length === 1 ? '' : 's'} (${list}). Ask about one of them and I can pull what was said.`;
}

/**
 * Verify a model answer against the job data. Trailer quotes and links are
 * fixed or dropped locally. Prose failures get one repair pass; anything still
 * unsupported is removed and named as not on file.
 */
export async function groundLookupAnswer(input: {
  answer: string;
  catalog: AskLookupCatalog;
  trace: AskLookupTraceStep[];
  extra: string | null;
  question: string;
  resolved: string;
  history?: Array<{ role?: string | null; text?: string | null }> | null;
  memory?: LongThreadMemory | null;
  anthropicApiKey?: string | null;
  fetchFn?: typeof fetch;
  signal?: AbortSignal;
  repair?: (input: { system: string; user: string }) => Promise<string | null>;
  now?: Date;
}): Promise<{
  answer: string;
  failures: ReturnType<typeof verifyAskAnswer>['failures'];
  verify: { quotesChecked: number; quotesFailed: number; claimsFailed: number; repaired: boolean; stripped: boolean };
}> {
  // The lookup prompt already showed this summary and these notes. Check and repair against them too.
  const memoryBlock = formatThreadMemoryForPrompt(input.memory, input.catalog.timeZone);
  const shown = [memoryBlock, input.extra].filter(Boolean).join('\n\n') || null;
  const index = buildGroundingIndex({
    catalog: input.catalog,
    extra: [shown, formatTrace(input.trace)].filter(Boolean).join('\n\n'),
    question: input.question,
    now: input.now,
  });
  const first = verifyAskAnswer(input.answer, index);
  const verify = {
    quotesChecked: first.quotesChecked,
    quotesFailed: first.quotesFailed,
    claimsFailed: first.open.filter((failure) => failure.kind !== 'quote').length,
    repaired: false,
    stripped: false,
  };
  const runRepair = async (failures: typeof first.open): Promise<string | null> => {
    if (input.signal?.aborted) return null;
    const system = ASK_REPAIR_SYSTEM;
    const user = formatRepairPrompt({
      answer: first.answer,
      failures,
      source: groundingSourceText(input.catalog, input.trace, shown),
    });
    try {
      return input.repair
        ? await input.repair({ system, user })
        : (
            await completeAskText({
              system,
              user,
              anthropicApiKey: input.anthropicApiKey,
              fetchFn: input.fetchFn,
              mode: 'interactive',
              maxTokens: 1600,
              signal: input.signal,
            })
          )?.text ?? null;
    } catch (err) {
      logAskFailure('ask_grounding_repair_failed', err);
      return null;
    }
  };
  const trailersOf = (text: string) => text.match(/⟦(?:sources|quotes|followups|actions):[^⟧]*⟧/gi) ?? [];
  const proseOf = (text: string) => text.replace(/⟦(?:sources|quotes|followups|actions):[^⟧]*⟧/gi, '').trim();

  if (!first.open.length) {
    // Every fact checks out. Answer-shape problems (no number for a count, no
    // time for a "when", a whole-transcript dump) get one repair attempt; the
    // repair is kept only when it is at least as grounded and better shaped.
    if (first.quality.length) {
      const text = await runRepair(first.quality);
      if (text?.trim()) {
        const second = verifyAskAnswer([proseOf(text), ...trailersOf(first.answer)].filter(Boolean).join('\n\n'), index);
        if (!second.open.length && second.quality.length < first.quality.length) {
          verify.repaired = true;
          return { answer: second.answer, failures: [...first.failures, ...first.quality], verify };
        }
      }
    }
    return { answer: first.answer, failures: first.failures, verify };
  }

  const repairedText = await runRepair(first.open);
  let current = first;
  if (repairedText?.trim()) {
    // Keep the checked trailers; take only the repaired prose.
    const second = verifyAskAnswer([proseOf(repairedText), ...trailersOf(first.answer)].filter(Boolean).join('\n\n'), index);
    if (!second.open.length) {
      verify.repaired = true;
      return { answer: second.answer, failures: [...first.failures, ...second.failures], verify };
    }
    // Strip whichever draft keeps more supported prose: a repair that made
    // things worse should not throw away sentences the first draft had right.
    const words = (draft: typeof first) => normalizeForMatch(supportedProse(draft.answer, draft.open)).split(' ').filter(Boolean).length;
    if (words(second) >= words(first)) current = second;
  }
  verify.stripped = true;
  const fallback = groundingFallback(input.resolved, input.trace, input.catalog, input.history, input.memory);
  return {
    answer: stripUnsupported(current.answer, current.open, fallback),
    failures: [...first.failures, ...(current === first ? [] : current.failures)],
    verify,
  };
}

export async function answerFromAskLookup(input: {
  question: string;
  catalog: AskLookupCatalog;
  history?: Array<{ role?: string | null; text?: string | null }> | null;
  /** Rolling summary and durable notes for turns older than the verbatim window. */
  memory?: LongThreadMemory | null;
  extra?: string | null;
  /** Non-clip job file record (docs, CRM, notes, scope). */
  jobFileRecord?: string | null;
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
  /** Test double for the one grounding repair pass. Production uses the Ask model. */
  repair?: (input: { system: string; user: string }) => Promise<string | null>;
  /**
   * `off` keeps the single pass (latency comparisons). Default routes hard
   * questions through the research loop.
   */
  researchMode?: 'auto' | 'off';
  /** Test doubles for the research loop. Production leaves these unset. */
  research?: {
    now?: () => number;
    maxSteps?: number;
    budgetMs?: number;
    synthesisReserveMs?: number;
    complete?: ResearchComplete | null;
  };
}): Promise<{
  answer: string;
  model: string | null;
  usage: MeasuredUsage | null;
  trace: AskLookupTraceStep[];
  followUps: string[];
  answeredFromLookup: true;
  /** Transcript chunks this Ask retrieved. The final quote check verifies against these. */
  retrievedChunks: TranscriptChunk[];
  /** Compact research trace for debugging. Absent on the single pass. */
  research?: AskResearchTrace | null;
}> {
  const resolved = resolveAskQuestion(input.question, input.history, input.catalog);
  const memoryBlock = formatThreadMemoryForPrompt(input.memory, input.catalog.timeZone);
  // Retrieval runs first, over transcript chunks and summaries, so the exact
  // lines for the question's topic are in front of the model (and the
  // fallback) whatever the lookup plan does.
  const evidence = retrieveAskEvidence(input.catalog, resolved);
  const topicQuestion = isTopicSpeechQuestion(resolved, evidence);
  const evidenceBlock = formatEvidenceForPrompt(evidence, topicQuestion);
  const promptInput = {
    question: input.question,
    resolved,
    catalog: input.catalog,
    history: input.history,
    extra: [memoryBlock, input.extra?.trim(), evidenceBlock].filter(Boolean).join('\n\n'),
    jobFileRecord: input.jobFileRecord ?? null,
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
  const runCalls = async (calls: Array<{ name: string; input: Record<string, unknown> }>) => {
    if (stopped() || !calls.length) return;
    const batch = calls.slice(0, 6);
    input.onStatus?.(batch[0]!.name === 'web_search' ? 'Searching the web…' : askLookupStatus(batch[0]!.name));
    const rows = await Promise.all(
      batch.map(async (call) => {
        const started = performance.now();
        const result =
          call.name === 'web_search'
            ? await webSearchLookupResult(call.input, input.fetchFn, input.catalog.timeZone)
            : executeAskLookup(call.name, call.input, input.catalog);
        input.timing?.addTool(call.name, performance.now() - started);
        return { tool: call.name, input: call.input, result };
      }),
    );
    trace.push(...rows);
  };
  let forcedOther = false;
  let researchMeta: AskResearchTrace | null = null;
  let researchFellBack = false;
  const askStarted = Date.now();
  const researchDecision =
    input.researchMode === 'off' ? { route: 'single' as const, reason: 'off' } : routeAskResearch(resolved);
  if (researchDecision.route === 'research' && !stopped()) {
    try {
      const askWindow = askReasoningTimeoutMs();
      const reserveMs =
        input.research?.synthesisReserveMs ?? Math.min(ASK_RESEARCH_SYNTHESIS_RESERVE_MS, askWindow);
      const budgetMs =
        input.research?.budgetMs ?? Math.min(ASK_RESEARCH_BUDGET_MS, Math.max(0, askWindow - reserveMs));
      const researched = await runAskResearch({
        question: resolved,
        catalog: input.catalog,
        history: input.history,
        memory: input.memory,
        extra: input.extra,
        anthropicApiKey: input.anthropicApiKey,
        fetchFn: input.fetchFn,
        signal: input.signal,
        now: input.research?.now,
        maxSteps: input.research?.maxSteps,
        budgetMs,
        synthesisReserveMs: reserveMs,
        complete: input.research?.complete,
      });
      if (!researched.answer.trim()) throw new Error('research_empty');
      prose = researched.answer;
      model = researched.model;
      usage = mergeMeasuredUsages([usage, researched.usage]);
      if (model) input.timing?.noteModel(model);
      trace.push(...researched.traceSteps);
      researchMeta = researched.meta;
      streamed = false;
      input.timing?.noteRoute('deep', `research_${researched.meta.stopReason}`);
    } catch (err) {
      logAskFailure('ask_research_fallback', err);
      prose = '';
      model = null;
      researchFellBack = true;
      researchMeta = { route: 'research', stopReason: 'fallback', steps: [], elapsedMs: 0 };
      logAskResearch(researchMeta);
      input.timing?.noteRoute('deep', 'research_fallback', true);
    }
  }
  if (!prose) {
  input.onStatus?.('Looking through clips…');
  const consume = async (
    active: LookupModelStep,
    userText: string,
    limit: number,
    systemText = withAskSituation(LOOKUP_SYSTEM, input.catalog.timeZone),
  ) => {
    for (let i = 0; i < limit && !stopped(); i += 1) {
      const turn = await active({ system: systemText, stable: parts.stable, user: userText, trace });
      if (!turn) break;
      const halt = stopped();
      model = turn.model || model;
      input.timing?.noteModel(model);
      if (turn.usage) {
        // Every provider call is billed: accumulate, never overwrite.
        usage = mergeMeasuredUsages([usage, turn.usage]);
        input.timing?.addCacheRead(turn.usage.cacheReadTokens);
      }
      if (turn.calls.length) {
        if (halt) break;
        streamed = false;
        await runCalls(turn.calls);
        continue;
      }
      if (
        !halt &&
        !forcedOther &&
        asksAboutOtherJobs(resolved) &&
        !trace.some((row) => row.tool === 'search_other_jobs')
      ) {
        forcedOther = true;
        streamed = false;
        await runCalls(continueAskLookup(resolved, input.catalog, trace));
        continue;
      }
      if (turn.text) prose = turn.text;
      streamed = Boolean(turn.streamed);
      if (halt) break;
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
        deadlineAt: researchFellBack ? askLookupDeadlineAt(askStarted, route) : undefined,
      });
    if (decision.route === 'fast') {
      await consume(stepFor('fast'), parts.volatile, 3, withAskSituation(LOOKUP_SYSTEM_FAST, input.catalog.timeZone));
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
      await runCalls(planAskLookup(resolved, input.catalog, input.history));
    }
    for (let round = 0; round < 2 && !stopped(); round += 1) {
      const more = continueAskLookup(resolved, input.catalog, trace);
      if (!more.length) break;
      await runCalls(more);
    }
    const completed = stopped()
      ? null
      : await completeAskText({
      system: withAskSituation(LOOKUP_SYSTEM, input.catalog.timeZone),
      user: `${fullUser}\n\nTool results so far:\n${formatTrace(trace) || '(none)'}\n\nAnswer from the job context, the earlier turns, and these tool results. If they do not contain it, say what is on the file instead.`,
      anthropicApiKey: input.anthropicApiKey,
      fetchFn: input.fetchFn,
      mode: 'reasoning',
      deadlineAt: researchFellBack ? askLookupDeadlineAt(askStarted, 'deep') : undefined,
      onToken,
    });
    if (completed?.text) {
      prose = completed.text;
      model = completed.model;
      input.timing?.noteModel(model);
      usage = mergeMeasuredUsages([usage, completed.usage]);
      if (completed.usage) input.timing?.addCacheRead(completed.usage.cacheReadTokens);
      streamed = true;
    } else {
      prose = composeGroundedAsk(resolved, trace, input.catalog, input.history, input.memory);
      model = null;
      streamed = false;
    }
  }
  }

  const retrievedChunks = retrievedChunksFor(evidence, trace, `${fullUser}\n\n${formatTrace(trace)}`);
  if (input.catalog.access !== 'viewer') {
    const opened = new Set<string>();
    for (const step of trace) {
      if (step.tool !== 'get_clip' || !step.result.ok) continue;
      const id = (step.result.data as { proofId?: unknown } | undefined)?.proofId;
      if (typeof id === 'string' && id) opened.add(id);
    }
    for (const clip of input.catalog.orgClips ?? []) {
      if (clip.orgId !== input.catalog.orgId || !opened.has(clip.proofId)) continue;
      for (const chunk of chunkClipTranscript(clip)) {
        if (!retrievedChunks.some((row) => row.key === chunk.key)) retrievedChunks.push(chunk);
      }
    }
  }
  if (stopped()) {
    return {
      answer: stripExternalAskLinks(scrubStoredAskText(prose, input.catalog.clips)),
      model,
      usage,
      trace,
      followUps: [],
      answeredFromLookup: true,
      retrievedChunks,
      research: researchMeta,
    };
  }

  if (topicQuestion) trace.unshift(evidenceTraceStep(evidence, input.catalog));
  const finalized = finalizeLookupAnswer(prose, trace, input.catalog, resolved, {
    modelProduced: Boolean(model),
  });
  let answer = scrubStoredAskText(finalized.answer, input.catalog.clips);
  if (model) {
    // A model wrote this. Check it against the file before it is stored or sent.
    const grounded = await groundLookupAnswer({
      answer,
      catalog: input.catalog,
      trace,
      extra: input.extra ?? null,
      question: input.question,
      resolved,
      history: input.history,
      memory: input.memory,
      anthropicApiKey: input.anthropicApiKey,
      fetchFn: input.fetchFn,
      signal: input.signal,
      repair: input.repair,
    });
    answer = scrubStoredAskText(grounded.answer, input.catalog.clips);
    input.timing?.noteVerify(grounded.verify);
  }
  // Every quote must be an exact retrieved transcript line, with its clip and time.
  answer = enforceQuoteGrounding(answer, { chunks: retrievedChunks, question: input.question }).answer;
  answer = stripExternalAskLinks(answer);
  if (!streamed) onToken(answer);
  return {
    answer,
    model,
    usage,
    trace,
    followUps: finalized.followUps,
    answeredFromLookup: true,
    retrievedChunks,
    research: researchMeta,
  };
}
