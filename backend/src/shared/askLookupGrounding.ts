/**
 * Lookup Ask grounding: checks a drafted answer against the job file and the
 * tool results, and the fallback reply when the check fails.
 */
import { askFastAnthropicModel, completeAskText, logAskFailure } from '../lib/askModel.js';
import {
  clipsInScope,
  formatAskJobContext,
  redactClipTranscriptForAsk,
  type AskLookupCatalog,
  type AskLookupTraceStep,
} from './askLookup.js';
import { stripMomentTrailers } from './askMoments.js';
import { composeGroundedAsk, localStamp } from './askPolish.js';
import { formatThreadMemoryForPrompt, type LongThreadMemory } from './askMemory.js';
import { formatOrgMemoryForPrompt, type OrgMemoryFact } from './askOrgMemory.js';
import {
  ASK_REPAIR_SYSTEM,
  buildGroundingIndex,
  formatRepairPrompt,
  normalizeForMatch,
  stripUnsupported,
  supportedProse,
  verifyAskAnswer,
} from './askVerify.js';

import { formatTrace } from './askLookupPrompts.js';

export function groundingSourceText(
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

export function groundingFallback(
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
  orgMemory?: OrgMemoryFact[] | null;
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
  const memoryBlock = [
    formatOrgMemoryForPrompt(input.orgMemory ?? []),
    formatThreadMemoryForPrompt(input.memory, input.catalog.timeZone),
  ]
    .filter(Boolean)
    .join('\n\n');
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
              // A constrained edit against the source block: the fast model
              // does it in a fraction of the time and the result is re-checked.
              anthropicModel: askFastAnthropicModel(),
            })
          )?.text ?? null;
    } catch (err) {
      logAskFailure('ask_grounding_repair_failed', err);
      return null;
    }
  };
  const trailersOf = (text: string) => text.match(/⟦(?:sources|quotes|followups|actions|frames):[^⟧]*⟧/gi) ?? [];
  const proseOf = (text: string) => text.replace(/⟦(?:sources|quotes|followups|actions|frames):[^⟧]*⟧/gi, '').trim();

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
