import { logAskRouteDecision } from './askRoute.js';
import { looksLikeNotFound } from './askNotFound.js';
/**
 * Ask the whole job file — not only the videos.
 *
 * The office page is one file: brief facts (any keys), scope including
 * do-nots, notes, invited companies, tasks, crew, work logs, memory, uploaded
 * documents, and clip readings. A question like "what's the lockbox" or
 * "who is invited" is answerable from that record even when nothing has been
 * filmed. When a model key is wired (server ANTHROPIC_API_KEY, the org's
 * connected key, or GEMINI_API_KEY / GOOGLE_API_KEY) it writes the prose;
 * otherwise a grounded lookup still answers from the same text.
 */
import { completeAskText, isAskModelConfigured } from '../lib/askModel.js';
import { answerHasJobCitation } from './askNotFound.js';
import type { AskTurnClock } from './askTiming.js';
import { answerFromAskLookup } from './askReasoning.js';
import { answerRoomQuestion, isRoomQuestion } from './roomIntelligence.js';
import { roomClipsFromCatalog } from './askLookup.js';
import type { AskResearchTrace } from './askResearch.js';
import { enforceQuoteGrounding } from './askQuoteGrounding.js';
import {
  chatUploadShouldAnswer,
  documentChunksForGrounding,
  sessionAnswerIsPrivate,
  type AskDocumentView,
} from '../documents/answer.js';
import { answerChatUploadsWithModel } from './askUploadAnswer.js';
import { computerCapabilityAnswer, looksLikeComputerCapabilityAsk } from './askComputerCapability.js';
import { computerStatus } from '../computer/service.js';
import { formatComputerResultsForPrompt, loadAskComputerContext } from './askComputerContext.js';
import { looksLikeOutsideSiteCommand } from './askComputerCommand.js';
import { formatThreadMemoryForPrompt, isLongMemoryQuestion, type LongThreadMemory } from './askMemory.js';
import { formatOrgMemoryForPrompt, type OrgMemoryFact } from './askOrgMemory.js';
import {
  askAgentEnabled,
  runAskAgent,
  warmAskAgent,
  type AskAgentInput,
  type AskAgentWarmCall,
} from './askAgent.js';
import { anthropicAskApiKey, logAskFailure } from '../lib/askModel.js';
import type { AskLookupCatalog, AskLookupClip } from './askLookup.js';
import { loadClipStills } from './clipStills.js';
import { unscopedAdminOrNull } from '../lib/scopedAdmin.js';
import { normalizeAskProse, trimChatFiller } from './askProse.js';
import { stylePromptAddendum } from './askCommunicationStyle.js';
import { mergeMeasuredUsages } from '../lib/providerUsage.js';
import { type MeasuredUsage } from '../lib/anthropic.js';
import {
  ASK_WEB_EMPTY_RESULTS_NOTE,
  ASK_WEB_FORMAT_RULES,
  askClockSystemRules,
  askWebCapabilityRules,
  formatAskWebContext,
  includeDomainsForAsk,
  looksLikePureWebCapabilityAsk,
  professionalWebCapabilityAnswer,
  searchAskWebDetailed,
  shouldSearchWebBeforeAnswer,
  asksAboutJobFile,
  isGeneralAsk,
  type AskWebHit,
  type AskWebSearchFn,
} from './askWebSearch.js';
import {
  collectWebHitsFromToolResults,
  executeAskTool,
  formatActionsTrailer,
  formatAskToolResultsForModel,
  parseJobFieldUpdatesFromQuestion,
  partitionAskTools,
  pickAskToolsHeuristically,
  askModelActionTools,
  type AskToolContext,
  type AskToolResult,
} from './askTools.js';
import {
  FILE_QA_SYSTEM,
  trim,
  jobFileHasContent,
  countJobFileSources,
  formatJobFileRecord,
  isChatSmallTalk,
  groundedJobFileAnswer,
  readableJobFileAnswer,
  preferJobFileGroundedFastPath,
  assembleMentionModelPrompt,
} from './jobFileAskRecord.js';
import type { JobFileAskTurn, JobFileAskContext } from './jobFileAskRecord.js';
import {
  webFallbackAnswer,
  generalJobCard,
  answerGeneralQuestion,
  applyWebResults,
} from './jobFileAskWeb.js';
import {
  documentViews,
  keepDocumentAnswer,
  readableUploads,
  answerFromChatUploads,
  answerQuotesPrivateUpload,
  historyWithoutPrivateUploads,
  answerFromAttachedDocuments,
} from './jobFileAskUploads.js';
export {
  jobFileCorpus,
  jobFileHasContent,
  countJobFileSources,
  formatJobFileRecord,
  isChatSmallTalk,
  groundedJobFileAnswer,
  readableJobFileAnswer,
  preferJobFileGroundedFastPath,
  assembleMentionModelPrompt,
} from './jobFileAskRecord.js';
export type {
  JobFileAskJob,
  JobFileAskScopeLine,
  JobFileAskMessage,
  JobFileAskParty,
  JobFileAskTask,
  JobFileAskCrew,
  JobFileAskLog,
  JobFileAskDocument,
  JobFileAskTurn,
  JobFileAskContext,
} from './jobFileAskRecord.js';
export { generalJobCard, answerGeneralQuestion, summarizeWebResultsForAsk } from './jobFileAskWeb.js';
export { answerQuotesPrivateUpload, historyWithoutPrivateUploads } from './jobFileAskUploads.js';

