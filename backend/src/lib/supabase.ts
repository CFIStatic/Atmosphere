import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
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
 * supabase-js always constructs a Realtime client. On Node 20 there is no
 * global WebSocket, so createClient throws unless we pass `ws`. Server and CLI
 * code never subscribe to channels — this only satisfies the constructor.
 */
const baseClientOptions = {
  ...baseAuthOptions,
  realtime: {
    // ws satisfies the Realtime constructor on Node 20 (no native WebSocket).
    transport: WebSocket as any,
  },
};

/**
 * A client bound to the public anon key. Suitable for signUp / signInWithPassword
 * / getUser / refreshSession — everything the login page needs.
 */
export function createAnonClient(): SupabaseClient {
  return createClient(config.supabase.url, config.supabase.anonKey, baseClientOptions);
}

/**
 * A client that acts on behalf of a specific user by attaching their access
 * token to every request. Use for reads/writes that must respect RLS as the user.
 */
export function createUserClient(accessToken: string): SupabaseClient {
  return createClient(config.supabase.url, config.supabase.anonKey, {
    ...baseClientOptions,
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
  return createClient(config.supabase.url, config.supabase.serviceRoleKey, baseClientOptions);
}

/**
 * Header read by private.analytics_actor() for service-role report RPCs.
 * Set it only from the authenticated session user id, never from a request body.
 */
export const ANALYTICS_ACTOR_HEADER = 'x-analytics-user-id';

/**
 * Service-role client for Internal report RPCs.
 *
 * Those functions are not granted to authenticated. The database resolves the
 * staff user from ANALYTICS_ACTOR_HEADER and still requires an analytics_staff
 * row. Returns null when the service role key is unset.
 */
export function createStaffReportClient(userId: string): SupabaseClient | null {
  if (!config.supabase.serviceRoleKey) return null;
  return createClient(config.supabase.url, config.supabase.serviceRoleKey, {
    ...baseClientOptions,
    global: {
      headers: { [ANALYTICS_ACTOR_HEADER]: userId },
    },
  });
}
