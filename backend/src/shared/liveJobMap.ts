/**
 * Live job map — office view of who is on site / filming, last geo ping,
 * and open safety flags.
 *
 * Built from sold-path data only:
 *   • crm_jobs + crm_properties (site lat/lon)
 *   • job_proofs lat/lon + received_at (device ping at upload)
 *   • job_parties.last_seen_at (Field Capture / share open)
 *   • media_upload_sessions (bytes still landing)
 *   • safety_incidents (open flags)
 *
 * Deliberately does NOT revive /api/locations or crew_locations — those were
 * dropped with the non-sold path. See docs/live-job-map.md.
 */

export const OPEN_JOB_STATUSES = new Set(['draft', 'scheduled', 'in_progress', 'on_hold']);

/** Party opened Field Capture / share this recently → likely on site. */
export const RECENT_SEEN_MS = 15 * 60 * 1000;
/** Proof filed this recently → recent upload / just finished filming. */
export const RECENT_PROOF_MS = 30 * 60 * 1000;

export type LiveActivity =
  | 'uploading'
  | 'on_site'
  | 'recent_upload'
  | 'in_progress'
  | 'idle';

export type LiveMapCoords = {
  lat: number;
  lon: number;
  /** Where the coordinates came from. */
  source: 'proof' | 'property' | 'safety';
};

export type LiveMapSafetyFlag = {
  id: string;
  severity: 'watch' | 'critical';
  category: string;
  title: string;
  status: string;
  createdAt: string;
  source: string;
  lat?: number | null;
  lon?: number | null;
};

export type LiveMapPerson = {
  name: string;
  kind: 'crew' | 'party';
  lastSeenAt: string | null;
};

export type LiveMapJob = {
  jobId: string;
  jobNumber: number | null;
  title: string;
  status: string | null;
  address: string | null;
  activity: LiveActivity;
  coords: LiveMapCoords | null;
  lastPingAt: string | null;
  lastPingLabel: string | null;
  people: LiveMapPerson[];
  openSafetyFlags: LiveMapSafetyFlag[];
  filmedToday: boolean;
};

export type LiveMapInputJob = {
  jobId: string;
  jobNumber: number | null;
  title: string;
  status: string | null;
  address: string | null;
  propertyLat: number | null;
  propertyLon: number | null;
  crew: Array<{ name: string }>;
  parties: Array<{ name: string; lastSeenAt: string | null }>;
  latestProof: {
    lat: number | null;
    lon: number | null;
    receivedAt: string;
    partyName: string | null;
  } | null;
  uploading: boolean;
  filmedToday: boolean;
  openSafetyFlags: LiveMapSafetyFlag[];
};

function finiteCoord(n: number | null | undefined): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

export function pickCoords(job: LiveMapInputJob): LiveMapCoords | null {
  if (job.latestProof && finiteCoord(job.latestProof.lat) && finiteCoord(job.latestProof.lon)) {
    return { lat: job.latestProof.lat, lon: job.latestProof.lon, source: 'proof' };
  }
  const safetyWithGeo = job.openSafetyFlags.find(
    (f) => finiteCoord(f.lat ?? null) && finiteCoord(f.lon ?? null),
  );
  if (safetyWithGeo && finiteCoord(safetyWithGeo.lat ?? null) && finiteCoord(safetyWithGeo.lon ?? null)) {
    return { lat: safetyWithGeo.lat!, lon: safetyWithGeo.lon!, source: 'safety' };
  }
  if (finiteCoord(job.propertyLat) && finiteCoord(job.propertyLon)) {
    return { lat: job.propertyLat, lon: job.propertyLon, source: 'property' };
  }
  return null;
}

export function classifyActivity(
  input: {
    status: string | null;
    lastPartySeenAt: string | null;
    lastProofAt: string | null;
    uploading: boolean;
  },
  now: Date = new Date(),
): LiveActivity {
  if (input.uploading) return 'uploading';

  const nowMs = now.getTime();
  if (input.lastPartySeenAt) {
    const seen = Date.parse(input.lastPartySeenAt);
    if (Number.isFinite(seen) && nowMs - seen <= RECENT_SEEN_MS) return 'on_site';
  }
  if (input.lastProofAt) {
    const proof = Date.parse(input.lastProofAt);
    if (Number.isFinite(proof) && nowMs - proof <= RECENT_PROOF_MS) return 'recent_upload';
  }
  if (input.status === 'in_progress') return 'in_progress';
  return 'idle';
}

export function buildLiveMapJobs(rows: LiveMapInputJob[], now: Date = new Date()): LiveMapJob[] {
  const jobs: LiveMapJob[] = rows.map((row) => {
    const lastSeen = row.parties
      .map((p) => p.lastSeenAt)
      .filter((v): v is string => Boolean(v))
      .sort()
      .at(-1) ?? null;

    const activity = classifyActivity(
      {
        status: row.status,
        lastPartySeenAt: lastSeen,
        lastProofAt: row.latestProof?.receivedAt ?? null,
        uploading: row.uploading,
      },
      now,
    );

    const people: LiveMapPerson[] = [
      ...row.crew.map((c) => ({ name: c.name, kind: 'crew' as const, lastSeenAt: null })),
      ...row.parties
        .filter((p) => p.name.trim())
        .map((p) => ({ name: p.name, kind: 'party' as const, lastSeenAt: p.lastSeenAt })),
    ];

    // Prefer unique names — crew assignment and party invite often overlap.
    const seenNames = new Set<string>();
    const uniquePeople = people.filter((p) => {
      const key = p.name.trim().toLowerCase();
      if (!key || seenNames.has(key)) return false;
      seenNames.add(key);
      return true;
    });

    const coords = pickCoords(row);
    const lastPingAt = row.latestProof?.receivedAt ?? lastSeen;
    const lastPingLabel = row.latestProof
      ? row.latestProof.partyName
        ? `Proof from ${row.latestProof.partyName}`
        : 'Last proof upload'
      : lastSeen
        ? 'Last Field Capture / share open'
        : null;

    return {
      jobId: row.jobId,
      jobNumber: row.jobNumber,
      title: row.title,
      status: row.status,
      address: row.address,
      activity,
      coords,
      lastPingAt,
      lastPingLabel,
      people: uniquePeople,
      openSafetyFlags: row.openSafetyFlags,
      filmedToday: row.filmedToday,
    };
  });

  const rank: Record<LiveActivity, number> = {
    uploading: 0,
    on_site: 1,
    recent_upload: 2,
    in_progress: 3,
    idle: 4,
  };

  return jobs.sort((a, b) => {
    const safety =
      b.openSafetyFlags.filter((f) => f.severity === 'critical').length -
      a.openSafetyFlags.filter((f) => f.severity === 'critical').length;
    if (safety) return safety;
    const openFlags = b.openSafetyFlags.length - a.openSafetyFlags.length;
    if (openFlags) return openFlags;
    const act = rank[a.activity] - rank[b.activity];
    if (act) return act;
    return (b.lastPingAt ?? '').localeCompare(a.lastPingAt ?? '');
  });
}

export function liveMapSummary(jobs: LiveMapJob[]) {
  return {
    jobs: jobs.length,
    withCoords: jobs.filter((j) => j.coords).length,
    active: jobs.filter((j) => j.activity !== 'idle').length,
    openSafety: jobs.reduce((n, j) => n + j.openSafetyFlags.length, 0),
    criticalSafety: jobs.reduce(
      (n, j) => n + j.openSafetyFlags.filter((f) => f.severity === 'critical').length,
      0,
    ),
  };
}
