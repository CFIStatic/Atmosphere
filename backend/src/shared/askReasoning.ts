/**
 * Multi-step Ask over lookup tools.
 *
 * Simple factual / inventory Ask turns use a fast model with thinking off
 * (Gemini Flash / ASK_FAST_MODEL by default; Anthropic Sonnet fallback; Opus on deep) and a trimmed
 * job-context card. Quotes, evidence, drafts, comparisons, and multi-step
 * questions stay on ANTHROPIC_MODEL (Opus 5.5) with adaptive thinking and the
 * full file. If the fast model fails or returns nothing grounded, the deep
 * model answers from the same tools. If that also fails, Gemini
 * (ASK_ANALYSIS_MODEL) is the last model, then the reply is only what the
 * tools returned.
 *
 * Retrieval-first context (summary + top-k; optional ASK_STUFF_JOB_CONTEXT
 * stuffing) plus the system prompt are a cached Anthropic / Gemini prefix
 * (askPromptCache). Text tokens stream as they arrive.
 */
import { type MeasuredUsage } from '../lib/anthropic.js';
import { mergeMeasuredUsages } from '../lib/providerUsage.js';
import {
  anthropicAskApiKey,
  askInteractiveDeepEffort,
  type AnthropicEffort,
  askReasoningTimeoutMs,
  completeAskText,
  logAskFailure,
} from '../lib/askModel.js';
import {
  asksAboutOtherJobs,
  ASK_FAST_CONTEXT_BUDGET,
  ASK_FAST_JOB_FILE_BUDGET,
  buildLookupUserPrompt,
  continueAskLookup,
  executeAskLookup,
  planAskLookup,
  scrubStoredAskText,
  splitLookupPrompt,
  type AskLookupCatalog,
  type AskLookupResult,
  type AskLookupTraceStep,
} from './askLookup.js';
import { composeGroundedAsk, resolveAskQuestion } from './askPolish.js';
import { formatThreadMemoryForPrompt, type LongThreadMemory } from './askMemory.js';
import { formatOrgMemoryForPrompt, type OrgMemoryFact } from './askOrgMemory.js';
import {
  fastAnswerNeedsDeepFallback,
  logAskRouteDecision,
  needsCriticalEscalation,
  resolveAskRoute,
  type AskModelRoute,
} from './askRoute.js';
import { unscopedAdminOrNull } from '../lib/scopedAdmin.js';
import {
  ASK_RESEARCH_BUDGET_MS,
  ASK_RESEARCH_SYNTHESIS_RESERVE_MS,
  logAskResearch,
  routeAskResearch,
  runAskResearch,
  type AskResearchTrace,
  type ResearchComplete,
} from './askResearch.js';
import type { AskTurnClock } from './askTiming.js';
import {
  evidenceTraceStep,
  formatEvidenceForPrompt,
  isTopicSpeechQuestion,
  retrievedChunksFor,
} from './askEvidenceAnswer.js';
import { enforceQuoteGrounding } from './askQuoteGrounding.js';
import { ensureClaimCitations } from './askClaimCitations.js';
import { answerHasJobCitation, applyHonestNotFound } from './askNotFound.js';
import { chunkClipTranscript, retrieveAskEvidence, type TranscriptChunk } from './askTranscriptIndex.js';
import { buildRetrievalAskContext, rememberAskSearchMeta } from './askRetrievalContext.js';
import { buildGroundingIndex, verifyAskAnswer } from './askVerify.js';
import { stripExternalAskLinks } from './askWebSearch.js';

import {
  LOOKUP_SYSTEM,
  LOOKUP_SYSTEM_FAST,
  askLookupStatus,
  formatTrace,
  finalizeLookupAnswer,
} from './askLookupPrompts.js';
import type { LookupModelStep } from './askLookupPrompts.js';
import {
  ASK_ACTION_COMMAND,
  withAskSituation,
  webSearchLookupResult,
  askLookupDeadlineAt,
  providerLookupStep,
} from './askLookupProviders.js';
import type { AskActionModelTool } from './askLookupProviders.js';
import { groundLookupAnswer } from './askLookupGrounding.js';
export { askLookupStatus, finalizeLookupAnswer } from './askLookupPrompts.js';
export type { LookupModelTurn, LookupModelStep } from './askLookupPrompts.js';
export {
  START_COMPUTER_MODEL_TOOL,
  geminiLookupTools,
  askLookupDeadlineAt,
  providerLookupStep,
} from './askLookupProviders.js';
export type { AskActionModelTool } from './askLookupProviders.js';
export { groundLookupAnswer } from './askLookupGrounding.js';

