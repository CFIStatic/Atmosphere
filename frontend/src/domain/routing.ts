import type { AgentCapability } from './types';

/**
 * Request routing for the unified assistant.
 *
 * Users address one Atmosphere, never a menu of agents. This module turns a
 * natural-language request into the capability that should handle it. In
 * production the classifier is a model call; the deterministic keyword pass
 * below is the local fallback and, importantly, the thing that makes routing
 * testable and explainable without a network round-trip.
 */

const SIGNALS: Record<AgentCapability, string[]> = {
  scheduling: [
    'schedule',
    'reschedule',
    'book',
    'dispatch',
    'crew',
    'calendar',
    'appointment',
    'availability',
    'assign tech',
    'move the',
    'push back',
    'tomorrow',
    'monday',
  ],
  estimating: [
    'estimate',
    'xactimate',
    'scope',
    'line item',
    'supplement',
    'pricing',
    'bid',
    'quote',
    'measurement',
    'sketch',
    'carrier approval',
  ],
  collections: [
    'invoice',
    'collect',
    'payment',
    'past due',
    'overdue',
    'ar ',
    'receivable',
    'balance',
    'deductible',
    'remind',
    'statement',
    'quickbooks',
  ],
  project_management: [
    'job',
    'task',
    'status',
    'phase',
    'timeline',
    'deadline',
    'progress',
    'update the',
    'close out',
    'work order',
    'equipment',
    'drying',
  ],
  compliance: [
    'compliance',
    'document',
    'certificate',
    'coc',
    'signature',
    'authorization',
    'iicrc',
    'audit',
    'required form',
    'photo requirement',
    'moisture log',
  ],
  customer_comms: [
    'email',
    'call',
    'text',
    'message',
    'notify',
    'follow up',
    'customer',
    'homeowner',
    'reply',
    'update them',
    'send a',
  ],
  documentation: [
    'report',
    'summary',
    'write up',
    'photos',
    'upload',
    'attach',
    'file',
    'paperwork',
    'moisture reading',
    'notes',
  ],
};

export interface RoutingResult {
  capability: AgentCapability;
  /** 0–1. Low confidence should surface a confirmation rather than acting. */
  confidence: number;
  /** Terms that drove the decision, so the UI can explain the routing. */
  matched: string[];
}

/** Capability chosen when nothing matches — the generalist. */
const DEFAULT_CAPABILITY: AgentCapability = 'project_management';

/**
 * Classify a free-text request. Scores every capability by how many of its
 * signals appear, then normalises the winner against total matches so a request
 * hitting several domains reports genuine uncertainty instead of false
 * confidence.
 */
export function routeRequest(input: string): RoutingResult {
  const text = ` ${input.toLowerCase()} `;

  let best: AgentCapability = DEFAULT_CAPABILITY;
  let bestMatches: string[] = [];
  let totalMatches = 0;

  for (const [capability, signals] of Object.entries(SIGNALS) as [AgentCapability, string[]][]) {
    const matched = signals.filter((s) => text.includes(s));
    totalMatches += matched.length;
    if (matched.length > bestMatches.length) {
      best = capability;
      bestMatches = matched;
    }
  }

  if (bestMatches.length === 0) {
    return { capability: DEFAULT_CAPABILITY, confidence: 0.25, matched: [] };
  }

  // Share of all signal hits belonging to the winner, damped so a single weak
  // keyword never reads as certainty.
  const share = bestMatches.length / Math.max(totalMatches, 1);
  const confidence = Math.min(0.95, 0.45 + share * 0.5);

  return { capability: best, confidence, matched: bestMatches };
}

export const CAPABILITY_LABELS: Record<AgentCapability, string> = {
  scheduling: 'Scheduling',
  estimating: 'Estimating',
  collections: 'Collections',
  project_management: 'Project Management',
  compliance: 'Compliance',
  customer_comms: 'Customer Communications',
  documentation: 'Documentation',
};

/** Below this, the assistant asks before acting rather than proposing a change. */
export const CONFIDENCE_THRESHOLD = 0.5;

export function needsClarification(result: RoutingResult): boolean {
  return result.confidence < CONFIDENCE_THRESHOLD;
}
