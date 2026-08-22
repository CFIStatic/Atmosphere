import { Router, type Request, type Response, type NextFunction } from 'express';
import { createAdminClient, createUserClient } from '../lib/supabase.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { updateProfileSchema, uploadAvatarSchema } from '../lib/validation.js';
import { HttpError } from '../lib/errors.js';
import {
  AVATAR_BUCKET,
  AVATAR_MAX_BYTES,
  AVATAR_MAX_DATA_URL_BYTES,
  avatarPathFromUrl,
  avatarStoragePath,
  dataUrlFor,
  isDisplayableAvatarUrl,
  isStoredAvatarObject,
  sniffAvatarMediaType,
} from '../lib/avatar.js';

export const profileRouter = Router();

// Everything here acts on the caller's own profile row.
profileRouter.use(requireAuth);

/* eslint-disable @typescript-eslint/no-explicit-any */

const PROFILE_SELECT = 'id, email, full_name, avatar_url, created_at, updated_at';
const PROFILE_SELECT_LEGACY = 'id, email, full_name, created_at, updated_at';

function isMissingAvatarColumn(message: string | undefined): boolean {
  return /avatar_url|column .* does not exist/i.test(message ?? '');
}

function serializeProfile(row: any, fallbackEmail: string | null) {
  const avatarUrl = isDisplayableAvatarUrl(row?.avatar_url) ? row.avatar_url : null;
  return {
    id: row?.id ?? null,
    email: row?.email ?? fallbackEmail,
    fullName: row?.full_name ?? null,
    avatarUrl,
    createdAt: row?.created_at ?? null,
    updatedAt: row?.updated_at ?? null,
  };
}

async function readOwnProfile(supabase: ReturnType<typeof createUserClient>, userId: string) {
  const withAvatar = await supabase.from('profiles').select(PROFILE_SELECT).eq('id', userId).maybeSingle();
  if (withAvatar.error && isMissingAvatarColumn(withAvatar.error.message)) {
    return supabase.from('profiles').select(PROFILE_SELECT_LEGACY).eq('id', userId).maybeSingle();
  }
  return withAvatar;
}

async function upsertOwnProfile(
  supabase: ReturnType<typeof createUserClient>,
  values: Record<string, unknown>,
) {
  const withAvatar = await supabase
    .from('profiles')
    .upsert(values, { onConflict: 'id' })
    .select(PROFILE_SELECT)
    .maybeSingle();
  if (withAvatar.error && isMissingAvatarColumn(withAvatar.error.message) && 'avatar_url' in values) {
    throw new HttpError(
      503,
      'Profile photos are not available on this deployment yet.',
      'avatar_unavailable',
    );
  }
  if (withAvatar.error && isMissingAvatarColumn(withAvatar.error.message)) {
    return supabase
      .from('profiles')
      .upsert(values, { onConflict: 'id' })
      .select(PROFILE_SELECT_LEGACY)
      .maybeSingle();
  }
  return withAvatar;
}

async function removeStoredAvatar(userId: string, currentUrl: string | null) {
  if (!currentUrl || !isStoredAvatarObject(currentUrl)) return;
  const admin = createAdminClient();
  if (!admin) return;
  const path = avatarPathFromUrl(currentUrl, userId);
  if (!path) return;
  await admin.storage.from(AVATAR_BUCKET).remove([path]);
}

/**
 * GET /api/profile
 * The caller's profile row, creating it on the fly if onboarding never did.
 * RLS restricts the select to `id = auth.uid()`, so no filter here can widen it.
 */
profileRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const supabase = createUserClient(req.accessToken!);
    const { data, error } = await readOwnProfile(supabase, req.user!.id);
    if (error) throw new HttpError(500, error.message, 'profile_read_failed');

    if (!data) {
      const created = await upsertOwnProfile(supabase, { id: req.user!.id, email: req.user!.email });
      if (created.error) throw new HttpError(500, created.error.message, 'profile_read_failed');
      res.json({ profile: serializeProfile(created.data, req.user!.email ?? null) });
      return;
    }

    res.json({ profile: serializeProfile(data, req.user!.email ?? null) });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/profile
 * Updates the caller's display name — the name teammates see in the members
 * directory. `profiles` is the single source of truth for it; the row is
 * upserted rather than updated so a user who never got one can still save.
 */