/** The one line above a Computer task card in Chat. */

/** The step a person sees while a Chat tool runs (null: no separate step). */
export function toolStepLabel(tool: string): string | null {
  switch (tool) {
    case 'get_crm_record':
    case 'search_crm':
      return 'Checking the CRM…';
    case 'update_job_fields':
      return 'Updating the job…';
    case 'send_job_sms':
      return 'Drafting the text…';
    case 'propose_revoke_access':
    case 'list_who_has_access':
      return 'Checking who has access…';
    case 'get_punch_list':
      return 'Reading the punch list…';
    case 'find_evidence_moments':
      return 'Finding the moment…';
    case 'draft_progress_share_copy':
    case 'draft_site_digest_copy':
    case 'draft_field_invite_copy':
      return 'Drafting…';
    case 'get_job_status':
    case 'get_job_fields':
      return 'Reading the job…';
    default:
      return null;
  }
}

/** The reply for a turn handed to Computer: one short line, then the task card. */
export function computerTurnAnswer(computer: AskToolResult): string {
  const lead = computer.ok
    ? computer.summary || COMPUTER_LEAD
    : computer.ui?.path === 'computer-task:not-set-up'
      ? "I can't work in a browser for you yet."
      : computer.summary;
  return `${lead}\n\n${formatActionsTrailer([computer])}`;
}

export const COMPUTER_LEAD = "Opening a browser now, and I'll check with you before anything is submitted.";

/**
 * True when this thread already stored the same answer moments ago.
 * A stream failure that retries as JSON must not insert a second turn.
 */
export function isDuplicateAskTurn(
  recent: { answer?: string | null; thread_id?: string | null } | null | undefined,
  threadId: string | null | undefined,
  answer: string,
): boolean {
  if (!recent) return false;
  const sameThread = !threadId || !recent.thread_id || recent.thread_id === threadId;
  return sameThread && String(recent.answer ?? '').trim() === answer.trim();
}


/** Never attach web results to a job not-found answer. */
export function clearWebOnNotFound<T extends { answer: string; webHits?: unknown[]; webDerivedAnswer?: boolean }>(
  result: T,
): T {
  const ans = String(result.answer ?? '');
  if (!looksLikeNotFound(ans) && !/^Not found\./i.test(ans)) return result;
  return { ...result, webHits: [], webDerivedAnswer: false };
}

/**
 * True when this reply leans on web results and nothing in it points back to
 * the job (no clip, document, or field citation). Such a reply must not carry
 * the "From this job file" line.
 */
export function webBackedWithoutJobCite(
  answer: string,
  webHits: AskWebHit[] | null | undefined,
  webAnswer: string | null | undefined,
  webDerived?: boolean,
): boolean {
  if (webDerived) return true;
  const usedWeb = (webHits?.length ?? 0) > 0 || Boolean(trim(webAnswer));
  if (!usedWeb) return false;
  return !answerHasJobCitation(answer);
}

/** Saved key frames for look_at_clip; off when the server has no storage access. */
function stillsLoader() {
  const admin = unscopedAdminOrNull();
  return admin ? (clip: AskLookupClip, opts: { atSeconds: number | null; count: number }) => loadClipStills(admin, clip, opts) : null;
}

/** How one agent reply was made: stored with the answer so bad answers can be traced and fixed. */
export type AskAgentTrace = {
  route: 'agent';
  model: string | null;
  escalated: boolean;
  elapsedMs: number;
  firstWordMs: number | null;
  tools: string[];
  computerStarted: boolean;
};

/**
 * The new single-agent Chat: one model with the whole job file and every tool.
 * Null when the model gave nothing, so the classic path still answers.
 */
