/**
 * Auto-provision platform_staff for allowlisted Atmosphere emails.
 *
 * Same model as analyticsAccess: preview / day-to-day staff sign in and get
 * /admin without a SQL grant step. The database allow-list remains the source
 * of truth; we just upsert the row via the service role on the access probe.
 */

import type { User } from '@supabase/supabase-js';
import { config } from '../config.js';
import { createAdminClient } from './supabase.js';
import { logger } from './logger.js';
import type { PlatformStaffScope } from './platformAdmin.js';

function normalizeEmail(email: string | undefined | null): string | null {
  if (!email) return null;
  const trimmed = email.trim().toLowerCase();
  return trimmed || null;
}

export function allowlistedPlatformScope(
  email: string | undefined | null,
): PlatformStaffScope | null {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  if (config.platformAdmin.opsEmails.includes(normalized)) return 'ops';
  if (config.platformAdmin.adminEmails.includes(normalized)) return 'admin';
  if (config.platformAdmin.supportEmails.includes(normalized)) return 'support';
  return null;
}

/**
 * If the signed-in user is on the Atmosphere staff allow-list, upsert their
 * platform_staff row. Safe to call on every /access probe.
 */
export async function ensureAllowlistedPlatformAccess(user: User | undefined): Promise<void> {
  if (!user?.id) return;
  const scope = allowlistedPlatformScope(user.email);
  if (!scope) return;

  const admin = createAdminClient();
  if (!admin) {
    logger.warn('platform_admin_auto_grant_skipped', {
      reason: 'missing_service_role',
      email: user.email,
    });
    return;
  }

  const { error } = await admin.from('platform_staff').upsert(
    {
      user_id: user.id,
      scope,
      display_name: user.email ?? null,
    },
    { onConflict: 'user_id' },
  );

  if (error) {
    logger.warn('platform_admin_auto_grant_failed', {
      email: user.email,
      detail: error.message,
    });
    return;
  }

  logger.info('platform_admin_auto_grant', { email: user.email, scope });
}