profileRouter.patch('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { fullName } = updateProfileSchema.parse(req.body);
    const supabase = createUserClient(req.accessToken!);

    const { data, error } = await upsertOwnProfile(supabase, {
      id: req.user!.id,
      email: req.user!.email,
      full_name: fullName,
      updated_at: new Date().toISOString(),
    });
    if (error) throw new HttpError(500, error.message, 'profile_update_failed');

    res.json({ profile: serializeProfile(data, req.user!.email ?? null) });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/profile/avatar
 * Replaces the caller's profile photo with a picture or icon they picked.
 */
profileRouter.post('/avatar', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = uploadAvatarSchema.parse(req.body);
    const bytes = Buffer.from(body.contentBase64, 'base64');
    if (!bytes.length) throw new HttpError(400, 'That image is empty.', 'empty_avatar');
    if (bytes.length > AVATAR_MAX_BYTES) {
      throw new HttpError(413, 'Profile photos are capped at 2 MB.', 'avatar_too_large');
    }

    const sniffed = sniffAvatarMediaType(bytes);
    if (!sniffed) {
      throw new HttpError(400, 'Use a JPEG, PNG, WebP, GIF, or ICO image.', 'avatar_not_image');
    }

    const userId = req.user!.id;
    const supabase = createUserClient(req.accessToken!);
    const current = await readOwnProfile(supabase, userId);
    const previousUrl = (current.data as { avatar_url?: string | null } | null)?.avatar_url ?? null;

    let avatarUrl: string | null = null;
    const admin = createAdminClient();
    if (admin) {
      const path = avatarStoragePath(userId, sniffed);
      const { error: storeError } = await admin.storage.from(AVATAR_BUCKET).upload(path, bytes, {
        contentType: sniffed,
        upsert: true,
      });
      if (!storeError) {
        const { data: published } = admin.storage.from(AVATAR_BUCKET).getPublicUrl(path);
        avatarUrl = published?.publicUrl ? `${published.publicUrl}?v=${Date.now()}` : null;
        const previousPath = previousUrl ? avatarPathFromUrl(previousUrl, userId) : null;
        if (previousPath && previousPath !== path) {
          await admin.storage.from(AVATAR_BUCKET).remove([previousPath]);
        }
      }
    }

    if (!avatarUrl) {
      if (bytes.length > AVATAR_MAX_DATA_URL_BYTES) {
        throw new HttpError(
          413,
          'That picture is too large to store without object storage. Try a smaller image.',
          'avatar_too_large',
        );
      }
      avatarUrl = dataUrlFor(bytes, sniffed);
    }

    const { data, error } = await upsertOwnProfile(supabase, {
      id: userId,
      email: req.user!.email,
      avatar_url: avatarUrl,
      updated_at: new Date().toISOString(),
    });
    if (error) throw new HttpError(500, error.message, 'avatar_update_failed');

    res.json({ profile: serializeProfile(data, req.user!.email ?? null) });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/profile/avatar
 * Clears the photo so teammates see the initials bubble again.
 */
profileRouter.delete('/avatar', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const supabase = createUserClient(req.accessToken!);
    const current = await readOwnProfile(supabase, userId);
    const previousUrl = (current.data as { avatar_url?: string | null } | null)?.avatar_url ?? null;
    await removeStoredAvatar(userId, previousUrl);

    const { data, error } = await upsertOwnProfile(supabase, {
      id: userId,
      email: req.user!.email,
      avatar_url: null,
      updated_at: new Date().toISOString(),
    });
    if (error) throw new HttpError(500, error.message, 'avatar_update_failed');

    res.json({ profile: serializeProfile(data, req.user!.email ?? null) });
  } catch (err) {
    next(err);
  }
});
