/**
 * Per-step model routing for Computer, logged like ask_route_decisions.
 *
 * - strong (default claude-opus-5-5): the first step (planning), right after
 *   an action failed or did not take effect, after a person handed back, after
 *   a playbook replay failed, and when the page has not changed for a while.
 * - fast (default claude-haiku-4-5): routine steps on a known path.
 * - verify: the independent check before any irreversible step (preActionCheck.ts).
 * - fallback: the fast model errored, so the task's configured model took the step.
 *
 * COMPUTER_MODEL_ROUTING=0 turns routing off (every step uses the task's model).
 */
import { resolveAnthropicModel } from '../../lib/anthropicModel.js';

export interface RoutingConfig {
  enabled: boolean;
  fast: string;
  strong: string;
  verify: string;
}

export function routingConfig(baseModel: string): RoutingConfig {
  const off = (process.env.COMPUTER_MODEL_ROUTING ?? '').trim() === '0';
  return {
    enabled: !off,
    fast: resolveAnthropicModel(process.env.COMPUTER_FAST_MODEL, 'claude-haiku-4-5'),
    strong: resolveAnthropicModel(process.env.COMPUTER_STRONG_MODEL, 'claude-opus-5-5'),
    verify: resolveAnthropicModel(process.env.COMPUTER_VERIFY_MODEL, process.env.COMPUTER_STRONG_MODEL, 'claude-opus-5-5') || baseModel,
  };
}

export interface RouteSignals {
  /** 1-based model step within this run. */
  step: number;
  lastTurnFailed: boolean;
  afterHandoff: boolean;
  afterReplayFailure: boolean;
  /** Model turns in a row with no visible page change. */
  noProgressTurns: number;
  /** The fast model already errored in this task. */
  fastUnavailable: boolean;
}

export interface RoutePick {
  route: 'fast' | 'strong';
  model: string;
  reason: string;
}

export function chooseRoute(s: RouteSignals, cfg: RoutingConfig, baseModel: string): RoutePick {
  if (!cfg.enabled) return { route: 'strong', model: baseModel, reason: 'Routing is off; using the task model.' };
  if (s.step <= 1) return { route: 'strong', model: cfg.strong, reason: 'Planning the first step.' };
  if (s.afterReplayFailure) return { route: 'strong', model: cfg.strong, reason: 'The saved playbook did not finish; re-planning from here.' };
  if (s.afterHandoff) return { route: 'strong', model: cfg.strong, reason: 'A person handed back; re-reading the page.' };
  if (s.lastTurnFailed) return { route: 'strong', model: cfg.strong, reason: 'The last action failed or did not take effect.' };
  if (s.noProgressTurns >= 2) return { route: 'strong', model: cfg.strong, reason: 'No visible progress for two turns.' };
  if (s.fastUnavailable) return { route: 'fast', model: baseModel, reason: 'Routine step (fast model unavailable; using the task model).' };
  return { route: 'fast', model: cfg.fast, reason: 'Routine step on a known path.' };
}
