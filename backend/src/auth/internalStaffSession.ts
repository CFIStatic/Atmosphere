import type { Session, User } from '@supabase/supabase-js';
import { createAdminClient, createAnonClient } from '../lib/supabase.js';
import { HttpError, serviceUnavailable } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

async function mintSession(email: string): Promise<{ user: User; session: Session }> {
  const admin = createAdminClient();
  if (!admin) {
    throw serviceUnavailable('Staff sign-in is not configured on this server.', 'internal_login_unavailable');
  }

  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
  });
  const hashedToken = link?.properties?.hashed_token;
  if (linkError || !hashedToken) {
    throw new HttpError(503, 'Could not complete staff sign-in. Please try again.', 'internal_login_failed');
  }

  const { data: redeemed, error: redeemError } = await createAnonClient().auth.verifyOtp({
    type: 'magiclink',
    token_hash: hashedToken,
  });
  if (redeemError || !redeemed.session || !redeemed.user) {
    throw new HttpError(503, 'Could not complete staff sign-in. Please try again.', 'internal_login_failed');
  }
  return { user: redeemed.user, session: redeemed.session };
}

/**
 * Find or create the allowlisted staff Auth user, stamp their name, and mint
 * a session without a password. Does not rotate passwords of existing users.
 */
export async function openInternalStaffSession(input: {
  email: string;
  firstName: string;
  lastName: string;
  fullName: string;
}): Promise<{ user: User; session: Session }> {
  const admin = createAdminClient();
  if (!admin) {
    throw serviceUnavailable('Staff sign-in is not configured on this server.', 'internal_login_unavailable');
  }

  const metadata = {
    first_name: input.firstName,
    last_name: input.lastName,
    full_name: input.fullName,
  };

  const generated = await admin.auth.admin.generateLink({ type: 'magiclink', email: input.email });
  let user = generated.data?.user ?? null;

  if (!user?.id) {
    const created = await admin.auth.admin.createUser({
      email: input.email,
      email_confirm: true,
      user_metadata: metadata,
    });
    if (created.error || !created.data.user) {
      logger.warn('internal_staff_create_failed', {
        email: input.email,
        detail: created.error?.message,
      });
      throw new HttpError(503, 'Could not complete staff sign-in. Please try again.', 'internal_login_failed');
    }
    user = created.data.user;
  } else {
    await admin.auth.admin.updateUserById(user.id, {
      email_confirm: true,
      user_metadata: { ...(user.user_metadata ?? {}), ...metadata },
    });
  }

  const { error: profileError } = await admin.from('profiles').upsert(
    { id: user.id, email: input.email, full_name: input.fullName },
    { onConflict: 'id' },
  );
  if (profileError) {
    logger.warn('internal_staff_profile_upsert_failed', {
      email: input.email,
      detail: profileError.message,
    });
  }

  return mintSession(input.email);
}
