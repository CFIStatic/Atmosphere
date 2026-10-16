/**
 * Inbound legal requests from legal@atmosphereteam.com.
 *
 * A Cloudflare Email Worker forwards each message to the founder's inbox and
 * POSTs a parsed copy here. Each message becomes one `legal_requests` row so
 * holds, preservation and takedown requests have a record and a response clock.
 *
 * Tests set LEGAL_STORE=memory. Production writes through the service role;
 * the table has RLS on and no policies, so customers can never read it.
 */
import { randomUUID, timingSafeEqual, createHash } from 'node:crypto';
import { z } from 'zod';
import { requireAdmin, useMemoryLegalStore } from '../lib/adminClient.js';

export const LEGAL_REQUEST_STATUSES = ['new', 'acknowledged', 'hold_placed', 'closed', 'rejected'] as const;
export type LegalRequestStatus = (typeof LEGAL_REQUEST_STATUSES)[number];

export const inboundLegalEmailSchema = z.object({
  messageId: z.string().trim().max(998).optional().nullable(),
  from: z.string().trim().min(1).max(320),
  fromName: z.string().trim().max(320).optional().nullable(),
  to: z.string().trim().max(320).optional().nullable(),
  subject: z.string().max(998).optional().nullable(),
  text: z.string().max(200_000).optional().nullable(),
  receivedAt: z.string().datetime().optional(),
  rawSize: z.number().int().min(0).optional().nullable(),
  attachments: z
    .array(
      z.object({
        filename: z.string().max(500).nullable().optional(),
        contentType: z.string().max(200).nullable().optional(),
        size: z.number().int().min(0),
      }),
    )
    .max(100)
    .default([]),
});
export type InboundLegalEmail = z.infer<typeof inboundLegalEmailSchema>;

export interface LegalRequest {
  id: string;
  messageId: string | null;
  fromAddress: string;
  fromName: string | null;
  toAddress: string | null;
  subject: string | null;
  textBody: string | null;
  attachments: Array<{ filename?: string | null; contentType?: string | null; size: number }>;
  rawSize: number | null;
  receivedAt: string;
  status: LegalRequestStatus;
  createdAt: string;
}

const memory = new Map<string, LegalRequest>();

export function resetLegalRequestsForTests(): void {
  memory.clear();
}

/**
 * Constant-time check of the shared secret header. A missing or empty
 * configured secret rejects everything, so the route is closed by default.
 */
export function inboundSecretMatches(provided: unknown, configured = process.env.LEGAL_INBOUND_SECRET): boolean {
  if (!configured || typeof provided !== 'string' || provided.length === 0) return false;
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(configured).digest();
  return timingSafeEqual(a, b);
}

function fromRow(row: Record<string, any>): LegalRequest {
  return {
    id: row.id,
    messageId: row.message_id ?? null,
    fromAddress: row.from_address,
    fromName: row.from_name ?? null,
    toAddress: row.to_address ?? null,
    subject: row.subject ?? null,
    textBody: row.text_body ?? null,
    attachments: Array.isArray(row.attachments) ? row.attachments : [],
    rawSize: row.raw_size ?? null,
    receivedAt: row.received_at,
    status: row.status,
    createdAt: row.created_at,
  };
}

/** Store one inbound email. Idempotent on message id (Worker retries). */
export async function recordInboundLegalEmail(
  input: InboundLegalEmail,
): Promise<{ request: LegalRequest; duplicate: boolean }> {
  const messageId = input.messageId?.trim() || null;
  const now = new Date().toISOString();

  if (useMemoryLegalStore()) {
    if (messageId) {
      for (const r of memory.values()) {
        if (r.messageId === messageId) return { request: r, duplicate: true };
      }
    }
    const request: LegalRequest = {
      id: randomUUID(),
      messageId,
      fromAddress: input.from,
      fromName: input.fromName ?? null,
      toAddress: input.to ?? null,
      subject: input.subject ?? null,
      textBody: input.text ?? null,
      attachments: input.attachments ?? [],
      rawSize: input.rawSize ?? null,
      receivedAt: input.receivedAt ?? now,
      status: 'new',
      createdAt: now,
    };
    memory.set(request.id, request);
    return { request, duplicate: false };
  }

  const admin = requireAdmin();
  if (messageId) {
    const { data: existing, error: findErr } = await admin
      .from('legal_requests')
      .select('*')
      .eq('message_id', messageId)
      .maybeSingle();
    if (findErr) throw findErr;
    if (existing) return { request: fromRow(existing), duplicate: true };
  }
  const { data, error } = await admin
    .from('legal_requests')
    .insert({
      message_id: messageId,
      from_address: input.from,
      from_name: input.fromName ?? null,
      to_address: input.to ?? null,
      subject: input.subject ?? null,
      text_body: input.text ?? null,
      attachments: input.attachments ?? [],
      raw_size: input.rawSize ?? null,
      received_at: input.receivedAt ?? now,
    })
    .select('*')
    .single();
  if (error) throw error;
  return { request: fromRow(data), duplicate: false };
}

/** Newest first, for the staff legal area. */
export async function listLegalRequests(limit = 200): Promise<LegalRequest[]> {
  if (useMemoryLegalStore()) {
    return [...memory.values()]
      .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
      .slice(0, limit);
  }
  const { data, error } = await requireAdmin()
    .from('legal_requests')
    .select('*')
    .order('received_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map(fromRow);
}
