/**
 * Messaging intake — @atmosphere mentions from iMessage, WhatsApp, Signal, SMS.
 *
 * Bridge services (a Mac relay, WhatsApp Cloud API, Signal rest-api, …) POST
 * signed payloads to /api/webhooks/atmosphere-mention. We document the
 * conversation against a project when we can match one, and open an approval
 * when the mention asks Atmosphere to do something irreversible.
 */

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import * as orch from './store.js';
import type { Communication, CommunicationChannel, CounterpartyKind } from './types.js';

const MENTION_RE = /@atmosphere\b/i;

export interface MentionPayload {
  orgId: string;
  channel: CommunicationChannel;
  body: string;
  counterpartyName?: string | null;
  counterpartyHandle?: string | null;
  counterpartyKind?: CounterpartyKind;
  threadKey?: string | null;
  externalMessageId?: string | null;
  occurredAt?: string | null;
  claimNumber?: string | null;
  phone?: string | null;
  addressHint?: string | null;
  projectId?: string | null;
  metadata?: Record<string, unknown>;
  /** Override intake classification (manual filing vs bridge mention). */
  intake?: 'mention' | 'relay' | 'manual' | 'platform_sync';
}

export function extractMentionExcerpt(body: string): string | null {
  if (!MENTION_RE.test(body)) return null;
  const idx = body.search(MENTION_RE);
  const start = Math.max(0, idx - 40);
  const end = Math.min(body.length, idx + 200);
  return body.slice(start, end).trim();
}

/** Heuristic: the mention is asking Atmosphere to act, not just to file a note. */
export function mentionRequestsAction(body: string): boolean {
  return /\b(approve|order|schedule|dispatch|send|book|bid|pay|submit|update\s+xact|push\s+to|write\s+to)\b/i.test(
    body,
  );
}

export function communicationFingerprint(input: {
  orgId: string;
  channel: string;
  externalMessageId?: string | null;
  threadKey?: string | null;
  body: string;
  occurredAt?: string | null;
}): string {
  if (input.externalMessageId) {
    return `ext:${input.channel}:${input.externalMessageId}`;
  }
  const h = createHash('sha256')
    .update(
      [
        input.orgId,
        input.channel,
        input.threadKey ?? '',
        input.occurredAt ?? '',
        input.body.trim(),
      ].join('|'),
    )
    .digest('hex')
    .slice(0, 40);
  return `hash:${h}`;
}

export function verifyMentionSignature(
  rawBody: Buffer | string,
  signatureHeader: string | undefined,
  secret: string,
): boolean {
  if (!secret || !signatureHeader) return false;
  const provided = signatureHeader.replace(/^sha256=/i, '').trim();
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  try {
    const a = Buffer.from(provided, 'hex');
    const b = Buffer.from(expected, 'hex');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export async function ingestMention(
  supabase: SupabaseClient,
  payload: MentionPayload,
  options: { recordedBy?: string | null } = {},
): Promise<{
  communication: Communication;
  matchedProjectId: string | null;
  approvalId: string | null;
  duplicate: boolean;
}> {
  const excerpt = extractMentionExcerpt(payload.body);
  const fingerprint = communicationFingerprint({
    orgId: payload.orgId,
    channel: payload.channel,
    externalMessageId: payload.externalMessageId,
    threadKey: payload.threadKey,
    body: payload.body,
    occurredAt: payload.occurredAt,
  });

  let projectId = payload.projectId ?? null;
  if (!projectId) {
    const match = await orch.findProjectForMention(supabase, payload.orgId, {
      phone: payload.phone ?? payload.counterpartyHandle,
      claimNumber: payload.claimNumber,
      addressHint: payload.addressHint,
    });
    projectId = match?.id ?? null;
  }

  const before = await orch.listCommunications(supabase, payload.orgId, {
    limit: 5,
    status: ['new', 'reviewed', 'filed', 'actioned', 'ignored'],
  });
  const already = before.find((c) => c.fingerprint === fingerprint);

  const communication = await orch.insertCommunication(supabase, payload.orgId, {
    project_id: projectId,
    channel: payload.channel,
    direction: 'inbound',
    intake: payload.intake ?? (excerpt ? 'mention' : 'relay'),
    counterparty_name: payload.counterpartyName ?? null,
    counterparty_handle: payload.counterpartyHandle ?? null,
    counterparty_kind: payload.counterpartyKind ?? 'unknown',
    body: payload.body,
    mention_excerpt: excerpt,
    thread_key: payload.threadKey ?? null,
    external_message_id: payload.externalMessageId ?? null,
    fingerprint,
    status: 'new',
    metadata: payload.metadata ?? {},
    occurred_at: payload.occurredAt ?? new Date().toISOString(),
  });

  let approvalId: string | null = null;
  if (!already && mentionRequestsAction(payload.body)) {
    const approval = await orch.createApproval(supabase, payload.orgId, {
      project_id: projectId,
      kind: 'messaging_action',
      title: `Action requested via ${payload.channel}`,
      detail: payload.body.slice(0, 4000),
      proposed_action: {
        type: 'messaging_action',
        communicationId: communication.id,
        channel: payload.channel,
        counterparty: payload.counterpartyHandle ?? payload.counterpartyName,
      },
      platform: 'messaging',
      priority: 'high',
      requested_by: options.recordedBy ?? null,
      source_ref: communication.id,
    });
    approvalId = approval.id;
    await orch.updateCommunication(supabase, communication.id, {
      metadata: { ...(communication.metadata ?? {}), approvalId },
    });
  }

  return {
    communication,
    matchedProjectId: projectId,
    approvalId,
    duplicate: Boolean(already),
  };
}
