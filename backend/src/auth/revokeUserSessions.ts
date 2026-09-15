/**
 * Revoke Supabase Auth sessions for a user (refresh tokens + session rows).
 *
 * Used when a Global Admin removes someone from an org so a terminated
 * employee cannot keep using an existing JWT refresh until it ages out.
 *
 * Supabase Auth Admin `signOut` requires a valid JWT (not a user id). We mint
 * a one-time magic link, redeem it for a short-lived session, then call
 * admin.signOut(accessToken, 'global') which clears *all* sessions for that
 * user — including the temporary one.
 *
 * Best-effort: callers should not fail the org unlink if Auth revoke fails.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { createAnonClient } from '../lib/supabase.js';
import { logger } from '../lib/logger.js';

export type RevokeSessionsResult =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Pure helper for tests: decide whether a generateLink + verifyOtp + signOut
 * sequence succeeded.
 */
export function interpretRevokeOutcome(input: {
  hasUser: boolean;
  hasEmail: boolean;
  hashedToken: string | null | undefined;
  accessToken: string | null | undefined;
  signOutError: string | null | undefined;
}): RevokeSessionsResult {
  if (!input.hasUser) return { ok: false, reason: 'user_not_found' };
  if (!input.hasEmail) return { ok: false, reason: 'user_has_no_email' };
  if (!input.hashedToken) return { ok: false, reason: 'mint_failed' };
  if (!input.accessToken) return { ok: false, reason: 'redeem_failed' };
  if (input.signOutError) return { ok: false, reason: input.signOutError };
  return { ok: true };
}

export async function revokeAllAuthSessionsForUser(
  admin: SupabaseClient,
  userId: string,
): Promise<RevokeSessionsResult> {
  const id = String(userId ?? '').trim();
  if (!id) return { ok: false, reason: 'missing_user_id' };

  try {
    const { data: got, error: getError } = await admin.auth.admin.getUserById(id);
    if (getError || !got?.user) {
      return interpretRevokeOutcome({
        hasUser: false,
        hasEmail: false,
        hashedToken: null,
        accessToken: null,
        signOutError: getError?.message,
      });
    }
    const email = got.user.email?.trim().toLowerCase() ?? '';
    if (!email) {
      return interpretRevokeOutcome({
        hasUser: true,
        hasEmail: false,
        hashedToken: null,
        accessToken: null,
        signOutError: null,
      });
    }

    const { data: link, error: linkError } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email,
    });
    const hashedToken = link?.properties?.hashed_token ?? null;
    if (linkError || !hashedToken) {
      return interpretRevokeOutcome({
        hasUser: true,
        hasEmail: true,
        hashedToken: null,
        accessToken: null,
        signOutError: linkError?.message ?? 'mint_failed',
      });
    }

    const anon = createAnonClient();
    const { data: redeemed, error: redeemError } = await anon.auth.verifyOtp({
      type: 'magiclink',
      token_hash: hashedToken,
    });
    const accessToken = redeemed?.session?.access_token ?? null;
    if (redeemError || !accessToken) {
      return interpretRevokeOutcome({
        hasUser: true,
        hasEmail: true,
        hashedToken,
        accessToken: null,
        signOutError: redeemError?.message ?? 'redeem_failed',
      });
    }

    const { error: signOutError } = await admin.auth.admin.signOut(accessToken, 'global');
    return interpretRevokeOutcome({
      hasUser: true,
      hasEmail: true,
      hashedToken,
      accessToken,
      signOutError: signOutError?.message ?? null,
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'revoke_threw';
    logger.warn('auth_session_revoke_failed', { userId: id, detail: reason });
    return { ok: false, reason };
  }
}
