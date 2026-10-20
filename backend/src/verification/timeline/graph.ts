/**
 * Project timeline events and workflow graph relationships.
 */

import { randomUUID } from 'node:crypto';
import type { PipelineContext } from '../pipeline/orchestrator.js';

// project_timeline_events was dropped (20260910190000). Both stages stay in the
// pipeline as no-ops so existing step rows line up, but they must not query
// the missing table or every run fails after generate_verifications.
export function createGenerateVerifiedEventsHandler(): (
  ctx: PipelineContext,
) => Promise<{ output: Record<string, unknown> }> {
  return async () => ({ output: { timelineEvents: 0, skipped: 'project_timeline_events dropped' } });
}

export function createUpdateProjectGraphHandler(): (
  ctx: PipelineContext,
) => Promise<{ output: Record<string, unknown> }> {
  return async () => ({ output: { edges: 0, skipped: 'workflow graph dropped' } });
}

export async function linkOutcome(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _supabase: any,
  _opts: {
    orgId: string;
    jobId: string;
    timelineEventId?: string | null;
    resultId?: string | null;
    outcomeType: string;
    externalRef?: string | null;
    amountCents?: number | null;
    occurredAt?: string | null;
    payload?: Record<string, unknown>;
  },
): Promise<string> {
  // outcome_records dropped
  return randomUUID();
}
