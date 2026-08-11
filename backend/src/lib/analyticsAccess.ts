/**
 * Auto-provision analytics_staff for allowlisted Atmosphere emails.
 *
 * Preview / day-to-day: Jack (and any ANALYTICS_INTERNAL_EMAILS) sign in and
 * immediately see /analytics — no SQL grant step. The database allow-list is
 * still the source of truth for reporting RPCs; we just write the row via the
 * service role when a matching user hits the access probe.
 */

import type { User } from '@supabase/supabase-js';
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

/**
 * If the signed-in user is on the Atmosphere staff allow-list, upsert their
 * analytics_staff row. No-op when service role is unset or the email is not
 * allowlisted. Safe to call on every /access probe.
 */
export async function ensureAllowlistedAnalyticsAccess(user: User | undefined): Promise<void> {
  if (!user?.id) return;
  const scope = allowlistedAnalyticsScope(user.email);
  if (!scope) return;

  const admin = createAdminClient();
  if (!admin) {
    logger.warn('analytics_auto_grant_skipped', {
      reason: 'missing_service_role',
      email: user.email,
    });
    return;
  }

  const { error } = await admin.from('analytics_staff').upsert(
    {
      user_id: user.id,
      scope,
      display_name: user.email ?? null,
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

  logger.info('analytics_auto_grant', { email: user.email, scope });
}
