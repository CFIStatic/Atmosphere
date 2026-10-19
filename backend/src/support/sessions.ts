/**
 * Staff support access: "Open account" from Atmosphere Analytics.
 *
 * An Analytics staff member (internal scope) opens a time-limited session in
 * which Platform runs as ONE specific customer user, with that user's role and
 * permissions (row-level security included), so support sees exactly what the
 * customer sees.
 *
 * How it is secured:
 * - Only the server creates sessions, behind requireAuth + requireAnalytics('internal').
 * - The customer session is minted server-side (admin generateLink + verifyOtp;
 *   no email is sent). Its refresh token is never given to any browser, so it
 *   cannot outlive SUPPORT_SESSION_MS, and it is revoked on Exit / expiry.
 * - Analytics only gets a one-time handoff URL (code stored as sha256, valid
 *   HANDOFF_MS). The Platform tab redeems it once and receives host-only,
 *   httpOnly cookies, so the staff member's own Analytics session is untouched.
 * - Every session is a row in staff_support_sessions (who, which user and
 *   workspace, reason, created/entered/ended) plus activity-log events.
 * - Billing writes are refused while viewing as a customer (see
 *   isBlockedSupportRequest), never performed silently.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

export const SUPPORT_SESSION_MS = 30 * 60 * 1000;
export const HANDOFF_MS = 2 * 60 * 1000;
export const SUPPORT_SID_COOKIE = 'atm_support_sid';
export const SUPPORT_TOKEN_COOKIE = 'atm_support_at';

export type SupportSessionRow = {
  id: string;
  staff_user_id: string;
  staff_email: string | null;
  target_user_id: string;
  target_email: string | null;
  org_id: string;
  reason: string | null;
  created_at: string;
  expires_at: string;
  entered_at: string | null;
  ended_at: string | null;
  cookie_hash: string | null;
};

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function newOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

function keyFrom(secret: string): Buffer {
  return createHash('sha256').update(`atmosphere-support-handoff:${secret}`).digest();
}

/** AES-256-GCM, key derived from a server-only secret. */
export function sealToken(plain: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFrom(secret), iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, body].map((b) => b.toString('base64url')).join('.');
}

export function openToken(sealed: string, secret: string): string {
  const [iv, tag, body] = sealed.split('.').map((p) => Buffer.from(p, 'base64url'));
  if (!iv || !tag || !body) throw new Error('bad sealed token');
  const decipher = createDecipheriv('aes-256-gcm', keyFrom(secret), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
}

export function isSessionLive(row: Pick<SupportSessionRow, 'expires_at' | 'ended_at'>, now = new Date()): boolean {
  if (row.ended_at) return false;
  const exp = Date.parse(row.expires_at);
  return Number.isFinite(exp) && exp > now.getTime();
}

/**
 * Requests refused while viewing as a customer: anything that changes billing,
 * plan, seats, payment, credits, or deletes the account. Reads stay allowed.
 */
const BLOCKED_WRITE_PATTERNS: RegExp[] = [
  /^\/api\/billing(\/|$)/,
  /^\/api\/stripe(\/|$)/,
  /checkout/i,
  /subscription/i,
  /\/seats?(\/|$)/,
  /\/credits?(\/|$)/,
  /\/plan(\/|$)/,
  /^\/api\/auth\/account(\/|$)/,
  /^\/api\/auth\/(password|email)(\/|$)/,
];

export function isBlockedSupportRequest(method: string, path: string): boolean {
  const m = method.toUpperCase();
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return false;
  const p = path.split('?')[0] ?? '';
  if (p.startsWith('/api/support/')) return false;
  return BLOCKED_WRITE_PATTERNS.some((re) => re.test(p));
}

export async function findLiveSessionByCookie(
  admin: SupabaseClient,
  sid: string,
): Promise<SupportSessionRow | null> {
  const { data, error } = await admin
    .from('staff_support_sessions')
    .select('id, staff_user_id, staff_email, target_user_id, target_email, org_id, reason, created_at, expires_at, entered_at, ended_at, cookie_hash')
    .eq('cookie_hash', sha256Hex(sid))
    .maybeSingle();
  if (error || !data) return null;
  return data as SupportSessionRow;
}