async function answerWithAgent(
  input: Parameters<typeof answerFromJobFile>[0],
  ctx: { computerAllowed: boolean; computerBlock: string; apiKey: string; warmOnly?: boolean },
): Promise<Awaited<ReturnType<typeof answerFromJobFile>> | null> {
  const lookup = input.lookup!;
  const zone = lookup.timeZone || 'America/Chicago';
  const toolResults: AskToolResult[] = [];
  const startedAt = performance.now();
  let firstWordAt: number | null = null;
  const toolCtx = input.toolContext
    ? {
        ...input.toolContext,
        fetchFn: input.fetchFn ?? input.toolContext.fetchFn,
        file: input.file,
        webSearch: input.webSearch ?? input.toolContext.webSearch,
      }
    : null;
  const office = toolCtx?.access === 'org' && Boolean(toolCtx.userId);
  const uploads = readableUploads(input.sessionDocuments);
  const modelHistory = historyWithoutPrivateUploads(input.history ?? [], input.sessionDocuments) ?? input.history ?? [];
  const privateRemoved = (input.history ?? []).some((turn) => turn.officeOnly === true);
  let uploadBudget = 40_000;
  const uploadBlock = uploads
    .map((doc) => {
      const text = (trim(doc.extractedText) || (doc.chunks ?? []).map((c) => trim(c.text)).join('\n')).slice(0, uploadBudget);
      uploadBudget = Math.max(0, uploadBudget - text.length);
      return text ? `Uploaded in this chat: ${doc.filename}\n${text}` : '';
    })
    .filter(Boolean)
    .join('\n\n');
  const memory = privateRemoved && input.memory ? { ...input.memory, summary: '', notes: [] } : input.memory;
  const turnContext = [
    formatOrgMemoryForPrompt(input.orgMemory ?? []),
    memory ? formatThreadMemoryForPrompt(memory, zone) : '',
    trim(input.file.mentionSupplement),
    ctx.computerBlock,
    uploadBlock,
    stylePromptAddendum(input.styleSummary ?? ''),
  ]
    .filter(Boolean)
    .join('\n\n');
  const runTool = async (name: string, args: Record<string, unknown>) => {
    const started = performance.now();
    const result = await executeAskTool(name, args, toolCtx!);
    input.timing?.addTool(name, performance.now() - started);
    toolResults.push(result);
    return result;
  };
  const search = input.webSearch ?? searchAskWebDetailed;
  const agentInput: AskAgentInput = {
    question: input.question,
    catalog: lookup,
    jobFileRecord: formatJobFileRecord({ ...input.file, clips: [], mentionSupplement: null }).trim(),
    history: modelHistory,
    turnContext,
    apiKey: ctx.apiKey || null,
    timeZone: zone,
    now: input.now,
    signal: input.signal,
    onToken: (text) => {
      if (text) {
        input.timing?.markFirstToken();
        firstWordAt ??= performance.now();
      }
      input.onToken?.(text);
    },
    onStatus: input.onStatus,
    onPreviewReset: input.onPreviewReset,
    webSearch: (query, includeDomains) =>
      search(query, { fetchFn: input.fetchFn, limit: 5, includeDomains, now: input.now, timeZone: zone }),
    actions: office
      ? {
          tools: askModelActionTools('org'),
          run: async (name, args) => {
            const result = await runTool(name, args);
            return { ok: result.ok, tool: result.tool, summary: result.summary, data: result.data };
          },
        }
      : null,
    computer:
      office && ctx.computerAllowed
        ? async (args) =>
            computerTurnAnswer(
              await runTool('start_computer_task', {
                instructions: args.instructions,
                ...(args.start_url ? { start_url: args.start_url } : {}),
              }),
            )
        : null,
    extraChunks: documentChunksForGrounding(documentViews(input.file)),
    clipStills: stillsLoader(),
    loadOrgClips: input.loadOrgClips ?? null,
    callModel: input.agentCall,
  };
  if (ctx.warmOnly) {
    const warmed = await warmAskAgent({ ...agentInput, warmCall: input.agentWarmCall });
    return { answer: '', model: warmed?.model ?? null, groundedOn: 0, usage: warmed?.usage ?? null, webHits: [], toolResults };
  }
  const ran = await runAskAgent(agentInput);
  input.timing?.noteModel(ran.model);
  input.timing?.noteRoute('deep', 'agent');
  if (!trim(ran.answer)) return null;
  const agentTrace: AskAgentTrace = {
    route: 'agent',
    model: ran.model,
    escalated: ran.escalated,
    elapsedMs: Math.round(performance.now() - startedAt),
    firstWordMs: firstWordAt === null ? null : Math.round(firstWordAt - startedAt),
    tools: [...new Set([...ran.trace.map((step) => step.tool), ...(ran.computerStarted ? ['start_computer_task'] : [])])],
    computerStarted: ran.computerStarted,
  };
  const empty = { webHits: [] as AskWebHit[], toolResults, usage: ran.usage, model: ran.model, agentTrace };
  if (ran.computerStarted) return { ...empty, answer: ran.answer, groundedOn: 0, agent: true };
  let answer = trimChatFiller(normalizeAskProse(ran.answer), { question: input.question });
  const actions = formatActionsTrailer(toolResults);
  if (actions && !/⟦actions:/i.test(answer)) answer = `${answer.trimEnd()}\n\n${actions}`;
  return {
    ...empty,
    answer,
    webHits: ran.webHits,
    groundedOn: answerHasJobCitation(answer) ? countJobFileSources(input.file) : 0,
    answeredFromLookup: true,
    agent: true,
    ...(answerQuotesPrivateUpload(answer, input.sessionDocuments) ? { officeOnly: true } : {}),
  };
}

