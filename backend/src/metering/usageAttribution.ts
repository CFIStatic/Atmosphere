/**
 * Who caused a metered AI call.
 *
 * Background video analysis runs as the service role, so `auth.uid()` is null
 * and the token ledger would otherwise dump every frame into Unattributed /
 * System. Resolve the seat we can actually name: the signed-in actor, the
 * uploader, the org member who invited the capture party, then the job owner.
 */

export type UsageActorHints = {
  orgId: string;
  userId?: string | null;
  uploaderId?: string | null;
  videoId?: string | null;
  jobId?: string | null;
  partyId?: string | null;
};

export function firstNonEmptyId(...ids: Array<string | null | undefined>): string | null {
  for (const id of ids) {
    if (typeof id === 'string' && id.trim()) return id.trim();
  }
  return null;
}

export function pickUsageActor(hints: {
  userId?: string | null;
  uploaderId?: string | null;
  partyCreatedBy?: string | null;
  jobOwnerId?: string | null;
  jobCreatedBy?: string | null;
}): string | null {
  return firstNonEmptyId(
    hints.userId,
    hints.uploaderId,
    hints.partyCreatedBy,
    hints.jobOwnerId,
    hints.jobCreatedBy,
  );
}

async function maybeRow(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  table: string,
  columns: string,
  filters: Record<string, string>,
): Promise<Record<string, unknown> | null> {
  try {
    let query = client.from(table).select(columns);
    for (const [column, value] of Object.entries(filters)) {
      if (!value) return null;
      query = query.eq(column, value);
    }
    const { data, error } = await query.maybeSingle();
    if (error || !data) return null;
    return data as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Best-effort seat for a video / job / party. Never throws — a lookup miss
 * must not fail analysis or proof filing.
 */
export async function resolveUsageActor(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  hints: UsageActorHints,
): Promise<string | null> {
  try {
    const immediate = pickUsageActor({
      userId: hints.userId,
      uploaderId: hints.uploaderId,
    });
    if (immediate) return immediate;

    let uploaderId = hints.uploaderId ?? null;
    let partyId = hints.partyId ?? null;
    let jobId = hints.jobId ?? null;

    if (hints.videoId && !uploaderId) {
      const video = await maybeRow(client, 'verification_videos', 'uploader_id, party_id, job_id', {
        id: hints.videoId,
        org_id: hints.orgId,
      });
      uploaderId = typeof video?.uploader_id === 'string' ? video.uploader_id : null;
      if (!partyId && typeof video?.party_id === 'string') partyId = video.party_id;
      if (!jobId && typeof video?.job_id === 'string') jobId = video.job_id;
      const fromVideo = pickUsageActor({ uploaderId });
      if (fromVideo) return fromVideo;
    }

    let partyCreatedBy: string | null = null;
    if (partyId) {
      const party = await maybeRow(client, 'job_parties', 'created_by', {
        id: partyId,
        org_id: hints.orgId,
      });
      partyCreatedBy = typeof party?.created_by === 'string' ? party.created_by : null;
      const fromParty = pickUsageActor({ partyCreatedBy });
      if (fromParty) return fromParty;
    }

    if (!jobId) return null;
    const job = await maybeRow(client, 'crm_jobs', 'owner_id, created_by', {
      id: jobId,
      org_id: hints.orgId,
    });
    return pickUsageActor({
      jobOwnerId: typeof job?.owner_id === 'string' ? job.owner_id : null,
      jobCreatedBy: typeof job?.created_by === 'string' ? job.created_by : null,
    });
  } catch {
    return null;
  }
}
