import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Append a row to the campaign timeline. Never throws — a missing timeline
 * entry must not stop the agent mid-pipeline.
 */
export async function logSalesEvent(
  supabase: SupabaseClient,
  input: {
    orgId: string;
    campaignId: string;
    businessId?: string | null;
    contactId?: string | null;
    actorType?: 'user' | 'agent' | 'system';
    eventType: string;
    detail?: string | null;
    payload?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    await supabase.from('sales_events').insert({
      org_id: input.orgId,
      campaign_id: input.campaignId,
      business_id: input.businessId ?? null,
      contact_id: input.contactId ?? null,
      actor_type: input.actorType ?? 'agent',
      event_type: input.eventType.slice(0, 60),
      detail: input.detail?.slice(0, 4000) ?? null,
      payload: input.payload ?? {},
    });
  } catch {
    // swallow
  }
}

export function serializeCampaign(row: Record<string, unknown>) {
  return {
    id: row.id,
    orgId: row.org_id,
    createdBy: row.created_by,
    name: row.name,
    territory: row.territory,
    salesFocus: row.sales_focus,
    valueProp: row.value_prop ?? null,
    senderName: row.sender_name ?? null,
    senderEmail: row.sender_email ?? null,
    meetingDurationMin: row.meeting_duration_min,
    availability: row.availability ?? {},
    status: row.status,
    stageDetail: row.stage_detail ?? null,
    error: row.error ?? null,
    agentRunId: row.agent_run_id ?? null,
    businessesFound: row.businesses_found ?? 0,
    contactsFound: row.contacts_found ?? 0,
    emailsSent: row.emails_sent ?? 0,
    repliesReceived: row.replies_received ?? 0,
    meetingsBooked: row.meetings_booked ?? 0,
    startedAt: row.started_at ?? null,
    finishedAt: row.finished_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function serializeBusiness(row: Record<string, unknown>) {
  return {
    id: row.id,
    orgId: row.org_id,
    campaignId: row.campaign_id,
    name: row.name,
    category: row.category ?? null,
    address: row.address ?? null,
    city: row.city ?? null,
    region: row.region ?? null,
    postalCode: row.postal_code ?? null,
    country: row.country ?? null,
    phone: row.phone ?? null,
    websiteUrl: row.website_url ?? null,
    lat: row.lat ?? null,
    lng: row.lng ?? null,
    source: row.source,
    sourceRef: row.source_ref ?? null,
    researchNotes: row.research_notes ?? null,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function serializeContact(row: Record<string, unknown>) {
  return {
    id: row.id,
    orgId: row.org_id,
    campaignId: row.campaign_id,
    businessId: row.business_id,
    fullName: row.full_name,
    title: row.title ?? null,
    email: row.email ?? null,
    phone: row.phone ?? null,
    linkedinUrl: row.linkedin_url ?? null,
    isDecisionMaker: Boolean(row.is_decision_maker),
    researchSummary: row.research_summary ?? null,
    personalizationHooks: Array.isArray(row.personalization_hooks)
      ? row.personalization_hooks
      : [],
    status: row.status,
    nextFollowupAt: row.next_followup_at ?? null,
    lastTouchedAt: row.last_touched_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function serializeOutreach(row: Record<string, unknown>) {
  return {
    id: row.id,
    orgId: row.org_id,
    campaignId: row.campaign_id,
    contactId: row.contact_id,
    businessId: row.business_id,
    direction: row.direction,
    channel: row.channel,
    subject: row.subject ?? null,
    body: row.body,
    sequenceStep: row.sequence_step,
    status: row.status,
    providerMessageId: row.provider_message_id ?? null,
    intent: row.intent ?? null,
    sentAt: row.sent_at ?? null,
    createdAt: row.created_at,
  };
}

export function serializeMeeting(row: Record<string, unknown>) {
  return {
    id: row.id,
    orgId: row.org_id,
    campaignId: row.campaign_id,
    contactId: row.contact_id,
    businessId: row.business_id,
    title: row.title,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    location: row.location ?? null,
    meetingUrl: row.meeting_url ?? null,
    status: row.status,
    bookedBy: row.booked_by,
    notes: row.notes ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function serializeEvent(row: Record<string, unknown>) {
  return {
    id: row.id,
    orgId: row.org_id,
    campaignId: row.campaign_id,
    businessId: row.business_id ?? null,
    contactId: row.contact_id ?? null,
    actorType: row.actor_type,
    eventType: row.event_type,
    detail: row.detail ?? null,
    payload: row.payload ?? {},
    createdAt: row.created_at,
  };
}
