/**
 * Auto-provision analytics_staff for allowlisted Atmosphere emails or
 * employees an internal admin has approved from the staff site.
 *
 * Internal Growth Metrics is invite-only: ANALYTICS_INTERNAL_EMAILS (default
 * jack@jettx.ai) and Access-page approvals gate Platform email/password login.
 * The database allow-list is still the source of truth for reporting RPCs; we
 * upsert the row via the service role when a matching user hits the access probe.
 */

import type { User } from '@supabase/supabase-js';
import { attachApprovedUser, isApprovedInternalEmail } from '../auth/internalAccessRequests.js';
import { config } from '../config.js';
import { createAdminClient } from './supabase.js';
import { logger } from './logger.js';
import type { AnalyticsScope } from './analytics.js';

function normalizeEmail(email: string | undefined | null): string | null {
  if (!email) return null;
  const trimmed = email.trim().toLowerCase();
  return trimmed || null;
}

export function allowlistedAnalyticsScope(email: string | undefined | null): AnalyticsScope | null {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  if (config.analytics.internalEmails.includes(normalized)) return 'internal';
  if (config.analytics.investorEmails.includes(normalized)) return 'investor';
  return null;
}

export async function resolvedAnalyticsScope(
  email: string | undefined | null,
): Promise<AnalyticsScope | null> {
  const allowlisted = allowlistedAnalyticsScope(email);
  if (allowlisted) return allowlisted;
  if (await isApprovedInternalEmail(email)) return 'internal';
  return null;
}

/**
 * If the signed-in user is on the Atmosphere staff allow-list or has an
 * approved access request, upsert their analytics_staff row. No-op when
 * service role is unset or the email is not granted. Safe to call on every
 * /access probe.
 */
export async function ensureAllowlistedAnalyticsAccess(
  user: User | undefined,
  displayName?: string | null,
): Promise<void> {
  if (!user?.id) return;
  const scope = await resolvedAnalyticsScope(user.email);
  if (!scope) return;

  const admin = createAdminClient();
  if (!admin) {
    logger.warn('analytics_auto_grant_skipped', {
      reason: 'missing_service_role',
      email: user.email,
    });
    return;
  }

  const fromMeta =
    typeof user.user_metadata?.full_name === 'string' ? user.user_metadata.full_name.trim() : '';
  const name = displayName?.trim() || fromMeta || user.email || null;

  const { error } = await admin.from('analytics_staff').upsert(
    {
      user_id: user.id,
      scope,
      display_name: name,
    },
    { onConflict: 'user_id' },
  );

  if (error) {
    logger.warn('analytics_auto_grant_failed', {
      email: user.email,
      detail: error.message,
    });
    return;
  }

  if (scope === 'internal' && !allowlistedAnalyticsScope(user.email)) {
    await attachApprovedUser(user);
  }

  logger.info('analytics_auto_grant', { email: user.email, scope });
}
