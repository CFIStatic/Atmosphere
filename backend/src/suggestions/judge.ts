/**
 * The model's check on the rule-made candidates. The rules decide what is
 * possible; the model reads the job's context and may only keep or drop a
 * candidate and say why. It never adds a kind, never changes the prompt
 * Approve hands off, and never sees another job.
 *
 * Without a model (not configured, or the call failed), candidates that rest
 * on words in the footage (needsModelCheck) are dropped and the rest stand:
 * staying quiet is the safe failure.
 */
import { askFastAnthropicModel, completeAskText } from '../lib/askModel.js';
import type { JobState, SuggestionCandidate } from './rules.js';

export interface JudgedCandidate extends SuggestionCandidate {
  judgedBy: 'rules' | 'rules+model';
  model: string | null;
  modelWhy: string | null;
}

export type CompleteFn = (input: { system: string; user: string; maxTokens?: number }) => Promise<{ text: string; model: string } | null>;

const SYSTEM = `You decide whether a restoration contractor's office should be offered a piece of work on one job right now.
Rules already proposed candidates from the job's state. For each, answer keep=true only if the job context shows it is the right next step now.
Drop a candidate when the footage words are ambiguous, describe something planned rather than done, or the work is already done.
Reply with JSON only: {"decisions":[{"kind":"<kind>","keep":true|false,"why":"<one short sentence>"}]}`;

export function judgeInput(state: JobState, candidates: SuggestionCandidate[]): string {
  return JSON.stringify({
    job: {
      title: state.title,
      status: state.status,
      lossType: state.lossType,
      causeOfLoss: state.causeOfLoss,
      clips: state.analyzedClipCount,
      roomsOnVideo: [...new Set(state.roomsOnVideo)].slice(0, 30),
      affectedRooms: [...new Set(state.affectedRooms)].slice(0, 30),
      moistureReadings: state.moistureReadings,
      estimate: state.estimate ? { scopeLines: state.estimate.scopeTitles.slice(0, 40) } : null,
      milestones: state.milestones,
      events: state.events.slice(-8).map((e) => ({ kind: e.kind, quote: e.quote })),
    },
    candidates: candidates.map((c) => ({ kind: c.kind, title: c.title, detail: c.detail, evidence: c.evidence })),
  });
}

export function parseDecisions(text: string): Map<string, { keep: boolean; why: string | null }> {
  const out = new Map<string, { keep: boolean; why: string | null }>();
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return out;
  try {
    const parsed = JSON.parse(match[0]) as { decisions?: Array<{ kind?: unknown; keep?: unknown; why?: unknown }> };
    for (const d of parsed.decisions ?? []) {
      if (typeof d.kind !== 'string' || typeof d.keep !== 'boolean') continue;
      out.set(d.kind, { keep: d.keep, why: typeof d.why === 'string' ? d.why.slice(0, 300) : null });
    }
  } catch {
    // Unusable reply: treated as no model.
  }
  return out;
}

const defaultComplete: CompleteFn = async (input) => {
  const result = await completeAskText({
    meterSource: 'suggested_work',
    system: input.system,
    user: input.user,
    maxTokens: input.maxTokens ?? 600,
    anthropicModel: askFastAnthropicModel(),
  });
  return result ? { text: result.text, model: result.model } : null;
};

export async function judgeCandidates(
  state: JobState,
  candidates: SuggestionCandidate[],
  complete: CompleteFn = defaultComplete,
): Promise<JudgedCandidate[]> {
  if (!candidates.length) return [];
  let reply: { text: string; model: string } | null = null;
  try {
    reply = await complete({ system: SYSTEM, user: judgeInput(state, candidates) });
  } catch {
    reply = null;
  }
  const decisions = reply ? parseDecisions(reply.text) : new Map();
  const out: JudgedCandidate[] = [];
  for (const c of candidates) {
    const d = decisions.get(c.kind);
    if (!d) {
      // No word from the model on this one.
      if (c.needsModelCheck) continue;
      out.push({ ...c, judgedBy: 'rules', model: null, modelWhy: null });
      continue;
    }
    if (!d.keep) continue;
    out.push({ ...c, judgedBy: 'rules+model', model: reply?.model ?? null, modelWhy: d.why });
  }
  return out;
}
