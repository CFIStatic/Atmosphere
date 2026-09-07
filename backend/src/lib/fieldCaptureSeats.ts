/**
 * Work Verification includes 3 Field Capture accounts. Extra seats are $100/mo.
 *
 * A Field Capture seat is an org member (or a pending invite that will become
 * one) who uses Field Capture — crew logins and Employee / field-technician
 * roles. Global Admins do not consume a seat unless they have a Field Capture
 * inbox. Job-scoped invited workers are not org seats.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { paymentRequired } from './errors.js';
import { toOrgProductRole } from './productRoles.js';
import {
  INCLUDED_FC_SEATS,
  allowedFcSeats,
  extraSeatsNeeded,
} from './stripeCatalog.js';

export { INCLUDED_FC_SEATS, allowedFcSeats, extraSeatsNeeded };

export function isFieldCaptureSeatRole(role: string | null | undefined): boolean {
  if (toOrgProductRole(role) === 'employee') return true;
  return role === 'field_technician';
}

function hasFieldCaptureInbox(email: string | null | undefined): boolean {
  return Boolean(email?.toLowerCase().endsWith('@field.atmosphere.app'));
}

export function isFieldCaptureSeat(input: {
  role?: string | null;
  email?: string | null;
  usageIntents?: readonly string[] | null;
}): boolean {
  if (hasFieldCaptureInbox(input.email)) return true;
  if (isFieldCaptureSeatRole(input.role)) return true;
  return Boolean(input.usageIntents?.includes('field_work'));
}

export function fcSeatLimitError(allowed: number, used: number) {
  const extraNeeded = extraSeatsNeeded(used + 1, Math.max(0, allowed - INCLUDED_FC_SEATS));
  const extraLabel = extraNeeded === 1 ? '1 extra Field Capture seat' : `${Math.max(1, extraNeeded)} extra Field Capture seats`;
  return paymentRequired(
    `This plan includes ${INCLUDED_FC_SEATS} Field Capture accounts (${used} in use). Add ${extraLabel} at $100/mo to continue.`,
    'fc_seat_limit',
  );
}

export interface FieldCaptureSeatUsage {
  included: number;
  extra: number;
  allowed: number;
  used: number;
  remaining: number;
}

export function isWorkVerificationEntitled(status: string | null | undefined): boolean {
  if (!status) return true;
  return status === 'active' || status === 'trialing' || status === 'past_due';
}

/** Extra seats and the 3 included seats only apply while Work Verification is live. */
export function entitledFcSeatCounts(
  storedExtra: number,
  status: string | null | undefined,
): { extra: number; included: number } {
  if (!isWorkVerificationEntitled(status)) {
    return { extra: 0, included: 0 };
  }
  const extra = Number.isFinite(storedExtra) ? Math.max(0, Math.floor(storedExtra)) : 0;
  return { extra, included: INCLUDED_FC_SEATS };
}

export function summarizeFcSeats(used: number, extra: number, included: number = INCLUDED_FC_SEATS): FieldCaptureSeatUsage {
  const allowed = allowedFcSeats(extra, included);
  const taken = Math.max(0, Math.floor(used));
  return {
    included,
    extra: Math.max(0, Math.floor(extra)),
    allowed,
    used: taken,
    remaining: Math.max(0, allowed - taken),
  };
}

function profileEmail(row: { profiles?: { email?: string | null } | Array<{ email?: string | null }> | null }): string | null {
  const profiles = row.profiles;
  const profile = Array.isArray(profiles) ? profiles[0] : profiles;
  return (profile?.email as string | undefined) ?? null;
}

