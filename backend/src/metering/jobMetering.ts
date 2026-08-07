/**
 * Job metering — register a billable processed job once per billing period.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { RegisterBillableJobInput, RegisterBillableJobResult } from './types.js';

export async function registerBillableJob(
  client: SupabaseClient,
  input: RegisterBillableJobInput,
): Promise<RegisterBillableJobResult> {
  const { data, error } = await client.rpc('register_billable_job', {
    p_org: input.orgId,
    p_job_id: input.jobId,
    p_workflow_type: input.workflowType,
    p_idempotency_key: input.idempotencyKey,
    p_at: input.at ?? null,
  });
  if (error) throw error;
  const row = data as Record<string, unknown>;
  return {
    jobId: String(row.jobId),
    duplicate: Boolean(row.duplicate),
    periodStart: String(row.periodStart),
  };
}

export function registerBillableJobAsync(
  client: SupabaseClient,
  input: RegisterBillableJobInput,
): void {
  void registerBillableJob(client, input).catch((err) => {
    console.error('[metering] failed to register billable job', {
      orgId: input.orgId,
      jobId: input.jobId,
      err,
    });
  });
}