export async function answerFromJobFile(input: {
  question: string;
  file: JobFileAskContext;
  history?: JobFileAskTurn[];
  /** Summary of older turns and durable notes. Recent history stays verbatim. */
  memory?: LongThreadMemory | null;
  /** Company-wide org memory (already access-filtered). */
  orgMemory?: OrgMemoryFact[] | null;
  apiKey?: string | null;
  onToken?: (text: string) => void;
  /** Lookup status while tools run ("Looking through clips…"). */
  onStatus?: (phase: string) => void;
  /** Set when the reader stops the answer. A stopped turn is not stored. */
  signal?: AbortSignal;
  /** Optional fetch override for tests. */
  fetchFn?: typeof fetch;
  /**
   * When set, mention and job-file questions look facts up with tools on the
   * reasoning model instead of one transcript dump.
   */
  lookup?: AskLookupCatalog | null;
  /** Office Chat: loads clips on the company's other jobs when the agent searches them. */
  loadOrgClips?: (() => Promise<AskLookupClip[]>) | null;
  /**
   * When set, Ask may run safe in-product tools (web search, job field
   * get/update, punch list, drafts). Updates are office-only.
   */
  toolContext?: AskToolContext | null;
  /** Per-turn timings. Tool inputs are not recorded. */
  timing?: AskTurnClock | null;
  /** Pins relative dates such as "Thursday" in tests. */
  now?: Date;
  /**
   * Files uploaded in this office chat. They are not job-file evidence and
   * are ignored for share and homeowner Ask.
   */
  sessionDocuments?: AskDocumentView[] | null;
  /** Test hook for the upload answer completion. */
  uploadComplete?: typeof completeAskText;
  /**
   * Compact per-user communication-style summary (tone/length/format only).
   * Never overrides grounding, speakers, or job-evidence rules.
   */
  styleSummary?: string | null;
  /**
   * Per-turn memoized web search. The HTTP turn starts it for public questions
   * while the job file is still loading, so the search is usually done by the
   * time the answer needs it.
   */
  webSearch?: AskWebSearchFn | null;
  /** Clear the reader's live preview (a tool call after a preface, an escalation). */
  onPreviewReset?: () => void;
  /** Install the sentence check the live preview runs before showing text. */
  setPreviewCheck?: (check: ((sentence: string) => boolean) | null) => void;
  /** Test hook for the general (public question) answer. */
  generalComplete?: typeof completeAskText;
  /** "agent" asks for the new single-agent Chat (see askAgent.ts for the switch). */
  engine?: string | null;
  /** Test hook: the agent's model call. */
  agentCall?: Parameters<typeof runAskAgent>[0]['callModel'];
  /**
   * Only load this job into the agent's prompt cache (the person is typing).
   * Nothing is answered; the result's answer is empty.
   */
  warmOnly?: boolean;
  /** Test hook: the warm call. */
  agentWarmCall?: AskAgentWarmCall;
}): Promise<{
  answer: string;
  model: string | null;
  groundedOn: number;
  usage: MeasuredUsage | null;
  webHits: AskWebHit[];
  toolResults: AskToolResult[];
  /** True when the reply came from the lookup tools, including a failed-model grounding. */
  answeredFromLookup?: boolean;
  /** The reply is about a chat upload, not the job file. */
  answeredFromSessionDocument?: boolean;
  /**
   * True when the reply quotes an upload that is not on this job. Store it on
   * the office thread only; shared and grant listings omit it.
   */
  officeOnly?: boolean;
  /** The stored prose is web text. Marker parsing must not treat it as a model answer. */
  webDerivedAnswer?: boolean;
  /** Compact research trace for debugging. Absent on the single pass. */
  research?: AskResearchTrace | null;
  /** The new single-agent Chat wrote this reply. */
  agent?: boolean;
  /** How the agent made this reply (stored with the answer for the weekly Chat review). */
  agentTrace?: AskAgentTrace | null;
}> {
  const emit = (text: string) => {
    if (text) input.timing?.markFirstToken();
    input.onToken?.(text);
  };
  const logSkipped = (reason: string) => {
    void logAskRouteDecision({
      orgId: input.lookup?.orgId ?? input.toolContext?.orgId ?? null,
      jobId: input.lookup?.jobId ?? input.toolContext?.jobId ?? null,
      question: input.question,
      route: 'skipped',
      reason,
      unsure: false,
    });
    input.timing?.noteRoute('skipped', reason);
  };
  const grounded = groundedJobFileAnswer(input.question, input.file);
  // What the reader sees when the deterministic path answers.
  const spoken = readableJobFileAnswer(input.question, input.file);
  // "From this job file" only under answers that came from it, not "You're welcome."
  const spokenFromJob = !isChatSmallTalk(input.question) && !/does not have that/i.test(spoken);
  const groundedOn = countJobFileSources(input.file);
  const apiKey = (input.apiKey ?? '').trim();
  const empty = {
    answer: spoken,
    model: null as string | null,
    groundedOn: 0,
    usage: null as MeasuredUsage | null,
    webHits: [] as AskWebHit[],
    toolResults: [] as AskToolResult[],
  };

  // Office Chat with Computer: saved Logins and earlier Computer results on this job.
  const computerCtx = await loadAskComputerContext(input.toolContext);
  // "Log in to Restore 365 and …", "go into Xactimate", "check my <saved login>".
  const siteCommand = computerCtx.allowed && looksLikeOutsideSiteCommand(input.question, computerCtx.logins);
  const computerBlock = formatComputerResultsForPrompt(computerCtx.results);

  if (
    input.lookup &&
    askAgentEnabled(input.engine) &&
    (input.agentCall || (apiKey || anthropicAskApiKey()).trim())
  ) {
    const agent = await answerWithAgent(input, {
      computerAllowed: computerCtx.allowed,
      computerBlock,
      apiKey,
      warmOnly: input.warmOnly,
    });
    if (agent) return agent;
    // Emergency fallback only: the agent gave no answer, so the classic path answers this turn.
    logAskFailure('ask_agent_fallback', new Error('agent returned no answer'));
  }
  // Classic Chat has nothing to warm.
  if (input.warmOnly) return { ...empty, answer: '' };

  // "What websites can you log in to?" is about Chat, not the file or an upload.
  if (!siteCommand && looksLikeComputerCapabilityAsk(input.question)) {
    logSkipped('skipped_computer_capability');
    const answer = computerCapabilityAnswer({
      access: input.toolContext?.access === 'org' ? 'org' : 'viewer',
      configured: computerStatus().configured,
    });
    emit(answer);
    return { ...empty, answer, groundedOn: 0, toolResults: [], webHits: [] };
  }

  // Capability-only ("can you search Google?") → short professional yes, no live
  // search, no model star soup / google.com junk citations.
  if (looksLikePureWebCapabilityAsk(input.question)) {
    logSkipped('skipped_web_capability');
    const answer = professionalWebCapabilityAnswer(input.question);
    emit(answer);
    return { ...empty, answer, groundedOn: 0, toolResults: [], webHits: [] };
  }

  const sessionCovers = chatUploadShouldAnswer(input.question, input.sessionDocuments);
  const officeOnly = sessionAnswerIsPrivate(input.question, input.sessionDocuments);
  if (sessionCovers) {
    // The model reads the attached file and answers in its own words.
    if (input.uploadComplete || isAskModelConfigured(apiKey || null)) {
      const modeled = await answerChatUploadsWithModel({
        question: input.question,
        documents: readableUploads(input.sessionDocuments),
        history: input.history,
        apiKey: apiKey || null,
        fetchFn: input.fetchFn,
        signal: input.signal,
        complete: input.uploadComplete,
        // Stream the upload answer; the preview holds back quotes until the
        // exact-substring check on the final.
        onToken: emit,
      }).catch(() => null);
      if (modeled) input.timing?.noteRoute('fast', 'upload');
      if (modeled) {
        return {
          ...empty,
          answer: modeled.answer,
          model: modeled.model,
          usage: modeled.usage,
          groundedOn: 0,
          answeredFromSessionDocument: true,
          officeOnly,
        };
      }
    }
    const fromUploads = answerFromChatUploads(input.question, input.sessionDocuments) ?? 'This document does not show that.';
    emit(fromUploads);
    return { ...empty, answer: fromUploads, groundedOn: 0, answeredFromSessionDocument: true, officeOnly };
  }

  const fromDocuments = answerFromAttachedDocuments(input.question, input.file);
  if (fromDocuments && keepDocumentAnswer(input.question, fromDocuments)) {
    emit(fromDocuments);
    return { ...empty, answer: fromDocuments, groundedOn };
  }

  const heuristicPicks = siteCommand
    ? (['start_computer_task'] as ReturnType<typeof pickAskToolsHeuristically>)
    : input.toolContext
      ? pickAskToolsHeuristically(input.question, input.toolContext.access)
      : [];
  const generalTurn =
    !trim(input.file.mentionSupplement) &&
    isGeneralAsk(input.question) &&
    heuristicPicks.every((name) => name === 'web_search') &&
    (Boolean(input.generalComplete) || isAskModelConfigured(apiKey || null));
  if (generalTurn) {
    const general = await answerGeneralQuestion({
      question: input.question,
      history: input.history,
      apiKey: apiKey || null,
      webSearch: input.webSearch ?? null,
      fetchFn: input.fetchFn,
      onToken: emit,
      onStatus: input.onStatus,
      signal: input.signal,
      timing: input.timing,
      now: input.now,
      timeZone: input.lookup?.timeZone || 'America/Chicago',
      complete: input.generalComplete,
      jobCard: generalJobCard(input.file),
    });
    if (general) {
      input.timing?.noteRoute('general', 'general_web');
      input.timing?.noteModel(general.model);
      void logAskRouteDecision({
        orgId: input.lookup?.orgId ?? input.toolContext?.orgId ?? null,
        jobId: input.lookup?.jobId ?? input.toolContext?.jobId ?? null,
        question: input.question,
        route: 'fast',
        reason: 'general_web',
        unsure: false,
        modelHint: general.model ?? 'fast',
      });
      return {
        ...empty,
        answer: general.answer,
        model: general.model,
        usage: general.usage,
        groundedOn: 0,
        webHits: general.webHits,
        toolResults: [],
        webDerivedAnswer: true,
      };
    }
    // No model reply: fall through to the normal path (it still has the search).
  }

  // Run safe tools first so field updates apply before the model writes prose.
  const toolResults: AskToolResult[] = [];
  let webHits: AskWebHit[] = [];
  if (input.toolContext && !sessionCovers) {
    const picks = heuristicPicks;
    const { sequential, parallel } = partitionAskTools(picks);
    const runTool = async (name: (typeof picks)[number]) => {
      const rawInput =
        name === 'web_search'
          ? { query: input.question, include_domains: includeDomainsForAsk(input.question) }
          : name === 'find_evidence_moments'
            ? { topic: input.question }
            : name === 'search_crm'
              ? { query: input.question }
            : name === 'start_computer_task'
              ? { instructions: input.question }
            : name === 'update_job_fields'
              ? parseJobFieldUpdatesFromQuestion(input.question)
              : name === 'propose_revoke_access'
                ? {
                    personLabel:
                      input.question.match(/revoke(?:\s+access)?(?:\s+for)?\s+(.+)$/i)?.[1] ??
                      input.question,
                  }
                : {};
      const started = performance.now();
      const result = await executeAskTool(name, rawInput, {
        ...input.toolContext!,
        fetchFn: input.fetchFn ?? input.toolContext!.fetchFn,
        file: input.file,
        webSearch: input.webSearch ?? input.toolContext!.webSearch,
      });
      input.timing?.addTool(name, performance.now() - started);
      return result;
    };
    if (picks.includes('start_computer_task')) input.onStatus?.('Starting Computer…');
    else {
      // One visible step per kind of tool, in the order they run.
      const steps = [...new Set(picks.map(toolStepLabel).filter((l): l is string => Boolean(l)))];
      for (const step of steps) input.onStatus?.(step);
    }
    for (const name of sequential) toolResults.push(await runTool(name));
    if (parallel.length) toolResults.push(...(await Promise.all(parallel.map((name) => runTool(name)))));
    webHits = collectWebHitsFromToolResults(toolResults);
  }

  // A browser task is the whole turn: one short line, then the card.
  const computer = toolResults.find((r) => r.tool === 'start_computer_task');
  if (computer) {
    const answer = computerTurnAnswer(computer);
    emit(answer);
    return { ...empty, answer, groundedOn: 0, toolResults };
  }

  const zone = input.lookup?.timeZone || 'America/Chicago';
  let webAnswer = toolResults
    .map((result) => {
      const data = result.data;
      if (!data || typeof data !== 'object') return '';
      return String((data as { answer?: string }).answer ?? '');
    })
    .find((text) => text.trim()) ?? '';

  const mentionScoped = Boolean(trim(input.file.mentionSupplement));
  if (!mentionScoped && !computerBlock && !jobFileHasContent(input.file) && !toolResults.some((r) => r.ok)) {
    logSkipped('skipped_empty_job');
    emit(spoken);
    return { ...empty, answer: spoken, groundedOn: 0, toolResults };
  }

  // Prefer tools when they answered (status/fields/update) — still allow model
  // polish when a key is configured, but skip the grounded fast-path so updates
  // are not ignored.
  const toolsHandled =
    toolResults.some((r) => r.ok && ['update_job_fields', 'get_job_fields', 'get_job_status', 'get_crm_record', 'search_crm', 'list_who_has_access', 'get_punch_list', 'propose_revoke_access', 'draft_progress_share_copy', 'draft_field_invite_copy'].includes(r.tool));

  // Proactive web search BEFORE grounded fast-path so capability / outside-knowledge
  // asks (e.g. "search the web for tile prices", "can u search google") are never
  // swallowed by a brief-note hit from the job file.
  let webSearchAttempted = false;
  if (!sessionCovers && !mentionScoped && !webHits.length && !webAnswer.trim() && shouldSearchWebBeforeAnswer(input.question, grounded)) {
    webSearchAttempted = true;
    const outcome = await (input.webSearch ?? searchAskWebDetailed)(input.question, {
      fetchFn: input.fetchFn,
      limit: 5,
      includeDomains: includeDomainsForAsk(input.question),
      now: input.now,
      timeZone: zone,
    });
    webHits = outcome.hits;
    webAnswer = outcome.answer || webAnswer;
  }

  const webUsable = webHits.length > 0 || Boolean(trim(webAnswer));

  if (
    !mentionScoped &&
    !toolsHandled &&
    !isLongMemoryQuestion(input.question) &&
    // Follow-ups about Computer results go to the model with those results.
    !(computerBlock && (input.history ?? []).length) &&
    preferJobFileGroundedFastPath(input.question, grounded) &&
    !webUsable
  ) {
    emit(spoken);
    return { ...empty, answer: spoken, groundedOn: spokenFromJob ? groundedOn : 0, toolResults, webHits };
  }
  if (!isAskModelConfigured(apiKey || null) && input.lookup && isRoomQuestion(input.question)) {
    const roomAnswer = answerRoomQuestion(input.question, roomClipsFromCatalog(input.lookup));
    if (roomAnswer) {
      emit(roomAnswer);
      return { ...empty, answer: roomAnswer, groundedOn, toolResults, webHits };
    }
  }

  if (!isAskModelConfigured(apiKey || null) && !(input.lookup && isLongMemoryQuestion(input.question))) {
    const toolOnly = toolResults.filter((r) => r.ok && r.tool !== 'web_search');
    if (webHits.length || webAnswer) {
      const jobAnswer = toolOnly.length && asksAboutJobFile(input.question)
        ? toolOnly.map((r) => r.summary).join(' ')
        : spoken;
      const fallback = webFallbackAnswer({
        question: input.question,
        jobAnswer,
        webAnswer,
        hits: webHits,
      });
      let answer = fallback.answer;
      const trailer = formatActionsTrailer(toolResults);
      if (trailer) answer = `${answer.trimEnd()}\n\n${trailer}`;
      emit(answer);
      return clearWebOnNotFound({ ...empty, answer, groundedOn, toolResults, webHits, webDerivedAnswer: fallback.webDerived });
    }
    if (toolOnly.length) {
      const prose =
        toolOnly.map((r) => r.summary).join(' ') +
        (toolOnly.some((r) => r.needsConfirmation)
          ? ' Confirmation required before anything irreversible happens.'
          : '');
      const trailer = formatActionsTrailer(toolResults);
      const answer = trailer ? `${prose}\n\n${trailer}` : prose;
      emit(answer);
      return clearWebOnNotFound({ ...empty, answer, groundedOn, toolResults, webHits });
    }
    emit(spoken);
    return { ...empty, answer: spoken, groundedOn: spokenFromJob ? groundedOn : 0, toolResults, webHits };
  }

  const record = formatJobFileRecord(input.file).trim();
  if (!input.lookup && !record && !toolResults.length && !webUsable) {
    emit(spoken);
    return { ...empty, answer: spoken, groundedOn: spokenFromJob ? groundedOn : 0, toolResults, webHits };
  }

  const sourceHistory = input.history ?? [];
  const modelHistory = historyWithoutPrivateUploads(sourceHistory, input.sessionDocuments);
  const privateHistoryRemoved =
    sourceHistory.some((turn) => turn.officeOnly === true) ||
    (modelHistory != null && modelHistory.length < sourceHistory.length);
  const promptMemory =
    privateHistoryRemoved && input.memory
      ? { ...input.memory, summary: '', notes: [] }
      : input.memory;
  const history = (modelHistory ?? [])
    .filter((turn) => trim(turn.text))
    .slice(-12)
    .map((turn) => `${turn.role === 'assistant' ? 'Assistant' : 'User'}: ${trim(turn.text)}`)
    .join('\n');

  const styleAddendum = stylePromptAddendum(input.styleSummary ?? '');
  const extraSystem =
    `\n\n${askClockSystemRules(input.now ?? new Date(), zone)}` +
    `\n\n${askWebCapabilityRules()}` +
    (webUsable
      ? `\n\n${ASK_WEB_FORMAT_RULES}`
      : webSearchAttempted
        ? `\n\n${ASK_WEB_EMPTY_RESULTS_NOTE}`
        : '') +
    (toolResults.length
      ? `\n\nIN-PRODUCT ACTIONS: Tool results below already ran. Summarize what changed or what you found. Never claim you emailed anyone. If a tool needs confirmation, tell the user clearly and do not pretend it already happened. Append ⟦actions: …⟧ only if tools already attached it — the server appends the trailer.`
      : '') +
    (styleAddendum ? `\n\n${styleAddendum}` : '');

  const webBlock = webUsable
    ? `\n\nWEB SEARCH RESULTS (public web — supplemental only; job evidence wins and is never overridden):\n${formatAskWebContext(webHits, webAnswer)}`
    : webSearchAttempted
      ? `\n\nWEB SEARCH RESULTS: (none — live search returned no usable hits; do not invent web findings)`
      : '';
  const toolBlock = toolResults.length
    ? `\n\nTOOL RESULTS (already executed):\n${formatAskToolResultsForModel(toolResults)}`
    : '';

  if (input.lookup) {
    // Clips already live in the lookup catalog. Pass every other job-file
    // section so Chat answers like someone who knows the whole file.
    const jobFileRecord = formatJobFileRecord({ ...input.file, clips: [] }).trim();
    const looked = await answerFromAskLookup({
      orgMemory: input.orgMemory ?? null,
      question: input.question,
      catalog: input.lookup,
      history: modelHistory,
      memory: promptMemory,
      jobFileRecord,
      extra: [trim(input.file.mentionSupplement), computerBlock, webBlock, toolBlock, extraSystem].filter(Boolean).join('\n'),
      anthropicApiKey: apiKey || null,
      fetchFn: input.fetchFn,
      onToken: emit,
      onStatus: input.onStatus,
      signal: input.signal,
      timing: input.timing,
      // This turn already searched (or chose not to): no second web round.
      webSearchDone: webSearchAttempted || toolResults.some((r) => r.tool === 'web_search'),
      onPreviewReset: input.onPreviewReset,
      setPreviewCheck: input.setPreviewCheck,
      // The model decides: answer from context, search evidence, or hand the
      // turn to Computer. Commands and Computer follow-ups use the deep model.
      computer:
        computerCtx.allowed && input.toolContext
          ? {
              preferDeep: Boolean(computerBlock),
              start: async (args) => {
                const started = performance.now();
                const result = await executeAskTool(
                  'start_computer_task',
                  { instructions: args.instructions, ...(args.start_url ? { start_url: args.start_url } : {}) },
                  {
                    ...input.toolContext!,
                    fetchFn: input.fetchFn ?? input.toolContext!.fetchFn,
                    file: input.file,
                    webSearch: input.webSearch ?? input.toolContext!.webSearch,
                  },
                );
                input.timing?.addTool('start_computer_task', performance.now() - started);
                toolResults.push(result);
                return computerTurnAnswer(result);
              },
            }
          : null,
      // Commands (text someone, update the file, remove access, CRM) work
      // however they are phrased: the model calls the tool itself.
      actions:
        input.toolContext?.access === 'org' && input.toolContext.userId
          ? {
              tools: askModelActionTools('org', toolResults.map((r) => r.tool)),
              run: async (name, args) => {
                const started = performance.now();
                const result = await executeAskTool(name, args, {
                  ...input.toolContext!,
                  fetchFn: input.fetchFn ?? input.toolContext!.fetchFn,
                  file: input.file,
                  webSearch: input.webSearch ?? input.toolContext!.webSearch,
                });
                input.timing?.addTool(name, performance.now() - started);
                toolResults.push(result);
                return { ok: result.ok, tool: result.tool, summary: result.summary, data: result.data };
              },
            }
          : null,
    });
    if (looked.computerStarted) {
      return { ...empty, answer: looked.answer, model: looked.model, usage: looked.usage, groundedOn: 0, toolResults };
    }
    for (const step of looked.trace) {
      if (step.tool !== 'web_search' || !step.result.data || typeof step.result.data !== 'object') continue;
      const data = step.result.data as { answer?: string; results?: AskWebHit[] };
      if (data.answer && !webAnswer) webAnswer = data.answer;
      for (const hit of data.results ?? []) {
        if (hit?.url && !webHits.some((row) => row.url === hit.url)) webHits.push(hit);
      }
    }
    let answer = trimChatFiller(normalizeAskProse(looked.answer), { question: input.question });
    // Final check before render: every quote is a retrieved transcript line or an uploaded document.
    const documentChunks = documentChunksForGrounding(documentViews(input.file));
    answer = enforceQuoteGrounding(answer, {
      chunks: [...looked.retrievedChunks, ...documentChunks],
      question: input.question,
    }).answer;
    const applied = await applyWebResults(answer, input.question, webHits, webAnswer, {
      apiKey: apiKey || null,
      fetchFn: input.fetchFn,
      now: input.now,
      timeZone: zone,
    });
    answer = applied.answer;
    const actions = formatActionsTrailer(toolResults);
    if (actions && !/⟦actions:/i.test(answer)) {
      answer = `${answer.trimEnd()}\n\n${actions}`;
    }
    return {
      answer,
      model: looked.model,
      // A reply built on web results that cites nothing from this job is not
      // "From this job file".
      groundedOn: webBackedWithoutJobCite(answer, webHits, webAnswer, applied.webDerived) ? 0 : groundedOn,
      usage: applied.usage ? mergeMeasuredUsages([looked.usage, applied.usage], looked.model) : looked.usage,
      webHits,
      toolResults,
      answeredFromLookup: true,
      webDerivedAnswer: applied.webDerived,
      research: looked.research ?? null,
      ...(answerQuotesPrivateUpload(answer, input.sessionDocuments) ? { officeOnly: true } : {}),
    };
  }

  const mentionPrompt = mentionScoped
    ? assembleMentionModelPrompt({
        question: input.question,
        file: input.file,
        history: modelHistory,
        webBlock,
        toolBlock,
        extraSystem,
      })
    : null;
  const system = mentionPrompt ? mentionPrompt.system : FILE_QA_SYSTEM + extraSystem;
  const user = mentionPrompt
    ? mentionPrompt.user
    : `Job file record:\n\n${record || '(empty record)'}` +
      webBlock +
      toolBlock +
      (history ? `\n\nEarlier questions on this file:\n${history}` : '') +
      `\n\nQuestion: ${input.question}`;

  const completed = await completeAskText({
    system,
    user,
    anthropicApiKey: apiKey || null,
    mode: 'interactive',
    onToken: emit,
    fetchFn: input.fetchFn,
  });
  if (!completed) {
    if (webUsable) {
      const toolOnly = toolResults.filter((r) => r.ok && r.tool !== 'web_search');
      const jobAnswer = asksAboutJobFile(input.question)
        ? toolOnly.length
          ? toolOnly.map((r) => r.summary).join(' ')
          : spoken
        : '';
      const fallback = webFallbackAnswer({
        question: input.question,
        jobAnswer,
        webAnswer,
        hits: webHits,
      });
      let answer = fallback.answer;
      const trailer = formatActionsTrailer(toolResults);
      if (trailer) answer = `${answer.trimEnd()}\n\n${trailer}`;
      emit(answer);
      return clearWebOnNotFound({ ...empty, answer, groundedOn, toolResults, webHits, webDerivedAnswer: fallback.webDerived });
    }
    const toolOnly = toolResults.filter((r) => r.ok);
    const prose = toolOnly.length ? toolOnly.map((r) => r.summary).join(' ') : spoken;
    const trailer = formatActionsTrailer(toolResults);
    const answer = trailer ? `${prose}\n\n${trailer}` : prose;
    emit(answer);
    return clearWebOnNotFound({ ...empty, answer, groundedOn, toolResults, webHits });
  }
  let answer = trimChatFiller(normalizeAskProse(completed.text), { question: input.question });
  const applied = await applyWebResults(answer, input.question, webHits, webAnswer, {
    apiKey: apiKey || null,
    fetchFn: input.fetchFn,
    now: input.now,
    timeZone: zone,
  });
  answer = applied.answer;
  const actions = formatActionsTrailer(toolResults);
  if (actions && !/⟦actions:/i.test(answer)) {
    answer = `${answer.trimEnd()}\n\n${actions}`;
  }
  return {
    answer,
    model: completed.model,
    groundedOn: webBackedWithoutJobCite(answer, webHits, webAnswer, applied.webDerived) ? 0 : groundedOn,
    usage: applied.usage ? mergeMeasuredUsages([completed.usage, applied.usage], completed.model) : completed.usage,
    webHits,
    toolResults,
    webDerivedAnswer: applied.webDerived,
    ...(answerQuotesPrivateUpload(answer, input.sessionDocuments) ? { officeOnly: true } : {}),
  };
}
