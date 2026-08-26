/**
 * Dataset counts that talk about work, not footage.
 *
 * Hours of video is a storage bill. "Verified physical-work episodes" is the
 * number a licensing conversation can actually use: Tier 2 and up, with an
 * optional cut for episodes that already have both world states and a day
 * outcome on file.
 */

import { verifiedPhysicalWorkEpisode } from './derive.js';

export interface DatasetSummary {
  total: number;
  byTier: Record<number, number>;
  byTrade: Record<string, number>;
  licensable: number;
  consentPending: number;
  verifiedPhysicalWorkEpisodes: number;
  withWorldState: number;
  withImmediateOutcome: number;
  trainingEligible: number;
}

export function summariseEpisodes(
  rows: Array<{
    tier?: number | null;
    data_rights?: string | null;
    worker_consent?: string | null;
    trade?: string | null;
  }>,
  extras?: { worldStateEpisodeIds?: Set<string>; immediateOutcomeIds?: Set<string>; episodeIds?: string[] },
): DatasetSummary {
  const byTier: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  const byTrade: Record<string, number> = {};
  let licensable = 0;
  let consentPending = 0;
  let verifiedPhysicalWorkEpisodes = 0;
  let trainingEligible = 0;

  for (const row of rows) {
    const tier = Number(row.tier ?? 1);
    byTier[tier] = (byTier[tier] ?? 0) + 1;
    if (row.trade) byTrade[row.trade] = (byTrade[row.trade] ?? 0) + 1;
    if (row.data_rights === 'licensable') licensable += 1;
    if (row.worker_consent === 'not_asked') consentPending += 1;
    if (verifiedPhysicalWorkEpisode(row)) verifiedPhysicalWorkEpisodes += 1;
    if (row.data_rights === 'licensable' && row.worker_consent === 'granted') trainingEligible += 1;
  }

  return {
    total: rows.length,
    byTier,
    byTrade,
    licensable,
    consentPending,
    verifiedPhysicalWorkEpisodes,
    withWorldState: extras?.worldStateEpisodeIds?.size ?? 0,
    withImmediateOutcome: extras?.immediateOutcomeIds?.size ?? 0,
    trainingEligible,
  };
}
