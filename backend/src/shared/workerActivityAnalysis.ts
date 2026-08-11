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
      'Describe only what is visible in the frames — what the worker appears to be doing,',
      'materials and tools on site, and how the area changes over time.',
      'Do not invent scope lines or claim work is complete off-camera.',
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
    maxModelFrames: input.longForm ? 36 : 18,
  });
}

export function descriptionFindings(dictation: VideoDictationResult): Record<string, unknown> {
  return {
    longForm: true,
    scopeCrossRef: false,
    summary: dictation.narrationText,
    materialChange: null,
    materialBecause: null,
    changes: [],
    cannotTell: [],
    scopeVerdicts: [],
    concerns: [],
    timeline: [],
    windowsTotal: 0,
    windowsRead: 0,
  };
}
