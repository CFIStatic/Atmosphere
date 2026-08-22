/**
 * Privileged Supabase client — same project proofs already use.
 * Media catalog + property twins go through this, not a parallel store.
 */
import { createAdminClient } from './supabase.js';
import { HttpError } from './errors.js';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Returns the service-role client or null when unset.
 * Prefer `requireAdmin()` on request paths that must hit Postgres/storage.
 */
export function adminOrNull(): SupabaseClient | null {
  return createAdminClient();
}

export function requireAdmin(): SupabaseClient {
  const admin = createAdminClient();
  if (!admin) {
    throw new HttpError(
      503,
      'Supabase is not configured on this server (SUPABASE_SERVICE_ROLE_KEY).',
      'supabase_unconfigured',
    );
  }
  return admin;
}

/** Unit tests / offline smoke: skip Postgres for the media catalog. */
export function useMemoryMediaStore(): boolean {
  return process.env.MEDIA_STORE === 'memory';
}

/** Unit tests / offline smoke: skip Postgres for property twins. */
export function useMemoryGeometryStore(): boolean {
  return process.env.GEOMETRY_STORE === 'memory';
}

/** Unit tests / offline smoke: skip Postgres for legal hold + activity. */
export function useMemoryLegalStore(): boolean {
  return process.env.LEGAL_STORE === 'memory';
}
