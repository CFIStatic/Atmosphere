/**
 * Match a diarized speaker embedding to consented voiceprints.
 *
 * Same-company prints are eligible. Another company's print is eligible only
 * when that person opted in from their own account. A print without consent
 * text and a consent timestamp is never eligible. Opt-in defaults off.
 */

import { cosineSimilarity } from './speakerEmbedding.js';

export type MatchBand = 'high' | 'medium' | 'none';

export type MatchThresholds = {
  high: number;
  medium: number;
};

export const DEFAULT_MATCH_THRESHOLDS: MatchThresholds = {
  high: 0.85,
  medium: 0.72,
};

export type VoiceprintCandidate = {
  id: string;
  userId: string;
  orgId: string;
  displayName: string;
  embedding: number[];
  consentText: string | null;
  consentedAt: string | null;
  crossCompanyOptIn: boolean;
};

export type VoiceMatch = {
  voiceprintId: string;
  userId: string;
  displayName: string;
  score: number;
  band: Exclude<MatchBand, 'none'>;
};

function clampUnit(raw: unknown, fallback: number): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

/** Thresholds from the environment, with the defaults above when unset. */
export function matchThresholds(
  env: Record<string, string | undefined> = process.env,
): MatchThresholds {
  const high = clampUnit(env.SPEAKER_MATCH_HIGH, DEFAULT_MATCH_THRESHOLDS.high);
  const medium = clampUnit(env.SPEAKER_MATCH_MEDIUM, DEFAULT_MATCH_THRESHOLDS.medium);
  if (medium >= high) return { high, medium: Math.max(0, high - 0.01) };
  return { high, medium };
}

export function matchBand(score: number, thresholds: MatchThresholds = DEFAULT_MATCH_THRESHOLDS): MatchBand {
  if (!Number.isFinite(score)) return 'none';
  if (score >= thresholds.high) return 'high';
  if (score >= thresholds.medium) return 'medium';
  return 'none';
}

function hasConsent(print: VoiceprintCandidate): boolean {
  return Boolean(print.consentText?.trim() && print.consentedAt);
}

/**
 * Voiceprints a clip uploaded by `uploaderOrgId` may be compared to.
 * Cross-company rows require that person's own opt-in. Missing consent drops the row.
 */
export function eligibleVoiceprints(
  prints: VoiceprintCandidate[],
  uploaderOrgId: string,
): VoiceprintCandidate[] {
  const org = uploaderOrgId.trim();
  return prints.filter((print) => {
    if (!hasConsent(print) || !print.embedding?.length) return false;
    if (print.orgId === org) return true;
    return print.crossCompanyOptIn === true;
  });
}

/** Best consented match, or null when nothing clears the medium threshold. */
export function bestVoiceMatch(
  embedding: number[],
  prints: VoiceprintCandidate[],
  uploaderOrgId: string,
  thresholds: MatchThresholds = DEFAULT_MATCH_THRESHOLDS,
): VoiceMatch | null {
  let best: VoiceMatch | null = null;
  for (const print of eligibleVoiceprints(prints, uploaderOrgId)) {
    const score = cosineSimilarity(embedding, print.embedding);
    const band = matchBand(score, thresholds);
    if (band === 'none') continue;
    if (!best || score > best.score) {
      best = {
        voiceprintId: print.id,
        userId: print.userId,
        displayName: print.displayName.trim(),
        score: Math.round(score * 1000) / 1000,
        band,
      };
    }
  }
  return best?.displayName ? best : null;
}
