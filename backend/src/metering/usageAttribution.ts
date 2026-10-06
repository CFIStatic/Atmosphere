/**
 * Who caused a metered AI call.
 *
 * Background video analysis runs as the service role, so `auth.uid()` is null
 * and the token ledger would otherwise dump every frame into Unattributed /
 * System. Resolve the seat we can actually name: the signed-in actor, the
 * uploader, the org member who invited the capture party, then the job owner,
 * then the org admin who triggered the run (a re-analyse button press).
 *
 * The same chain runs in three places and must stay in step:
 *  - write path: `resolveUsageActor` (verification pipeline, background
 *    video scopes in backgroundUsage.ts, and the recordTokenUsage safety net);
 *  - read path: `attributeLedgerRows` for rows already stored with no seat
 *    (Settings › Billing › By employee);
 *  - backfill: backend/scripts/sql/backfill_video_usage_attribution.sql.
 */

export type UsageActorHints = {
  orgId: string;
  userId?: string | null;
  uploaderId?: string | null;
  videoId?: string | null;
  /** job_proofs.id — Field Capture / crew-link uploads. */
  proofId?: string | null;
  jobId?: string | null;
  partyId?: string | null;
  /** Signed-in org admin who started this run (re-analyse). Last resort. */
  triggeredBy?: string | null;
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
  triggeredBy?: string | null;
}): string | null {
  return firstNonEmptyId(
    hints.userId,
    hints.uploaderId,
    hints.partyCreatedBy,
    hints.jobOwnerId,
    hints.jobCreatedBy,
    hints.triggeredBy,
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

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

/**
 * Best-effort seat for a video / proof / job / party. Never throws — a lookup
 * miss must not fail analysis or proof filing.
 */
export async function resolveUsageActor(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  hints: UsageActorHints,
): Promise<string | null> {
  const triggeredBy = hints.triggeredBy ?? null;
  try {
    const immediate = pickUsageActor({
      userId: hints.userId,
      uploaderId: hints.uploaderId,
    });
    if (immediate) return immediate;

    let uploaderId = hints.uploaderId ?? null;
    let partyId = hints.partyId ?? null;
    let jobId = hints.jobId ?? null;

    // The clip's own uploader. A Field Capture / crew-link upload is a
    // job_proofs row; the verification pipeline links it to a
    // verification_videos row that carries uploader_id.
    if (!uploaderId && (hints.videoId || hints.proofId)) {
      const video = hints.videoId
        ? await maybeRow(client, 'verification_videos', 'uploader_id, party_id, job_id', {
            id: hints.videoId,
            org_id: hints.orgId,
          })
        : await maybeRow(client, 'verification_videos', 'uploader_id, party_id, job_id', {
            proof_id: hints.proofId as string,
            org_id: hints.orgId,
          });
      uploaderId = str(video?.uploader_id);
      if (!partyId) partyId = str(video?.party_id);
      if (!jobId) jobId = str(video?.job_id);
      const fromVideo = pickUsageActor({ uploaderId });
      if (fromVideo) return fromVideo;
    }

    if (hints.proofId && (!partyId || !jobId)) {
      const proof = await maybeRow(client, 'job_proofs', 'party_id, job_id', {
        id: hints.proofId,
        org_id: hints.orgId,
      });
      if (!partyId) partyId = str(proof?.party_id);
      if (!jobId) jobId = str(proof?.job_id);
    }

    if (partyId) {
      const party = await maybeRow(client, 'job_parties', 'created_by', {
        id: partyId,
        org_id: hints.orgId,
      });
      const fromParty = pickUsageActor({ partyCreatedBy: str(party?.created_by) });
      if (fromParty) return fromParty;
    }

    if (jobId) {
      const job = await maybeRow(client, 'crm_jobs', 'owner_id, created_by', {
        id: jobId,
        org_id: hints.orgId,
      });
      const fromJob = pickUsageActor({
        jobOwnerId: str(job?.owner_id),
        jobCreatedBy: str(job?.created_by),
      });
      if (fromJob) return fromJob;
    }
    return firstNonEmptyId(triggeredBy);
  } catch {
    return firstNonEmptyId(triggeredBy);
  }
}

// ---------------------------------------------------------------------------
// Read path: rows already on the ledger with no seat.
// ---------------------------------------------------------------------------

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const UUID_ONLY_RE = new RegExp(`^${UUID_RE.source}$`, 'i');

function uuidOrNull(value: unknown): string | null {
  return typeof value === 'string' && UUID_ONLY_RE.test(value.trim())
    ? value.trim().toLowerCase()
    : null;
}

export type LedgerClipHints = {
  proofId: string | null;
  videoId: string | null;
  partyId: string | null;
  triggeredBy: string | null;
};

/**
 * What a stored video-analysis row says about the clip it read.
 *
 * Request ids written by the background video scope are
 * `<source>:video:<proofId>:<uuid>[:<uuid>]`; Whisper is `whisper:<proofId>`;
 * the retired live-safety checks were `safety_vision:safety:<partyId>:…`.
 * Verification-pipeline rows carry metadata.videoId.
 */
export function ledgerClipHints(
  requestId: string | null | undefined,
  metadata?: Record<string, unknown> | null,
): LedgerClipHints {
  const rid = typeof requestId === 'string' ? requestId : '';
  const after = (marker: string): string | null => {
    const at = rid.indexOf(marker);
    if (at < 0) return null;
    const m = rid.slice(at + marker.length).match(UUID_RE);
    return m && m.index === 0 ? m[0].toLowerCase() : null;
  };
  const proofFromRequest = rid.startsWith('whisper:')
    ? after('whisper:')
    : (after(':video:') ?? (rid.startsWith('video:') ? after('video:') : null));
  return {
    proofId: uuidOrNull(metadata?.proofId) ?? proofFromRequest,
    videoId: uuidOrNull(metadata?.videoId),
    partyId: uuidOrNull(metadata?.partyId) ?? after(':safety:'),
    triggeredBy: uuidOrNull(metadata?.triggeredBy),
  };
}

export type AttributionLookups = {
  /** verification_videos keyed by id AND by proof_id. */
  videosById: Map<
    string,
    { uploaderId: string | null; partyId: string | null; jobId: string | null }
  >;
  videosByProofId: Map<
    string,
    { uploaderId: string | null; partyId: string | null; jobId: string | null }
  >;
  proofs: Map<string, { partyId: string | null; jobId: string | null }>;
  parties: Map<string, { createdBy: string | null }>;
  jobs: Map<string, { ownerId: string | null; createdBy: string | null }>;
};

export type LedgerRowForAttribution = {
  userId: string | null;
  jobId: string | null;
  requestId: string;
  feature: string;
  metadata?: Record<string, unknown> | null;
};

/** Pure: the same chain as resolveUsageActor, from preloaded lookups. */
export function attributeLedgerRow(
  row: LedgerRowForAttribution,
  lookups: AttributionLookups,
): string | null {
  if (row.userId) return row.userId;
  if (row.feature !== 'video_analysis') return null;
  const hints = ledgerClipHints(row.requestId, row.metadata ?? null);
  const video =
    (hints.videoId ? lookups.videosById.get(hints.videoId) : undefined) ??
    (hints.proofId ? lookups.videosByProofId.get(hints.proofId) : undefined);
  const proof = hints.proofId ? lookups.proofs.get(hints.proofId) : undefined;
  const partyId = video?.partyId ?? proof?.partyId ?? hints.partyId;
  const jobId = row.jobId ?? video?.jobId ?? proof?.jobId ?? null;
  const party = partyId ? lookups.parties.get(partyId) : undefined;
  const job = jobId ? lookups.jobs.get(jobId) : undefined;
  return pickUsageActor({
    uploaderId: video?.uploaderId ?? null,
    partyCreatedBy: party?.createdBy ?? null,
    jobOwnerId: job?.ownerId ?? null,
    jobCreatedBy: job?.createdBy ?? null,
    triggeredBy: hints.triggeredBy,
  });
}

async function selectIn(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  table: string,
  columns: string,
  orgId: string,
  column: string,
  ids: string[],
): Promise<Array<Record<string, unknown>>> {
  if (ids.length === 0) return [];
  const out: Array<Record<string, unknown>> = [];
  for (let i = 0; i < ids.length; i += 200) {
    try {
      const { data, error } = await client
        .from(table)
        .select(columns)
        .eq('org_id', orgId)
        .in(column, ids.slice(i, i + 200));
      if (error || !Array.isArray(data)) continue;
      out.push(...(data as Array<Record<string, unknown>>));
    } catch {
      // Best-effort: a missing grant leaves the row Unattributed, never fails the report.
    }
  }
  return out;
}

/**
 * Load everything `attributeLedgerRow` needs for the org's unowned
 * video-analysis rows, in a handful of batched queries.
 */
export async function loadAttributionLookups(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  orgId: string,
  rows: LedgerRowForAttribution[],
): Promise<AttributionLookups> {
  const lookups: AttributionLookups = {
    videosById: new Map(),
    videosByProofId: new Map(),
    proofs: new Map(),
    parties: new Map(),
    jobs: new Map(),
  };
  const unowned = rows.filter((r) => !r.userId && r.feature === 'video_analysis');
  if (unowned.length === 0) return lookups;

  const proofIds = new Set<string>();
  const videoIds = new Set<string>();
  const partyIds = new Set<string>();
  const jobIds = new Set<string>();
  for (const row of unowned) {
    const hints = ledgerClipHints(row.requestId, row.metadata ?? null);
    if (hints.proofId) proofIds.add(hints.proofId);
    if (hints.videoId) videoIds.add(hints.videoId);
    if (hints.partyId) partyIds.add(hints.partyId);
    if (row.jobId) jobIds.add(row.jobId);
  }

  const videoCols = 'id, proof_id, uploader_id, party_id, job_id';
  const [byId, byProof, proofRows] = await Promise.all([
    selectIn(client, 'verification_videos', videoCols, orgId, 'id', [...videoIds]),
    selectIn(client, 'verification_videos', videoCols, orgId, 'proof_id', [...proofIds]),
    selectIn(client, 'job_proofs', 'id, party_id, job_id', orgId, 'id', [...proofIds]),
  ]);
  for (const v of [...byId, ...byProof]) {
    const entry = {
      uploaderId: str(v.uploader_id),
      partyId: str(v.party_id),
      jobId: str(v.job_id),
    };
    const id = str(v.id);
    const proofId = str(v.proof_id);
    if (id) lookups.videosById.set(id, entry);
    if (proofId) {
      const existing = lookups.videosByProofId.get(proofId);
      // A proof can be linked more than once; keep the one that names an uploader.
      if (!existing || (!existing.uploaderId && entry.uploaderId))
        lookups.videosByProofId.set(proofId, entry);
    }
    if (entry.partyId) partyIds.add(entry.partyId);
    if (entry.jobId) jobIds.add(entry.jobId);
  }
  for (const p of proofRows) {
    const id = str(p.id);
    if (!id) continue;
    const entry = { partyId: str(p.party_id), jobId: str(p.job_id) };
    lookups.proofs.set(id, entry);
    if (entry.partyId) partyIds.add(entry.partyId);
    if (entry.jobId) jobIds.add(entry.jobId);
  }

  const [partyRows, jobRows] = await Promise.all([
    selectIn(client, 'job_parties', 'id, created_by', orgId, 'id', [...partyIds]),
    selectIn(client, 'crm_jobs', 'id, owner_id, created_by', orgId, 'id', [...jobIds]),
  ]);
  for (const p of partyRows) {
    const id = str(p.id);
    if (id) lookups.parties.set(id, { createdBy: str(p.created_by) });
  }
  for (const j of jobRows) {
    const id = str(j.id);
    if (id) lookups.jobs.set(id, { ownerId: str(j.owner_id), createdBy: str(j.created_by) });
  }
  return lookups;
}
