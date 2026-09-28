/**
 * Per-turn Ask timings for the API logs.
 *
 * One JSON line, event `ask_turn`. Tool names, durations, and grounding-check
 * counts only — never the question, the answer, a transcript, a name, or an address.
 */
import { logger } from '../lib/logger.js';

const TOOL_NAMES = new Set([
  'search_transcripts',
  'search_other_jobs',
  'get_clip',
  'list_person_activity',
  'read_job_history',
  'web_search',
  'get_job_status',
  'get_job_fields',
  'update_job_fields',
  'get_crm_record',
  'search_crm',
  'list_who_has_access',
  'get_punch_list',
  'find_evidence_moments',
  'draft_progress_share_copy',
  'draft_field_invite_copy',
  'propose_revoke_access',
]);

export type AskTurnRoute = 'fast' | 'deep' | 'grounded';

export type AskGeminiCache = 'hit' | 'miss' | 'skip';

export type AskTurnTiming = {
  route: AskTurnRoute;
  routeReason: string;
  model: string | null;
  fallback: boolean;
  ttftMs: number | null;
  totalMs: number;
  contextBuildMs: number;
  memoryLoadMs: number;
  memorySummarizeMs: number;
  tools: Array<{ name: string; durationMs: number }>;
  promptCache: boolean;
  geminiCache: AskGeminiCache;
  cacheReadTokens: number;
  /** Quotes the grounding check compared with transcripts (trailer and prose). */
  quotesChecked: number;
  /** Quotes that did not match the cited clip or any transcript. */
  quotesFailed: number;
  /** Other unsupported claims (times, dates, names, roles, refs) found before repair. */
  claimsFailed: number;
  /** True when the one repair pass fixed every open failure. */
  repaired: boolean;
  /** True when unsupported sentences were removed after the repair pass. */
  stripped: boolean;
};

export type AskTurnVerify = {
  quotesChecked: number;
  quotesFailed: number;
  claimsFailed: number;
  repaired: boolean;
  stripped: boolean;
};

export type AskTurnClock = {
  startedAt: number;
  contextBuildMs: number;
  memoryLoadMs: number;
  memorySummarizeMs: number;
  ttftMs: number | null;
  model: string | null;
  route: AskTurnRoute;
  routeReason: string;
  fallback: boolean;
  tools: Array<{ name: string; durationMs: number }>;
  promptCache: boolean;
  geminiCache: AskGeminiCache;
  cacheReadTokens: number;
  verify: AskTurnVerify;
  markFirstToken: () => void;
  addTool: (name: string, durationMs: number) => void;
  addCacheRead: (tokens: number) => void;
  noteModel: (model: string | null) => void;
  noteRoute: (route: AskTurnRoute, reason: string, fallback?: boolean) => void;
  noteGeminiCache: (state: AskGeminiCache) => void;
  noteVerify: (verify: AskTurnVerify) => void;
  snapshot: (now?: number) => AskTurnTiming;
};

function roundMs(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.round(value);
}

export function createAskTurnClock(now = Date.now()): AskTurnClock {
  const clock: AskTurnClock = {
    startedAt: now,
    contextBuildMs: 0,
    memoryLoadMs: 0,
    memorySummarizeMs: 0,
    ttftMs: null,
    model: null,
    route: 'grounded',
    routeReason: 'pending',
    fallback: false,
    tools: [],
    promptCache: false,
    geminiCache: 'skip',
    cacheReadTokens: 0,
    verify: { quotesChecked: 0, quotesFailed: 0, claimsFailed: 0, repaired: false, stripped: false },
    markFirstToken() {
      if (clock.ttftMs != null) return;
      clock.ttftMs = roundMs(Date.now() - clock.startedAt);
    },
    addTool(name: string, durationMs: number) {
      const safe = TOOL_NAMES.has(name) ? name : 'tool';
      clock.tools.push({ name: safe, durationMs: roundMs(durationMs) });
    },
    addCacheRead(tokens: number) {
      if (!Number.isFinite(tokens) || tokens <= 0) return;
      clock.cacheReadTokens += Math.round(tokens);
    },
    noteModel(model: string | null) {
      const id = (model ?? '').trim();
      if (id) clock.model = id.slice(0, 80);
    },
    noteRoute(route: AskTurnRoute, reason: string, fallback = false) {
      clock.route = route;
      clock.routeReason = reason.slice(0, 40);
      if (fallback) clock.fallback = true;
    },
    noteGeminiCache(state: AskGeminiCache) {
      clock.geminiCache = state;
    },
    noteVerify(verify: AskTurnVerify) {
      clock.verify = { ...verify };
    },
    snapshot(at = Date.now()): AskTurnTiming {
      return {
        route: clock.route,
        routeReason: clock.routeReason,
        model: clock.model,
        fallback: clock.fallback,
        ttftMs: clock.ttftMs,
        totalMs: roundMs(at - clock.startedAt),
        contextBuildMs: roundMs(clock.contextBuildMs),
        memoryLoadMs: roundMs(clock.memoryLoadMs),
        memorySummarizeMs: roundMs(clock.memorySummarizeMs),
        tools: clock.tools.map((tool) => ({ name: tool.name, durationMs: tool.durationMs })),
        promptCache: clock.promptCache,
        geminiCache: clock.geminiCache,
        cacheReadTokens: clock.cacheReadTokens,
        quotesChecked: clock.verify.quotesChecked,
        quotesFailed: clock.verify.quotesFailed,
        claimsFailed: clock.verify.claimsFailed,
        repaired: clock.verify.repaired,
        stripped: clock.verify.stripped,
      };
    },
  };
  return clock;
}

/** Safe to log. Drops anything that is not a timing field. */
export function askTurnLogFields(timing: AskTurnTiming): Record<string, unknown> {
  return {
    event: 'ask_turn',
    route: timing.route,
    routeReason: timing.routeReason,
    model: timing.model,
    fallback: timing.fallback,
    ttftMs: timing.ttftMs,
    totalMs: timing.totalMs,
    contextBuildMs: timing.contextBuildMs,
    memoryLoadMs: timing.memoryLoadMs,
    memorySummarizeMs: timing.memorySummarizeMs,
    tools: timing.tools.map((tool) => ({
      name: TOOL_NAMES.has(tool.name) ? tool.name : 'tool',
      durationMs: roundMs(tool.durationMs),
    })),
    promptCache: timing.promptCache,
    geminiCache: timing.geminiCache,
    cacheReadTokens: timing.cacheReadTokens,
    quotesChecked: timing.quotesChecked ?? 0,
    quotesFailed: timing.quotesFailed ?? 0,
    claimsFailed: timing.claimsFailed ?? 0,
    repaired: timing.repaired ?? false,
    stripped: timing.stripped ?? false,
  };
}

export function logAskTurnTiming(timing: AskTurnTiming): void {
  logger.info('ask_turn', askTurnLogFields(timing));
}
