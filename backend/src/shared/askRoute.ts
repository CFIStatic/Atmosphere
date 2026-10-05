/**
 * Cheap routing for one Ask turn. No model call.
 *
 * Fast: greetings, thanks, follow-ups, and single-fact lookups or quotes.
 * Deep: drafts, comparisons, other-jobs, overviews, and multi-step questions.
 * Anything uncertain stays on the deep model.
 */
import { asksAboutOtherJobs, type AskLookupCatalog } from './askLookup.js';
import { classifyAskIntent, classifyChatTurn, isJobOverview } from './askPolish.js';

export type AskModelRoute = 'fast' | 'deep';

export type AskRouteDecision = {
  route: AskModelRoute;
  reason: string;
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
  if (isMultiStep(resolved) || isMultiStep(asked)) return { route: 'deep', reason: 'multi_step' };

  const catalog = input.catalog;
  if (catalog) {
    const chat = classifyChatTurn(resolved, input.history, catalog);
    if (chat === 'greeting' || chat === 'thanks' || chat === 'ack' || chat === 'restate' || chat === 'clarify') {
      return { route: 'fast', reason: chat };
    }
    if (chat === 'opinion' || chat === 'recall') return { route: 'fast', reason: chat };
    if (chat === 'correction') return { route: 'deep', reason: 'correction' };
  } else if (GREETING.test(asked)) {
    return { route: 'fast', reason: 'greeting' };
  }

  const followUp =
    Boolean(input.resolved) && input.resolved!.trim().toLowerCase() !== asked.toLowerCase();
  if (followUp) return { route: 'fast', reason: 'follow_up' };

  if (/\b(say|said|quote|transcript|mention)\b/i.test(resolved)) return { route: 'fast', reason: 'quote' };

  if (
    /^(who|what|when|where|which|did|does|is|was|show|find)\b/i.test(resolved) &&
    wordCount(resolved) <= 18 &&
    !/\b(compare|draft|write|why)\b/i.test(resolved)
  ) {
    return { route: 'fast', reason: 'lookup' };
  }

  if (wordCount(resolved) <= 8 && !/\b(draft|write|compare|why|summar)\b/i.test(resolved)) {
    return { route: 'fast', reason: 'short' };
  }

  return { route: 'deep', reason: 'default' };
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