export async function countFieldCaptureSeats(
  supabase: SupabaseClient,
  orgId: string,
): Promise<number> {
  const [{ data: members }, { data: invites }] = await Promise.all([
    supabase
      .from('org_members')
      .select('user_id, role, usage_intents, profiles(email)')
      .eq('org_id', orgId),
    supabase
      .from('org_invites')
      .select('email, role, status')
      .eq('org_id', orgId)
      .eq('status', 'pending'),
  ]);

  const memberRows = (members ?? []) as Array<{
    role?: string;
    usage_intents?: string[] | null;
    profiles?: { email?: string | null } | Array<{ email?: string | null }> | null;
  }>;
  const memberEmails = new Set(
    memberRows.map((row) => profileEmail(row)?.trim().toLowerCase()).filter(Boolean) as string[],
  );

  let used = 0;
  for (const row of memberRows) {
    if (isFieldCaptureSeat({ role: row.role, email: profileEmail(row), usageIntents: row.usage_intents })) {
      used += 1;
    }
  }

  for (const invite of (invites ?? []) as Array<{ email?: string; role?: string }>) {
    const email = invite.email?.trim().toLowerCase() ?? '';
    if (email && memberEmails.has(email)) continue;
    if (isFieldCaptureSeat({ role: invite.role, email })) used += 1;
  }

  return used;
}

export async function readOrgBillingSeatState(
  supabase: SupabaseClient,
  orgId: string,
): Promise<{ extra: number; status: string | null }> {
  const { data, error } = await supabase
    .from('org_billing')
    .select('extra_fc_seats, status')
    .eq('org_id', orgId)
    .maybeSingle();
  if (error && /extra_fc_seats|column .* does not exist/i.test(error.message)) {
    const { data: billing } = await supabase
      .from('org_billing')
      .select('status')
      .eq('org_id', orgId)
      .maybeSingle();
    return { extra: 0, status: (billing?.status as string | undefined) ?? null };
  }
  if (error) throw error;
  const raw = (data as { extra_fc_seats?: number | null; status?: string | null } | null)?.extra_fc_seats;
  return {
    extra: Number.isFinite(raw) ? Math.max(0, Math.floor(Number(raw))) : 0,
    status: (data as { status?: string | null } | null)?.status ?? null,
  };
}

export async function readExtraFcSeats(supabase: SupabaseClient, orgId: string): Promise<number> {
  const { extra } = await readOrgBillingSeatState(supabase, orgId);
  return extra;
}

export async function loadFieldCaptureSeatUsage(
  supabase: SupabaseClient,
  orgId: string,
): Promise<FieldCaptureSeatUsage> {
  const [used, billing] = await Promise.all([
    countFieldCaptureSeats(supabase, orgId),
    readOrgBillingSeatState(supabase, orgId),
  ]);
  const entitled = entitledFcSeatCounts(billing.extra, billing.status);
  return summarizeFcSeats(used, entitled.extra, entitled.included);
}

/** Throws `fc_seat_limit` when adding one more Field Capture account would exceed the allowance. */
export async function assertFieldCaptureSeatAvailable(
  supabase: SupabaseClient,
  orgId: string,
): Promise<FieldCaptureSeatUsage> {
  const seats = await loadFieldCaptureSeatUsage(supabase, orgId);
  if (seats.remaining <= 0) {
    throw fcSeatLimitError(seats.allowed, seats.used);
  }
  return seats;
}

export async function persistExtraFcSeats(
  admin: SupabaseClient,
  orgId: string,
  extraSeats: number,
): Promise<void> {
  const extra = Math.max(0, Math.floor(extraSeats));
  const { data, error } = await admin
    .from('org_billing')
    .update({ extra_fc_seats: extra })
    .eq('org_id', orgId)
    .select('org_id');
  if (error && /extra_fc_seats|column .* does not exist/i.test(error.message)) {
    console.warn('[billing] extra_fc_seats column is missing — apply the Field Capture seats migration');
    return;
  }
  if (error) throw new Error(`extra Field Capture seat sync failed: ${error.message}`);
  if (!data?.length) {
    throw new Error('extra Field Capture seat sync failed: org_billing row was not updated');
  }
}
