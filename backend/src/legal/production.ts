/**
 * Legal production — the package counsel asked for.
 *
 * A hold plus the vault plus the activity trail. User-deleted videos are
 * included on purpose: that is the whole point of the vault.
 */
import { config } from '../config.js';
import { HttpError } from '../lib/errors.js';
import { mediaDriverFor } from '../media/driver.js';
import { getLegalHold, videosForHold } from './holds.js';
import { activityForSubjects, listUserActivity } from './monitor.js';
import { createProductionRecord, persistProduction } from './store.js';
import type { LegalProduction, LegalVaultEntry, UserActivityEvent } from './types.js';

export type ProducedVideo = LegalVaultEntry & {
  userDeleted: boolean;
  downloadUrl: string | null;
};

export type LegalProductionPackage = {
  production: LegalProduction;
  hold: Awaited<ReturnType<typeof getLegalHold>>;
  videos: ProducedVideo[];
  activity: UserActivityEvent[];
};

export async function produceHold(input: {
  holdId: string;
  requestedBy?: string | null;
  note?: string | null;
  urlTtlSeconds?: number;
}): Promise<LegalProductionPackage> {
  const hold = await getLegalHold(input.holdId);
  if (hold.status !== 'open') {
    throw new HttpError(409, 'Produce from an open hold. Released holds stay on file.', 'hold_not_open');
  }

  const videos = await videosForHold(hold);
  const activity = activityForSubjects(await listUserActivity({ limit: 1000 }), hold.subjects);
  const ttl = input.urlTtlSeconds ?? 60 * 60;

  const produced: ProducedVideo[] = [];
  for (const video of videos) {
    produced.push({
      ...video,
      userDeleted: Boolean(video.userDeletedAt),
      downloadUrl: await signedVaultUrl(video, ttl),
    });
  }

  const production = createProductionRecord({
    holdId: hold.id,
    requestedBy: input.requestedBy ?? null,
    itemCount: produced.length,
    activityCount: activity.length,
    note: input.note ?? null,
  });
  await persistProduction(production);

  return { production, hold, videos: produced, activity };
}

export async function signedVaultUrl(video: LegalVaultEntry, ttlSeconds: number): Promise<string | null> {
  try {
    const backend =
      video.storageBackend === 's3' || video.storageBackend === 'memory' || video.storageBackend === 'supabase'
        ? video.storageBackend
        : config.media.backend;
    return await mediaDriverFor(backend).createSignedReadUrl(video.storageKey, ttlSeconds);
  } catch {
    return null;
  }
}
