import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config.js';

/**
 * Factory helpers for Supabase clients used on the server.
 *
 * We deliberately create fresh, stateless clients per request context:
 * `persistSession` and `autoRefreshToken` are disabled because there is no
 * browser storage on the server and each HTTP request must be isolated (no
 * shared auth state leaking between users).
 */

const baseAuthOptions = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
} as const;

/**
 * A client bound to the public anon key. Suitable for signUp / signInWithPassword
 * / getUser / refreshSession — everything the login page needs.
 */
export function createAnonClient(): SupabaseClient {
  return createClient(config.supabase.url, config.supabase.anonKey, baseAuthOptions);
}

/**
 * A client that acts on behalf of a specific user by attaching their access
 * token to every request. Use for reads/writes that must respect RLS as the user.
 */
export function createUserClient(accessToken: string): SupabaseClient {
  return createClient(config.supabase.url, config.supabase.anonKey, {
    ...baseAuthOptions,
    global: {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  });
}

/**
 * A privileged client using the service role key. Bypasses RLS — server only.
 * Returns null when no service role key is configured (it is optional).
 */
export function createAdminClient(): SupabaseClient | null {
  if (!config.supabase.serviceRoleKey) return null;
  return createClient(config.supabase.url, config.supabase.serviceRoleKey, baseAuthOptions);
}
