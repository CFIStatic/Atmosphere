import { lookupModel, type CatalogEntry } from './catalog.js';
import { getTaskSpec } from './taskTypes.js';
import type { Arm, Complexity, TaskType } from './types.js';

/**
 * Pre-execution complexity assessment.
 *
 * Before the platform spends a token, we look at the kind of work and the shape
 * of the input and decide how hard the job is. That decision picks the model
 * *tier* the router should prefer:
 *
 *   simple   → fast / cheap models   (haiku, flash, mini)
 *   moderate → balanced models       (sonnet, mid-tier)
 *   complex  → frontier models       (opus, gpt-5, gemini-pro, grok-4)
 *
 * The learning loop can still override this once it has evidence — assessment is
 * the *prior*, not a hard rule. Without it, cold-start traffic would always land
 * on the strongest prior (frontier), which burns money on work that a fast model
 * already handles well.
 *
 * Assessment is deliberately deterministic and free: no model call. Signals are
 * task-type baseline, stakes, input size, and a few structural cues (list
 * lengths, document size, price-list breadth). That is enough to separate "one
 * moisture reading" from "rebuild estimate against a 400-line price list".
 */

export type { Complexity };

export type ModelTier = CatalogEntry['tier'];

export interface TaskAssessment {
  complexity: Complexity;
  /** Score in [0, 1] that produced the complexity bucket — useful for audit. */
  score: number;
  /** Preferred tiers, most preferred first. */
  preferredTiers: ModelTier[];
  sizeBucket: 'small' | 'medium' | 'large';
  /** Human-readable reasons, persisted with the selection for explainability. */
  reasons: string[];
}

/** Inputs are bucketed, never used raw — keeps the context hierarchy coarse. */
export function sizeBucketFor(input: unknown): 'small' | 'medium' | 'large' {
  const size = JSON.stringify(input ?? '').length;
  if (size < 2_000) return 'small';
  return size < 20_000 ? 'medium' : 'large';
}

/** Task-type baselines: where a typical call of this kind sits before looking at input. */
const TASK_BASELINE: Record<TaskType, { score: number; reason: string }> = {
  classify_moisture_reading: {
    score: 0.15,
    reason: 'single reading classification — low volume of reasoning',
  },
  summarize_job_notes: {
    score: 0.3,
    reason: 'high-volume summarisation — prefer cheap, fast arms',
  },
  customer_update_email: {
    score: 0.45,
    reason: 'customer-facing prose needs tone control without heavy reasoning',
  },
  draft_scope: {
    score: 0.55,
    reason: 'scope drafting needs industry judgement and groundedness',
  },
  extract_document_fields: {
    score: 0.65,
    reason: 'document extraction needs careful groundedness over long context',
  },
  estimate_line_items: {
    score: 0.75,
    reason: 'priced estimates are high-stakes arithmetic — prefer frontier models',
  },
};

const COMPLEXITY_THRESHOLDS = {
  /** score < simpleMax → simple */
  simpleMax: 0.4,
  /** score < moderateMax → moderate; else complex */
  moderateMax: 0.7,
} as const;

const TIER_PREFERENCE: Record<Complexity, ModelTier[]> = {
  simple: ['fast', 'balanced', 'frontier'],
  moderate: ['balanced', 'frontier', 'fast'],
  complex: ['frontier', 'balanced', 'fast'],
};

/**
 * Soft provider hints for cold-start ties at the same tier.
 *
 * These are opening guesses, not hard routing rules — the bandit replaces them
 * once it has trials. They encode known strengths: long-context extraction on
 * Gemini, careful reasoning on Anthropic, structured JSON on OpenAI, etc.
 */
const PROVIDER_HINTS: Partial<Record<TaskType, string[]>> = {
  extract_document_fields: ['google', 'anthropic', 'openai', 'xai', 'oss'],
  estimate_line_items: ['anthropic', 'openai', 'xai', 'google', 'oss'],
  draft_scope: ['anthropic', 'openai', 'google', 'xai', 'oss'],
  customer_update_email: ['anthropic', 'openai', 'google', 'xai', 'oss'],
  summarize_job_notes: ['google', 'openai', 'anthropic', 'oss', 'xai'],
  classify_moisture_reading: ['anthropic', 'google', 'openai', 'oss', 'xai'],
};

