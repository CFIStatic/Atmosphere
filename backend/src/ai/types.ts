import type { ProviderId } from './providers/types.js';

/**
 * Core domain types for the learning loop.
 *
 * The formulation is a **contextual bandit**, not full RL with a value function
 * over trajectories, and the choice is deliberate. We call third-party APIs we
 * cannot backpropagate through, each unit of work is a single decision rather
 * than a long episode, and the reward arrives within hours. A bandit fits that
 * exactly, needs orders of magnitude less data than policy-gradient training,
 * and — critically — every decision it makes stays inspectable: you can always
 * answer "why did it pick that model for this job?" with a row from a table.
 *
 *   state / context → which kind of work, for which org, of what size
 *   action          → an Arm: model + prompt variant + parameters
 *   reward          → scalar in [0,1] from verifier + human + downstream signals
 *
 * The action space is the *executor configuration*, not the token stream. That
 * is the load-bearing idea: we get better at work by learning which
 * configuration does each job best, which requires no model weights of our own
 * and improves the moment a better vendor model ships.
 */

/** Kinds of work the platform executes. Extend by adding a spec in taskTypes.ts. */
export type TaskType =
  | 'draft_scope'
  | 'estimate_line_items'
  | 'summarize_job_notes'
  | 'customer_update_email'
  | 'extract_document_fields'
  | 'classify_moisture_reading';

/** An action the policy can take: a fully-specified way to execute a task. */
export interface Arm {
  id: string;
  taskType: TaskType;
  provider: ProviderId;
  model: string;
  /** Named prompt strategy, resolved by the task spec (e.g. `terse`, `cot`). */
  promptVariant: string;
  temperature?: number;
  maxOutputTokens?: number;
  /**
   * `champion` serves most traffic; `candidate` is under evaluation and capped
   * at a small traffic share; `retired` never routes. Exactly one champion per
   * task type is enforced by the database.
   */
  status: 'champion' | 'candidate' | 'retired';
}

/** The observed context for one decision. Kept coarse — see contextKey(). */
export interface TaskContext {
  taskType: TaskType;
  orgId: string;
  userId: string;
  /** Mitigation vs construction — the two lines of work behave differently. */
  workType?: string;
  /** Bucketed input size; a long job file is a different problem to a short one. */
  sizeBucket?: 'small' | 'medium' | 'large';
}

/** How a completed run was received. Drives the dominant term of the reward. */
export type Disposition =
  | 'pending'
  | 'accepted'
  | 'edited_minor'
  | 'edited_major'
  | 'rejected'
  | 'failed';

/** Deterministic, cheap checks run on every output before a human sees it. */
export interface VerifierResult {
  /** [0,1]; 0 means every check failed. */
  score: number;
  /** Any check marked fatal failing means the output must not be served. */
  passed: boolean;
  checks: Array<{ name: string; passed: boolean; weight: number; detail?: string }>;
}

/** One recorded decision and everything learned from it. */
export interface Episode {
  id: string;
  orgId: string;
  userId: string;
  taskType: TaskType;
  contextKey: string;
  armId: string;
  provider: ProviderId;
  model: string;
  promptVariant: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
  verifierScore: number | null;
  disposition: Disposition;
  /** Fraction of the output the human changed, when we can measure it. */
  editRatio: number | null;
  reward: number | null;
  /**
   * `provisional` — scored by verifier alone, already folded into the policy so
   * it can react within minutes. `final` — a human or downstream signal landed
   * and replaced it. Stats are updated by delta, so the correction is exact.
   */
  rewardStatus: 'provisional' | 'final';
  createdAt: string;
}

/** Per-arm, per-context posterior maintained by the policy. */
export interface ArmStats {
  armId: string;
  contextKey: string;
  trials: number;
  rewardSum: number;
  /** Beta posterior parameters; see policy.ts for why Beta over a Gaussian. */
  alpha: number;
  beta: number;
  avgCostUsd: number;
  avgLatencyMs: number;
}

/** What the executor returns to a caller. */
export interface ExecutionResult<T = unknown> {
  runId: string;
  output: T;
  raw: string;
  arm: { id: string; provider: ProviderId; model: string; promptVariant: string };
  verifier: VerifierResult;
  costUsd: number;
  latencyMs: number;
  /** True when this run was an exploration pull rather than the champion. */
  explored: boolean;
}
