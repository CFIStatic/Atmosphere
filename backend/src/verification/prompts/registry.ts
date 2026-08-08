/**
 * Versioned production prompts for verification.
 *
 * Every AI run must reference prompt_key + version. Do not scatter unversioned
 * production prompts through handlers.
 */

export const VERIFIER_PROMPT_KEY = 'llm_work_event_verifier';
export const VERIFIER_PROMPT_VERSION = 'v1';

export const DEFAULT_VERIFIER_SYSTEM = `You are a skeptical restoration/construction work verifier. You do NOT narrate hopefully.

You receive proposed work events with before/during/after evidence, structured observations, a verification-rule checklist, and project context.

Rules you must follow:
1. A single frame showing an object is NOT proof that the current contractor performed the work.
2. Require same room/area, correct timestamp order, before AND after evidence when the rule requires it, and no unresolved contradictions.
3. Prefer "uncertain" or "rejected" over "verified" when evidence is incomplete.
4. Cite exact frame IDs for supporting and contradictory evidence.
5. Decide only from provided evidence — never invent off-camera work.

Reply with JSON only matching:
{"decision":"verified"|"likely_verified"|"partially_verified"|"uncertain"|"contradicted"|"rejected","proposed_activity":string,"room_id":string|null,"before_state":{"description":string,"evidence_frame_ids":string[]},"after_state":{"description":string,"evidence_frame_ids":string[]},"supporting_evidence":[{"frame_id":string,"reason":string}],"contradictory_evidence":[{"frame_id":string,"reason":string}],"sequence_analysis":string,"completion_state":"not_started"|"started"|"partial"|"complete"|"unknown","model_confidence":number,"uncertainty_reasons":string[],"required_follow_up":string|null}`;

export interface PromptRecord {
  promptKey: string;
  version: string;
  name: string;
  systemInstructions: string;
  outputSchemaVersion: string;
}

/** In-code registry (DB seeds mirror these for runtime lookup). */
export const PROMPT_REGISTRY: Record<string, PromptRecord> = {
  [`${VERIFIER_PROMPT_KEY}@${VERIFIER_PROMPT_VERSION}`]: {
    promptKey: VERIFIER_PROMPT_KEY,
    version: VERIFIER_PROMPT_VERSION,
    name: 'Skeptical work-event verifier',
    systemInstructions: DEFAULT_VERIFIER_SYSTEM,
    outputSchemaVersion: 'v1',
  },
};

export function getPrompt(promptKey: string, version: string): PromptRecord {
  const hit = PROMPT_REGISTRY[`${promptKey}@${version}`];
  if (!hit) throw new Error(`Unknown prompt ${promptKey}@${version}`);
  return hit;
}
