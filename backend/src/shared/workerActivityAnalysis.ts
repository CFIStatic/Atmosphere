/**
 * Worker-activity reading from video frames.
 *
 * Two modes, one rule:
 *   - Scope attached → describe what is visible and cross-reference those lines
 *     (completion / in progress / not in shot). Never invent scope lines.
 *   - No scope → read the frames and dictate what happened on site.
 *
 * Money, hours, and payability stay out of the model prompt either way.
 */

import { dictatePreparedFrames, type PreparedVideoFrames, type VideoDictationResult } from './videoIntelligence.js';

export function scopeContextNote(scopeTitles: string[]): string {
  const lines = scopeTitles.map((t) => t.trim()).filter(Boolean);
  if (!lines.length) {
    return [
      'No job scope is attached.',
      'Write a dense timestamped reading of what is visible — people, clothing, PPE, setting, screens, news or YouTube if that is what is on camera,',
      'rooms or areas, tools, materials, brands when readable, condition, counts, and how the scene changes between stills.',
      'List what the stills do not show. Do not invent scope lines or claim work is complete off-camera.',
    ].join(' ');
  }
  return [
    'Cross-reference visible work with these agreed scope lines.',
    'Use exact titles. Never invent lines. Prefer "not visible" over guessing:',
    ...lines.map((t) => `- ${t}`),
  ].join('\n');
}

/** Build a PreparedVideoFrames bag from already-decoded proof stills. */
export function preparedFromProofFrames(input: {
  proofId: string;
  durationSeconds: number;
  frames: Array<{ atSeconds: number; base64: string }>;
  longForm?: boolean;
}): PreparedVideoFrames {
  return {
    id: input.proofId,
    source: 'proof_of_work',
    durationSeconds: Math.max(1, input.durationSeconds),
    longForm: Boolean(input.longForm),
    frames: input.frames.map((f) => ({
      atSeconds: f.atSeconds,
      jpeg: Buffer.from(f.base64, 'base64'),
    })),
  };
}

/**
 * No-scope path: AI reads the frames and dictates what happened.
 * Caller persists narration_text / ai_summary.
 */
export async function describeRecordingWithoutScope(input: {
  proofId: string;
  durationSeconds: number;
  frames: Array<{ atSeconds: number; base64: string }>;
  longForm?: boolean;
  trade?: string | null;
}): Promise<VideoDictationResult> {
  const prepared = preparedFromProofFrames(input);
  const trade = input.trade?.trim();
  return dictatePreparedFrames(prepared, {
    contextText: [
      scopeContextNote([]),
      trade ? `Trade on the invite: ${trade}` : null,
    ]
      .filter(Boolean)
      .join('\n'),
    maxModelFrames: input.longForm ? 48 : 36,
  });
}

export function descriptionFindings(dictation: VideoDictationResult): Record<string, unknown> {
  const entries = dictation.entries ?? [];
  const timeline = (entries.length ? entries : dictation.actions).map((row) => ({
    atSeconds: row.atSeconds,
    action: 'action' in row ? row.action : undefined,
    summary: 'text' in row ? row.text : row.description,
  }));
  return {
    kind: 'day_film',
    longForm: true,
    scopeCrossRef: false,
    summary: dictation.narrationText,
    workPerformed: (entries.length ? entries.map((e) => e.text) : dictation.actions.map((action) => action.description)).slice(0, 24),
    materialChange: null,
    materialBecause: null,
    changes: [],
    cannotTell: dictation.cannotTell ?? [],
    scopeVerdicts: [],
    concerns: [],
    timeline,
    windowsTotal: 0,
    windowsRead: 0,
    actions: dictation.actions,
    detailLevel: 'dense',
  };
}