export async function answerFromAskLookup(input: {
  question: string;
  catalog: AskLookupCatalog;
  history?: Array<{ role?: string | null; text?: string | null }> | null;
  /** Rolling summary and durable notes for turns older than the verbatim window. */
  memory?: LongThreadMemory | null;
  /** Org-wide company memory already filtered for this caller's job access. */
  orgMemory?: OrgMemoryFact[] | null;
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
  /** The turn already ran its web search; the model gets no second round. */
  webSearchDone?: boolean;
  /** Clear the reader's live preview (tool call after a preface, model escalation). */
  onPreviewReset?: () => void;
  /** Install the sentence check the live preview runs before showing text. */
  setPreviewCheck?: (check: ((sentence: string) => boolean) | null) => void;
  /**
   * Office job Chat with Computer available. The model may call
   * start_computer_task; `start` runs it and returns the reply for the turn.
   * `preferDeep` puts the turn on the strongest Ask model (commands and
   * follow-ups about Computer results).
   */
  computer?: {
    start: (args: { instructions: string; start_url?: string | null }) => Promise<string>;
    preferDeep?: boolean;
  } | null;
  /**
   * Office job Chat: actions the model may call mid-answer (propose a text,
   * update the job file, read the CRM or the access list). Anything that
   * reaches a person or removes access only proposes an approval card.
   */
  actions?: {
    tools: AskActionModelTool[];
    run: (name: string, input: Record<string, unknown>) => Promise<AskLookupResult>;
  } | null;
}): Promise<{
  answer: string;
  model: string | null;
  usage: MeasuredUsage | null;
  /** Set when the model handed this turn to Computer; `answer` is the task reply. */
  computerStarted?: boolean;
  trace: AskLookupTraceStep[];
  followUps: string[];
  answeredFromLookup: true;
  /** Transcript chunks this Ask retrieved. The final quote check verifies against these. */
  retrievedChunks: TranscriptChunk[];
  /** Compact research trace for debugging. Absent on the single pass. */
  research?: AskResearchTrace | null;
}> {
  const resolved = resolveAskQuestion(input.question, input.history, input.catalog);
  const memoryBlock = [
    formatOrgMemoryForPrompt(input.orgMemory ?? []),
    formatThreadMemoryForPrompt(input.memory, input.catalog.timeZone),
  ]
    .filter(Boolean)
    .join('\n\n');
  // Retrieval runs first, over transcript chunks and summaries, so the exact
  // lines for the question's topic are in front of the model (and the
  // fallback) whatever the lookup plan does.
  const evidence = retrieveAskEvidence(input.catalog, resolved);
  const topicQuestion = isTopicSpeechQuestion(resolved, evidence);
  const evidenceBlock = formatEvidenceForPrompt(evidence, topicQuestion);
  // Routing (heuristics, then a Flash classifier only when unsure) runs side
  // by side with retrieval instead of after it.
  const routePromise: Promise<Awaited<ReturnType<typeof resolveAskRoute>>> | null = input.step
    ? null
    : resolveAskRoute({
        question: input.question,
        resolved,
        history: input.history,
        catalog: input.catalog,
        fetchFn: input.fetchFn,
      });
  const retrieval = await buildRetrievalAskContext({
    catalog: input.catalog,
    question: resolved,
    jobFileRecord: input.jobFileRecord ?? null,
    fetchFn: input.fetchFn,
  });
  const promptInput = {
    question: input.question,
    resolved,
    catalog: input.catalog,
    history: input.history,
    extra: [memoryBlock, input.extra?.trim(), evidenceBlock].filter(Boolean).join('\n\n'),
    jobFileRecord: input.jobFileRecord ?? null,
    stableOverride: retrieval.stable,
  };
  let parts = splitLookupPrompt(promptInput);
  let fullUser = buildLookupUserPrompt(promptInput);
  rememberAskSearchMeta(input.catalog.jobId, retrieval.searched);
  const onToken = (text: string) => {
    if (text) input.timing?.markFirstToken();
    input.onToken?.(text);
  };
  const trace: AskLookupTraceStep[] = [];
  let model: string | null = null;
  let usage: MeasuredUsage | null = null;
  let prose = '';
  let streamed = false;
  // Live preview shows a sentence only when the same verifier the final answer
  // runs finds nothing unsupported in it (names, dates, times, refs, quotes).
  if (input.setPreviewCheck) {
    let indexedAt = -1;
    let index: ReturnType<typeof buildGroundingIndex> | null = null;
    const previewMemory = [
      formatOrgMemoryForPrompt(input.orgMemory ?? []),
      formatThreadMemoryForPrompt(input.memory, input.catalog.timeZone),
    ]
      .filter(Boolean)
      .join('\n\n');
    input.setPreviewCheck((sentence: string) => {
      try {
        if (!index || indexedAt !== trace.length) {
          index = buildGroundingIndex({
            catalog: input.catalog,
            extra: [previewMemory, input.extra ?? '', formatTrace(trace)].filter(Boolean).join('\n\n'),
            question: input.question,
          });
          indexedAt = trace.length;
        }
        return verifyAskAnswer(sentence, index).open.length === 0;
      } catch {
        return false;
      }
    });
  }
  const stopped = () => input.signal?.aborted === true;
  const actionNames = new Set((input.actions?.tools ?? []).map((tool) => tool.name));
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
            : input.actions && actionNames.has(call.name)
              ? await input.actions.run(call.name, call.input).catch(
                  (): AskLookupResult => ({ ok: false, tool: call.name, summary: 'That action did not go through.' }),
                )
              : executeAskLookup(call.name, call.input, input.catalog);
        input.timing?.addTool(call.name, performance.now() - started);
        return { tool: call.name, input: call.input, result };
      }),
    );
    trace.push(...rows);
  };
  let forcedOther = false;
  let computerAnswer: string | null = null;
  let researchMeta: AskResearchTrace | null = null;
  let researchFellBack = false;
  const askStarted = Date.now();
  // A command ("text Dana what changed since the first visit") needs the
  // action tools, which only the single pass offers.
  const researchDecision =
    input.researchMode === 'off'
      ? { route: 'single' as const, reason: 'off' }
      : input.actions?.tools.length && ASK_ACTION_COMMAND.test(resolved)
        ? { route: 'single' as const, reason: 'action_command' }
        : routeAskResearch(resolved);
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
        // A "let me check" preface streamed before the tool call is not the answer.
        input.onPreviewReset?.();
        const computerCall = input.computer ? turn.calls.find((call) => call.name === 'start_computer_task') : null;
        if (computerCall && input.computer) {
          // A browser task is the whole turn.
          input.onStatus?.('Starting Computer…');
          const args = computerCall.input ?? {};
          const instructions = String(args.instructions ?? '').trim() || input.question;
          const startUrl = typeof args.start_url === 'string' ? args.start_url : null;
          computerAnswer = await input.computer.start({ instructions, start_url: startUrl });
          break;
        }
        await runCalls(turn.calls.filter((call) => call.name !== 'start_computer_task'));
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
        input.onPreviewReset?.();
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
    const routed = await routePromise!;
    const decision =
      input.computer?.preferDeep && routed.route === 'fast'
        ? { ...routed, route: 'deep' as const, reason: `computer_context:${routed.reason}` }
        : routed;
    input.timing?.noteRoute(decision.route, decision.reason);
    void logAskRouteDecision({
      orgId: input.catalog.orgId,
      jobId: input.catalog.jobId,
      question: resolved,
      route: decision.route,
      reason: decision.reason,
      unsure: decision.unsure,
      admin: unscopedAdminOrNull(),
    });
    if (input.timing) {
      // Anthropic cache_control on system + stable job context (askPromptCache).
      input.timing.promptCache = Boolean((input.anthropicApiKey ?? anthropicAskApiKey()).trim());
    }
    // Fast turns use a trimmed, transcript-light job card so Sonnet/Flash stay cheap.
    // Deep turns keep the full cached file. Same question on the same route shares the prefix.
    if (decision.route === 'fast') {
      const fastInput = {
        ...promptInput,
        contextBudget: ASK_FAST_CONTEXT_BUDGET,
        includeTranscripts: false,
        jobFileBudget: ASK_FAST_JOB_FILE_BUDGET,
      };
      parts = splitLookupPrompt(fastInput);
      fullUser = buildLookupUserPrompt(fastInput);
    }
    // Money, safety, disputes, and hard dates keep the full analysis effort.
    // Everything else on the deep model (overviews, quotes, drafts) uses the
    // interactive effort so the first sentence arrives sooner; the evidence,
    // grounding check, and quote check are the same either way.
    const keepHighEffort = needsCriticalEscalation(resolved) || needsCriticalEscalation(input.question);
    const deepEffort: AnthropicEffort | null = keepHighEffort ? null : askInteractiveDeepEffort();
    const stepFor = (route: AskModelRoute) =>
      providerLookupStep({
        route,
        anthropicApiKey: input.anthropicApiKey,
        fetchFn: input.fetchFn,
        onToken,
        onCache: (state) => input.timing?.noteGeminiCache(state),
        deadlineAt: researchFellBack ? askLookupDeadlineAt(askStarted, route) : undefined,
        webTool: !input.webSearchDone,
        effort: deepEffort,
        computerTool: Boolean(input.computer),
        actionTools: input.actions?.tools ?? [],
      });
    if (decision.route === 'fast') {
      await consume(stepFor('fast'), parts.volatile, 3, withAskSituation(LOOKUP_SYSTEM_FAST, input.catalog.timeZone));
      const traceHasHit = trace.some(
        (step) => step.result.ok && JSON.stringify(step.result.data ?? '').length > 40,
      );
      if (!stopped() && fastAnswerNeedsDeepFallback(resolved, prose, traceHasHit)) {
        input.timing?.noteRoute('deep', `escalate_low_confidence:${decision.reason}`, true);
        void logAskRouteDecision({
          orgId: input.catalog.orgId,
          jobId: input.catalog.jobId,
          question: resolved,
          route: 'deep',
          reason: `escalate_low_confidence:${decision.reason}`,
          unsure: true,
          admin: unscopedAdminOrNull(),
        });
        prose = '';
        streamed = false;
        input.onPreviewReset?.();
        input.onStatus?.('Looking through clips…');
        // Escalate with the full job file so grounding / quotes still hold.
        const deepInput = { ...promptInput };
        parts = splitLookupPrompt(deepInput);
        fullUser = buildLookupUserPrompt(deepInput);
        const deepUser = trace.length
          ? `${parts.volatile}\n\nTool results so far:\n${formatTrace(trace)}\n\nAnswer from these results. Use another tool only if a fact is still missing.`
          : parts.volatile;
        await consume(stepFor('deep'), deepUser, 4);
      }
    } else {
      await consume(stepFor('deep'), parts.volatile, 6);
    }
  }

  if (computerAnswer) {
    onToken(computerAnswer);
    return {
      answer: computerAnswer,
      model,
      usage,
      computerStarted: true,
      trace,
      followUps: [],
      answeredFromLookup: true,
      retrievedChunks: [],
      research: researchMeta,
    };
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
  const cited = ensureClaimCitations(answer, retrievedChunks);
  answer = cited.answer;
  // Use the shared helper so placeholder ⟦sources: videos⟧ does not count as grounded.
  const hasCite = answerHasJobCitation(answer);
  answer = applyHonestNotFound(answer, input.catalog, input.question, {
    // Only force Not found. when nothing on the answer is grounded to the file.
    noGroundedClaim: !hasCite,
  });
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
