/**
 * Chat approvals. When Chat wants to do something a person must okay (send a
 * text, revoke someone's access), it stores a pending action and shows a card
 * with Approve / Edit / Deny. Only an approval of that row runs the action:
 * the model can propose, never perform. Each row is decided once.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { HttpError } from '../lib/errors.js';
import { normalizeSmsNumber, sendSms } from './smsProvider.js';
import { revokeJobAccessPerson } from './revokeJobAccess.js';

type Db = { from: (table: string) => any };

export type PendingKind = 'send_job_sms' | 'revoke_access';
export type PendingStatus = 'pending' | 'approved' | 'denied' | 'expired' | 'failed';

export interface SmsPayload {
  to: string;
  body: string;
  /** Who the text is for, when known ("Dana Whitfield, adjuster"). */
  recipient?: string | null;
}

export interface RevokePayload {
  personId: string;
  name: string;
  email?: string | null;
}

export interface PendingActionView {
  id: string;
  kind: PendingKind;
  status: PendingStatus;
  title: string;
  payload: SmsPayload | RevokePayload;
  /** Whether the person may change the content before approving (texts: yes). */
  editable: boolean;
  result: string | null;
  decidedAt: string | null;
  createdAt: string;
  expiresAt: string;
}

interface Row {
  id: string;
  org_id: string;
  job_id: string;
  kind: PendingKind;
  payload: any;
  status: PendingStatus;
  result: string | null;
  decided_at: string | null;
  created_at: string;
  expires_at: string;
}

const SELECT = 'id, org_id, job_id, kind, payload, status, result, decided_at, created_at, expires_at';

function titleFor(kind: PendingKind, payload: any): string {
  if (kind === 'send_job_sms') return `Send a text to ${payload?.recipient || payload?.to || 'this number'}`;
  return `Remove ${payload?.name || payload?.email || 'this person'}'s access to this job`;
}

export function presentPendingAction(row: Row, now = Date.now()): PendingActionView {
  const expired = row.status === 'pending' && Date.parse(row.expires_at) <= now;
  return {
    id: row.id,
    kind: row.kind,
    status: expired ? 'expired' : row.status,
    title: titleFor(row.kind, row.payload),
    payload: row.payload,
    editable: row.kind === 'send_job_sms',
    result: expired ? 'This request expired. Ask again to make a new one.' : row.result,
    decidedAt: row.decided_at,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

/** Store a proposal. Returns its id for the card (path "ask-approval:<id>"). */
export async function createPendingAction(
  db: Db,
  input: { orgId: string; jobId: string; userId: string | null; kind: PendingKind; payload: SmsPayload | RevokePayload },
): Promise<string> {
  const { data, error } = await db
    .from('ask_pending_actions')
    .insert({ org_id: input.orgId, job_id: input.jobId, requested_by: input.userId, kind: input.kind, payload: input.payload })
    .select('id')
    .single();
  if (error || !data?.id) throw new HttpError(500, error?.message ?? 'Could not save the approval.', 'ask_approval_create_failed');
  return String(data.id);
}

async function loadRow(db: Db, input: { orgId: string; jobId: string; id: string }): Promise<Row> {
  const { data } = await db
    .from('ask_pending_actions')
    .select(SELECT)
    .eq('org_id', input.orgId)
    .eq('job_id', input.jobId)
    .eq('id', input.id)
    .maybeSingle();
  if (!data) throw new HttpError(404, 'That request is not on this job.', 'ask_approval_not_found');
  return data as Row;
}

export async function getPendingAction(db: Db, input: { orgId: string; jobId: string; id: string }): Promise<PendingActionView> {
  return presentPendingAction(await loadRow(db, input));
}

/**
 * Claim the row for a decision: pending → the new status, only if still
 * pending and unexpired. Two clicks (or two people) cannot both act.
 */
async function claim(db: Db, row: Row, status: 'approved' | 'denied', userId: string, payload?: any): Promise<boolean> {
  const { data } = await db
    .from('ask_pending_actions')
    .update({ status, decided_by: userId, decided_at: new Date().toISOString(), ...(payload ? { payload } : {}) })
    .eq('id', row.id)
    .eq('org_id', row.org_id)
    .eq('status', 'pending')
    .gt('expires_at', new Date().toISOString())
    .select('id');
  return Array.isArray(data) && data.length === 1;
}

async function finish(db: Db, row: Row, status: PendingStatus, result: string): Promise<void> {
  await db.from('ask_pending_actions').update({ status, result: result.slice(0, 500) }).eq('id', row.id).eq('org_id', row.org_id);
}

/** Deny: nothing happens, the card shows "Not sent" / "Kept access". */
export async function denyPendingAction(db: Db, input: { orgId: string; jobId: string; id: string; userId: string }): Promise<PendingActionView> {
  const row = await loadRow(db, input);
  if (!(await claim(db, row, 'denied', input.userId))) return presentPendingAction(await loadRow(db, input));
  const result = row.kind === 'send_job_sms' ? 'Not sent.' : 'Access kept.';
  await finish(db, row, 'denied', result);
  return presentPendingAction(await loadRow(db, input));
}

export interface ApproveDeps {
  sendSms?: typeof sendSms;
  revoke?: (personId: string) => Promise<unknown>;
}

/**
 * Approve: run the action exactly as shown (texts may be edited first), then
 * record the outcome. A failure is shown on the card, never retried silently.
 */
export async function approvePendingAction(
  db: Db,
  input: { orgId: string; jobId: string; id: string; userId: string; editedBody?: string | null },
  deps: ApproveDeps = {},
): Promise<PendingActionView> {
  const row = await loadRow(db, input);
  let payload = row.payload;
  if (row.kind === 'send_job_sms' && input.editedBody != null) {
    const body = input.editedBody.trim();
    if (!body) throw new HttpError(400, 'The text is empty.', 'ask_approval_empty');
    payload = { ...payload, body: body.slice(0, 1600) };
  }
  if (!(await claim(db, row, 'approved', input.userId, payload !== row.payload ? payload : undefined))) {
    return presentPendingAction(await loadRow(db, input));
  }
  try {
    if (row.kind === 'send_job_sms') {
      const to = normalizeSmsNumber(String(payload.to ?? ''));
      if (!to) {
        await finish(db, row, 'failed', 'That phone number does not look valid. Nothing was sent.');
      } else {
        const sent = await (deps.sendSms ?? sendSms)({ to, body: String(payload.body ?? ''), orgId: row.org_id, jobId: row.job_id });
        await finish(db, row, sent.ok ? 'approved' : 'failed', sent.ok ? `Text sent to ${payload.recipient || to}.` : `${sent.message} Nothing was sent.`);
      }
    } else {
      if (!deps.revoke) throw new Error('revoke unavailable');
      await deps.revoke(String(payload.personId));
      await finish(db, row, 'approved', payload.name || payload.email ? `${payload.name || payload.email} no longer has access to this job.` : 'Access removed.');
    }
  } catch (err) {
    const msg = err instanceof HttpError ? err.message : 'Something went wrong.';
    await finish(db, row, 'failed', `${msg} Nothing changed.`);
  }
  return presentPendingAction(await loadRow(db, input));
}

/** Default revoke for a route: the same function Who has access → Revoke uses. */
export function revokeWith(supabase: any, admin: any, orgId: string, jobId: string) {
  return (personId: string) => revokeJobAccessPerson({ supabase, admin, orgId, jobId, personId });
}
