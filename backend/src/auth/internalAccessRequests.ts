/**
 * Queue of employees asking to join Internal Growth Metrics.
 *
 * The table is service-role only. The BFF records a request when someone who
 * is not allowlisted starts sign-in, and internal-scope admins approve from
 * the staff site.
 */

import type { User } from '@supabase/supabase-js';
import { createAdminClient } from '../lib/supabase.js';
import { logger } from '../lib/logger.js';

export type AccessRequestStatus = 'pending' | 'approved' | 'denied';

export interface AccessRequest {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  status: AccessRequestStatus;
  requestedAt: string;
  lastRequestedAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  userId: string | null;
}

interface AccessRequestRow {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  status: AccessRequestStatus;
  requested_at: string;
  last_requested_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
  user_id: string | null;
}

export function mapAccessRequest(row: AccessRequestRow): AccessRequest {
  return {
    id: row.id,
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    status: row.status,
    requestedAt: row.requested_at,
    lastRequestedAt: row.last_requested_at,
    reviewedAt: row.reviewed_at,
    reviewedBy: row.reviewed_by,
    userId: row.user_id,
  };
}

export function sortAccessRequests(rows: AccessRequest[]): AccessRequest[] {
  const rank: Record<AccessRequestStatus, number> = {
    pending: 0,
    approved: 1,
    denied: 2,
  };
  return [...rows].sort((a, b) => {
    const byStatus = rank[a.status] - rank[b.status];
    if (byStatus !== 0) return byStatus;
    return Date.parse(b.lastRequestedAt) - Date.parse(a.lastRequestedAt);
  });
}

function normalizeEmail(email: string | undefined | null): string | null {
  if (!email) return null;
  const trimmed = email.trim().toLowerCase();
  return trimmed || null;
}

function isMissingTable(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  return error.code === '42P01' || /internal_access_requests/i.test(error.message ?? '');
}

async function findAuthUserIdByEmail(email: string): Promise<string | null> {
  const admin = createAdminClient();
  if (!admin) return null;

  const { data: profile } = await admin
    .from('profiles')
    .select('id')
    .ilike('email', email)
    .maybeSingle();
  if (profile && typeof (profile as { id?: string }).id === 'string') {
    return (profile as { id: string }).id;
  }

  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) {
      logger.warn('internal_access_user_lookup_failed', { email, detail: error.message });
      return null;
    }
    const match = data.users.find((user) => user.email?.toLowerCase() === email);
    if (match) return match.id;
    if (data.users.length === 0) break;
  }
  return null;
}

async function grantInternalStaff(userId: string, email: string, displayName: string): Promise<void> {
  const admin = createAdminClient();
  if (!admin) return;

  const { error } = await admin.from('analytics_staff').upsert(
    {
      user_id: userId,
      scope: 'internal',
      display_name: displayName,
    },
    { onConflict: 'user_id' },
  );
  if (error) {
    logger.warn('internal_access_grant_failed', { email, detail: error.message });
  }
}

export async function isApprovedInternalEmail(email: string | undefined | null): Promise<boolean> {
  const normalized = normalizeEmail(email);
  const admin = createAdminClient();
  if (!normalized || !admin) return false;

  const { data, error } = await admin
    .from('internal_access_requests')
    .select('status')
    .eq('email', normalized)
    .maybeSingle();

  if (error) {
    if (!isMissingTable(error)) {
      logger.warn('internal_access_lookup_failed', { email: normalized, detail: error.message });
    }
    return false;
  }
  return (data as { status?: string } | null)?.status === 'approved';
}

export async function recordAccessRequest(input: {
  email: string;
  firstName: string;
  lastName: string;
}): Promise<'pending' | 'unavailable'> {
  const email = normalizeEmail(input.email);
  const admin = createAdminClient();
  if (!email || !admin) return 'unavailable';

  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  const now = new Date().toISOString();

  const { data: existing, error: readError } = await admin
    .from('internal_access_requests')
    .select('id, status')
    .eq('email', email)
    .maybeSingle();

  if (readError) {
    if (!isMissingTable(readError)) {
      logger.warn('internal_access_record_failed', { email, detail: readError.message });
    }
    return 'unavailable';
  }

  const row = existing as { id: string; status: AccessRequestStatus } | null;
  if (row?.status === 'approved') return 'pending';

  const payload = {
    email,
    first_name: firstName,
    last_name: lastName,
    status: 'pending' as const,
    last_requested_at: now,
    reviewed_at: null,
    reviewed_by: null,
  };

  const { error } = row
    ? await admin.from('internal_access_requests').update(payload).eq('id', row.id)
    : await admin.from('internal_access_requests').insert(payload);

  if (error) {
    logger.warn('internal_access_record_failed', { email, detail: error.message });
    return 'unavailable';
  }

  logger.info('internal_access_requested', { email });
  return 'pending';
}

