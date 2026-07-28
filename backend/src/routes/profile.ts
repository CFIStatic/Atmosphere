import { Router, type Request, type Response, type NextFunction } from 'express';
import { createUserClient } from '../lib/supabase.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { updateProfileSchema } from '../lib/validation.js';
import { HttpError } from '../lib/errors.js';

export const profileRouter = Router();

// Everything here acts on the caller's own profile row.
profileRouter.use(requireAuth);

/* eslint-disable @typescript-eslint/no-explicit-any */

function serializeProfile(row: any, fallbackEmail: string | null) {
  return {
    id: row?.id ?? null,
    email: row?.email ?? fallbackEmail,
    fullName: row?.full_name ?? null,
    createdAt: row?.created_at ?? null,
    updatedAt: row?.updated_at ?? null,
  };
}

/**
 * GET /api/profile
 * The caller's profile row, creating it on the fly if onboarding never did.
 * RLS restricts the select to `id = auth.uid()`, so no filter here can widen it.
 */
profileRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const supabase = createUserClient(req.accessToken!);
    const { data, error } = await supabase
      .from('profiles')
      .select('id, email, full_name, created_at, updated_at')
      .eq('id', req.user!.id)
      .maybeSingle();
    if (error) throw new HttpError(500, error.message, 'profile_read_failed');

    if (!data) {
      const { data: created, error: createError } = await supabase
        .from('profiles')
        .upsert({ id: req.user!.id, email: req.user!.email }, { onConflict: 'id' })
        .select('id, email, full_name, created_at, updated_at')
        .maybeSingle();
      if (createError) throw new HttpError(500, createError.message, 'profile_read_failed');
      res.json({ profile: serializeProfile(created, req.user!.email ?? null) });
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

    const { data, error } = await supabase
      .from('profiles')
      .upsert(
        {
          id: req.user!.id,
          email: req.user!.email,
          full_name: fullName,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'id' },
      )
      .select('id, email, full_name, created_at, updated_at')
      .maybeSingle();
    if (error) throw new HttpError(500, error.message, 'profile_update_failed');

    res.json({ profile: serializeProfile(data, req.user!.email ?? null) });
  } catch (err) {
    next(err);
  }
});