export function assessTask(taskType: TaskType, input: unknown, workType?: string): TaskAssessment {
  const spec = getTaskSpec(taskType);
  const baseline = TASK_BASELINE[taskType];
  const reasons: string[] = [baseline.reason];
  let score = baseline.score;

  const sizeBucket = sizeBucketFor(input);
  if (sizeBucket === 'medium') {
    score += 0.1;
    reasons.push('medium-sized input');
  } else if (sizeBucket === 'large') {
    score += 0.22;
    reasons.push('large input — needs a stronger model');
  }

  if (spec.highStakes) {
    score += 0.12;
    reasons.push('high-stakes task: quality outweighs cost');
  }

  if (workType === 'construction') {
    score += 0.05;
    reasons.push('construction work tends to need richer reasoning than mitigation');
  }

  score += structuralBoost(taskType, input, reasons);

  score = clamp01(score);
  const complexity = complexityFromScore(score);

  return {
    complexity,
    score,
    preferredTiers: TIER_PREFERENCE[complexity],
    sizeBucket,
    reasons,
  };
}

function structuralBoost(taskType: TaskType, input: unknown, reasons: string[]): number {
  if (!input || typeof input !== 'object') return 0;
  const obj = input as Record<string, unknown>;
  let boost = 0;

  switch (taskType) {
    case 'estimate_line_items': {
      const priceList = Array.isArray(obj.priceList) ? obj.priceList : [];
      if (priceList.length > 200) {
        boost += 0.12;
        reasons.push(`large price list (${priceList.length} items)`);
      } else if (priceList.length > 50) {
        boost += 0.06;
        reasons.push(`substantial price list (${priceList.length} items)`);
      }
      const measurements =
        obj.measurements && typeof obj.measurements === 'object'
          ? Object.keys(obj.measurements as object).length
          : 0;
      if (measurements > 20) {
        boost += 0.05;
        reasons.push(`many measurements (${measurements})`);
      }
      break;
    }
    case 'extract_document_fields': {
      const doc = typeof obj.documentText === 'string' ? obj.documentText : '';
      const fields = Array.isArray(obj.fields) ? obj.fields : [];
      if (doc.length > 50_000) {
        boost += 0.15;
        reasons.push('very long document');
      } else if (doc.length > 10_000) {
        boost += 0.08;
        reasons.push('long document');
      }
      if (fields.length > 20) {
        boost += 0.06;
        reasons.push(`many fields to extract (${fields.length})`);
      }
      break;
    }
    case 'draft_scope': {
      const readings = Array.isArray(obj.readings) ? obj.readings : [];
      if (readings.length > 40) {
        boost += 0.08;
        reasons.push(`dense readings (${readings.length})`);
      }
      break;
    }
    case 'summarize_job_notes': {
      const notes = Array.isArray(obj.notes) ? obj.notes : [];
      if (notes.length > 80) {
        boost += 0.1;
        reasons.push(`long note thread (${notes.length} entries)`);
      } else if (notes.length > 25) {
        boost += 0.05;
        reasons.push(`substantial note thread (${notes.length} entries)`);
      }
      break;
    }
    default:
      break;
  }

  return boost;
}

export function complexityFromScore(score: number): Complexity {
  if (score < COMPLEXITY_THRESHOLDS.simpleMax) return 'simple';
  if (score < COMPLEXITY_THRESHOLDS.moderateMax) return 'moderate';
  return 'complex';
}

/** How well an arm's model tier matches the assessment. Higher is better. */
export function tierFit(arm: Arm, assessment: TaskAssessment): number {
  const entry = lookupModel(arm.provider, arm.model);
  const tier = entry?.tier ?? 'fast';
  const index = assessment.preferredTiers.indexOf(tier);
  if (index < 0) return 0;
  // 1.0 for best match, then 0.55 / 0.2 for the runners-up.
  return index === 0 ? 1 : index === 1 ? 0.55 : 0.2;
}

/**
 * Cold-start / prior ranking: prefer the assessed tier, then provider hints,
 * then the catalog's tier prior mean. Used when there is no champion yet, and
 * as a soft bias when exploration has no learned signal.
 */
export function rankArmForAssessment(arm: Arm, assessment: TaskAssessment, taskType: TaskType): number {
  const fit = tierFit(arm, assessment);
  const hints = PROVIDER_HINTS[taskType] ?? [];
  const providerRank = hints.indexOf(arm.provider);
  const providerScore = providerRank < 0 ? 0 : (hints.length - providerRank) / hints.length;
  return fit * 10 + providerScore;
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}
