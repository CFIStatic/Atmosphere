import type { TaskSpec } from './taskTypes.js';
import type { Disposition } from './types.js';

/**
 * The reward function — the definition of "executed the work correctly".
 *
 * This file is the most consequential in the system and deserves to be read as
 * a policy document, not just code. A bandit optimises exactly what you write
 * here, including the parts you did not mean. Three decisions do the work:
 *
 * **1. Reward lives in [0,1].** Beta posteriors (policy.ts) need a bounded
 *    signal, and bounding also caps the damage any single mis-specified term can
 *    do — no term can dominate by running off to infinity.
 *
 * **2. Quality dominates, and cost is a tie-breaker rather than a goal.** The
 *    obvious failure mode of a cost-aware router is that it learns to be cheap
 *    at the expense of being right, because cost is measured perfectly and
 *    instantly while quality is measured noisily and late. Two things prevent
 *    that: quality carries 0.6–0.9 of the weight on every task, and cost is
 *    gated (see `qualityGate` below) so an arm cannot earn a cost bonus for
 *    work that failed. Cheap-and-wrong scores near zero, not "cheap".
 *
 * **3. Reward is computed in two phases.** Verifier-only at execution time, then
 *    recomputed when the human signal lands. Stats are updated by *delta*, so
 *    the correction is exact rather than double-counted — the provisional
 *    contribution is subtracted before the final one is added.
 */

export interface RewardInput {
  spec: TaskSpec;
  verifierScore: number;
  disposition: Disposition;
  /** 0 = untouched, 1 = fully rewritten. Null when we cannot measure it. */
  editRatio: number | null;
  costUsd: number;
  latencyMs: number;
}

/**
 * How a human received the output, as a quality score.
 *
 * `failed` and `rejected` both floor at zero: from the user's point of view a
 * crash and a useless answer are the same event — they still have to do the
 * work themselves.
 */
const DISPOSITION_QUALITY: Record<Exclude<Disposition, 'pending'>, number> = {
  accepted: 1.0,
  edited_minor: 0.75,
  edited_major: 0.35,
  rejected: 0.0,
  failed: 0.0,
};

/**
 * Weight given to the human signal once it exists.
 *
 * Deliberately high. The verifier checks whether the output is *well-formed and
 * grounded*; only the human knows whether it was *useful*. Keeping 25% on the
 * verifier stops a single grumpy reviewer from erasing objective evidence.
 */
const HUMAN_WEIGHT = 0.75;

/**
 * Below this quality, efficiency stops counting.
 *
 * Without this gate a fast, cheap, wrong arm collects the full cost and latency
 * bonus on every failure — on the summarise task that is 0.4 of the reward for
 * producing garbage, enough to beat a slower arm that is right. The gate makes
 * the efficiency terms conditional on the work being usable in the first place.
 */
const QUALITY_GATE = 0.5;

export interface RewardBreakdown {
  reward: number;
  quality: number;
  costScore: number;
  latencyScore: number;
  qualityGate: number;
}

export function computeReward(input: RewardInput): RewardBreakdown {
  const { spec, verifierScore, disposition, editRatio, costUsd, latencyMs } = input;

  // ── Quality ───────────────────────────────────────────────────────────────
  let quality = clamp01(verifierScore);
  if (disposition !== 'pending') {
    let humanQuality = DISPOSITION_QUALITY[disposition];
    // When we can measure how much was changed, prefer the measurement over the
    // coarse bucket — "edited" covers everything from a typo to a rewrite.
    if (editRatio !== null && (disposition === 'edited_minor' || disposition === 'edited_major')) {
      humanQuality = clamp01(1 - editRatio);
    }
    quality = HUMAN_WEIGHT * humanQuality + (1 - HUMAN_WEIGHT) * clamp01(verifierScore);
  }

  // ── Efficiency ────────────────────────────────────────────────────────────
  // Scored against the task's declared budget, so "expensive" means expensive
  // *for this kind of work*. Linear inside budget, decaying past it — an arm at
  // 3× budget should be discouraged, not treated as infinitely bad.
  const costScore = budgetScore(costUsd, spec.costBudgetUsd);
  const latencyScore = budgetScore(latencyMs, spec.latencyBudgetMs);

  // ── Combine ───────────────────────────────────────────────────────────────
  const { quality: wq, cost: wc, latency: wl } = spec.rewardWeights;
  const gate = quality < QUALITY_GATE ? quality / QUALITY_GATE : 1;

  const reward = clamp01(wq * quality + gate * (wc * costScore + wl * latencyScore));

  return { reward, quality, costScore, latencyScore, qualityGate: gate };
}

/**
 * Provisional reward, used the moment a run completes.
 *
 * Most runs never receive explicit human feedback, so this is the *only* signal
 * for the majority of episodes. It is applied at full weight rather than
 * discounted: a discount would make the common case count for less than the
 * rare case, and the policy would end up tracking the preferences of the small
 * subset of users who bother to click a rating.
 */
export function provisionalReward(input: Omit<RewardInput, 'disposition' | 'editRatio'>): RewardBreakdown {
  return computeReward({ ...input, disposition: 'pending', editRatio: null });
}

/** 1 at zero usage, 0.5 at exactly budget, decaying smoothly past it. */
function budgetScore(actual: number, budget: number): number {
  if (budget <= 0) return 1;
  const ratio = Math.max(0, actual) / budget;
  return 1 / (1 + ratio);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * Edit ratio via normalised Levenshtein distance.
 *
 * Called when a user saves an edited version of a generated output — the
 * highest-quality feedback we get, because it is a by-product of doing the work
 * rather than a rating someone had to be asked for. Capped at 4k characters:
 * the algorithm is O(n·m), and beyond that length the ratio is already decided.
 */
export function editRatio(original: string, edited: string): number {
  const a = original.slice(0, 4000);
  const b = edited.slice(0, 4000);
  if (a === b) return 0;
  if (!a.length || !b.length) return 1;

  // Two-row dynamic programming — O(min(n,m)) memory.
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  let current = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, substitution);
    }
    [previous, current] = [current, previous];
  }

  return clamp01(previous[b.length] / Math.max(a.length, b.length));
}

/** Bucket an edit ratio into the disposition the reward function expects. */
export function dispositionFromEdit(ratio: number): Disposition {
  if (ratio <= 0.02) return 'accepted';
  return ratio <= 0.25 ? 'edited_minor' : 'edited_major';
}
