/**
 * Append-only verification audit trail.
 */

export interface AuditEventInput {
  orgId: string;
  jobId?: string | null;
  videoId?: string | null;
  resultId?: string | null;
  actorId?: string | null;
  eventType: string;
  entityType: string;
  entityId?: string | null;
  payload?: Record<string, unknown>;
}

export async function appendAuditEvent(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  event: AuditEventInput,
): Promise<void> {
  const { error } = await supabase.from('verification_audit_events').insert({
    org_id: event.orgId,
    job_id: event.jobId ?? null,
    video_id: event.videoId ?? null,
    result_id: event.resultId ?? null,
    actor_id: event.actorId ?? null,
    event_type: event.eventType,
    entity_type: event.entityType,
    entity_id: event.entityId ?? null,
    payload: event.payload ?? {},
  });
  if (error) {
    // Audit must not take down the primary write path, but it must be loud.
    console.error('[verification.audit]', error.message, event.eventType);
  }
}