export async function listAccessRequests(): Promise<AccessRequest[]> {
  const admin = createAdminClient();
  if (!admin) return [];

  const { data, error } = await admin
    .from('internal_access_requests')
    .select(
      'id, email, first_name, last_name, status, requested_at, last_requested_at, reviewed_at, reviewed_by, user_id',
    )
    .order('last_requested_at', { ascending: false })
    .limit(500);

  if (error) {
    if (!isMissingTable(error)) {
      logger.warn('internal_access_list_failed', { detail: error.message });
    }
    return [];
  }

  return sortAccessRequests((data as AccessRequestRow[] | null)?.map(mapAccessRequest) ?? []);
}

export async function countPendingAccessRequests(): Promise<number> {
  const admin = createAdminClient();
  if (!admin) return 0;

  const { count, error } = await admin
    .from('internal_access_requests')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending');

  if (error) {
    if (!isMissingTable(error)) {
      logger.warn('internal_access_count_failed', { detail: error.message });
    }
    return 0;
  }
  return count ?? 0;
}

async function markReviewed(
  ids: string[],
  status: 'approved' | 'denied',
  reviewerId: string,
): Promise<AccessRequest[]> {
  const admin = createAdminClient();
  if (!admin || ids.length === 0) return [];

  const { data, error } = await admin
    .from('internal_access_requests')
    .update({
      status,
      reviewed_at: new Date().toISOString(),
      reviewed_by: reviewerId,
    })
    .in('id', ids)
    .select(
      'id, email, first_name, last_name, status, requested_at, last_requested_at, reviewed_at, reviewed_by, user_id',
    );

  if (error) {
    logger.warn('internal_access_review_failed', { status, detail: error.message });
    return [];
  }

  const rows = ((data as AccessRequestRow[] | null) ?? []).map(mapAccessRequest);
  if (status === 'approved') {
    for (const row of rows) {
      const displayName = `${row.firstName} ${row.lastName}`.replace(/\s+/g, ' ').trim() || row.email;
      const userId = row.userId ?? (await findAuthUserIdByEmail(row.email));
      if (!userId) continue;
      await grantInternalStaff(userId, row.email, displayName);
      await admin.from('internal_access_requests').update({ user_id: userId }).eq('id', row.id);
      row.userId = userId;
    }
  }
  return rows;
}

export async function approveAccessRequests(input: {
  ids?: string[];
  allPending?: boolean;
  reviewerId: string;
}): Promise<AccessRequest[]> {
  const admin = createAdminClient();
  if (!admin) return [];

  let ids = input.ids ?? [];
  if (input.allPending) {
    const { data, error } = await admin
      .from('internal_access_requests')
      .select('id')
      .eq('status', 'pending');
    if (error) {
      logger.warn('internal_access_approve_all_failed', { detail: error.message });
      return [];
    }
    ids = ((data as Array<{ id: string }> | null) ?? []).map((row) => row.id);
  }

  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const rows = await markReviewed(unique, 'approved', input.reviewerId);
  logger.info('internal_access_approved', { count: rows.length, reviewerId: input.reviewerId });
  return rows;
}

export async function denyAccessRequest(id: string, reviewerId: string): Promise<AccessRequest | null> {
  const rows = await markReviewed([id], 'denied', reviewerId);
  return rows[0] ?? null;
}

export async function attachApprovedUser(user: User | undefined): Promise<void> {
  const email = normalizeEmail(user?.email);
  if (!user?.id || !email) return;
  const admin = createAdminClient();
  if (!admin) return;

  const { error } = await admin
    .from('internal_access_requests')
    .update({ user_id: user.id })
    .eq('email', email)
    .eq('status', 'approved');

  if (error && !isMissingTable(error)) {
    logger.warn('internal_access_attach_failed', { email, detail: error.message });
  }
}
