/**
 * GET /api/operations/live-map
 *
 * One office screen: open jobs with site/proof geo, recent Field Capture
 * activity, upload sessions, and open safety flags.
 */

import { Router, type NextFunction, type Request, type Response } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireOrgContext } from '../lib/orgContext.js';
import { HttpError } from '../lib/errors.js';
import { writerForOrg } from '../lib/scopedAdmin.js';
import { listTombstonedJobIds } from '../lib/jobFileDelete.js';
import { localDayKey } from '../lib/localDayKey.js';
import { DEFAULT_FIELD_TIMEZONE } from '../field/todayJobs.js';
import {
  OPEN_JOB_STATUSES,
  buildLiveMapJobs,
  liveMapSummary,
  type LiveMapInputJob,
  type LiveMapSafetyFlag,
} from '../shared/liveJobMap.js';

export const liveJobMapRouter = Router();
liveJobMapRouter.use(requireAuth);

function addressLine(property: {
  address_line1?: string | null;
  city?: string | null;
  region?: string | null;
  postal_code?: string | null;
} | null): string | null {
  if (!property) return null;
  const parts = [
    property.address_line1,
    property.city,
    property.region,
    property.postal_code,
  ].filter((p): p is string => Boolean(p && String(p).trim()));
  return parts.length ? parts.join(', ') : null;
}

liveJobMapRouter.get('/live-map', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId, supabase } = await requireOrgContext(req);
    const now = new Date();
    const today = localDayKey(now, DEFAULT_FIELD_TIMEZONE);

    const { data: jobs, error: jobsErr } = await supabase
      .from('crm_jobs')
      .select('id, job_number, title, status, property_id')
      .eq('org_id', orgId)
      .limit(500);
    if (jobsErr) throw new HttpError(500, jobsErr.message, 'live_map_jobs_failed');

    const tombstoned = await listTombstonedJobIds(writerForOrg(orgId, supabase).raw, orgId);
    const openJobs = ((jobs ?? []) as any[]).filter(
      (j) =>
        !tombstoned.has(j.id as string) && OPEN_JOB_STATUSES.has(String(j.status ?? '')),
    );

    if (openJobs.length === 0) {
      res.json({
        generatedAt: now.toISOString(),
        gaps: [
          'crew_live_positions /api/locations removed (non-sold path)',
          'no continuous Field Capture filming heartbeat — on_site uses party last_seen',
          'geometry_capture_sessions dropped',
        ],
        summary: liveMapSummary([]),
        jobs: [],
      });
      return;
    }

    const jobIds = openJobs.map((j) => j.id as string);
    const propertyIds = [
      ...new Set(
        openJobs
          .map((j) => j.property_id as string | null)
          .filter((id): id is string => Boolean(id)),
      ),
    ];

    const [
      propertiesRes,
      assignmentsRes,
      partiesRes,
      proofsRes,
      uploadsRes,
      mediaRes,
      safetyRes,
    ] = await Promise.all([
      propertyIds.length
        ? supabase
            .from('crm_properties')
            .select('id, address_line1, city, region, postal_code, latitude, longitude')
            .in('id', propertyIds)
        : Promise.resolve({ data: [], error: null }),
      supabase
        .from('job_assignments')
        .select('job_id, user_id')
        .in('job_id', jobIds),
      supabase
        .from('job_parties')
        .select('job_id, contact_name, company, last_seen_at, revoked_at')
        .in('job_id', jobIds),
      supabase
        .from('job_proofs')
        .select('job_id, lat, lon, received_at, work_date, party_id, deleted_at')
        .eq('org_id', orgId)
        .in('job_id', jobIds)
        .is('deleted_at', null)
        .order('received_at', { ascending: false })
        .limit(2000),
      supabase
        .from('media_upload_sessions')
        .select('id, media_id, expires_at, created_at')
        .eq('org_id', orgId)
        .gt('expires_at', now.toISOString())
        .limit(200),
      supabase
        .from('media_objects')
        .select('id, ref_type, ref_id, state')
        .eq('org_id', orgId)
        .in('state', ['pending_upload'])
        .limit(200),
      supabase
        .from('safety_incidents')
        .select(
          'id, job_id, severity, category, title, status, created_at, source, lat, lon',
        )
        .eq('org_id', orgId)
        .eq('status', 'open')
        .limit(200),
    ]);

    for (const [label, result] of [
      ['properties', propertiesRes],
      ['assignments', assignmentsRes],
      ['parties', partiesRes],
      ['proofs', proofsRes],
      ['uploads', uploadsRes],
      ['media', mediaRes],
      ['safety', safetyRes],
    ] as const) {
      if (result.error) {
        // Soft-fail optional tables (safety / media may be missing on older DBs).
        if (label === 'safety' || label === 'uploads' || label === 'media') {
          continue;
        }
        throw new HttpError(500, result.error.message, `live_map_${label}_failed`);
      }
    }

    const properties = new Map(
      ((propertiesRes.data ?? []) as any[]).map((p) => [p.id as string, p]),
    );

    const assignmentUserIds = [
      ...new Set(
        ((assignmentsRes.data ?? []) as any[])
          .map((a) => a.user_id as string)
          .filter(Boolean),
      ),
    ];
    let profileNames = new Map<string, string>();
    if (assignmentUserIds.length) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name, email')
        .in('id', assignmentUserIds);
      profileNames = new Map(
        ((profiles ?? []) as any[]).map((p) => [
          p.id as string,
          (p.full_name as string) || (p.email as string) || 'Crew',
        ]),
      );
    }

    const crewByJob = new Map<string, Array<{ name: string }>>();
    for (const row of (assignmentsRes.data ?? []) as any[]) {
      const list = crewByJob.get(row.job_id) ?? [];
      list.push({ name: profileNames.get(row.user_id) ?? 'Crew' });
      crewByJob.set(row.job_id, list);
    }

    const partiesByJob = new Map<
      string,
      Array<{ name: string; lastSeenAt: string | null }>
    >();
    for (const row of (partiesRes.data ?? []) as any[]) {
      if (row.revoked_at) continue;
      const name =
        (row.contact_name as string)?.trim() ||
        (row.company as string)?.trim() ||
        'Invitee';
      const list = partiesByJob.get(row.job_id) ?? [];
      list.push({ name, lastSeenAt: (row.last_seen_at as string) ?? null });
      partiesByJob.set(row.job_id, list);
    }

    const latestProofByJob = new Map<
      string,
      {
        lat: number | null;
        lon: number | null;
        receivedAt: string;
        partyName: string | null;
      }
    >();
    const filmedToday = new Set<string>();
    for (const row of (proofsRes.data ?? []) as any[]) {
      const jobId = row.job_id as string;
      if (String(row.work_date ?? '') === today) filmedToday.add(jobId);
      if (!latestProofByJob.has(jobId) && row.received_at) {
        latestProofByJob.set(jobId, {
          lat: row.lat == null ? null : Number(row.lat),
          lon: row.lon == null ? null : Number(row.lon),
          receivedAt: String(row.received_at),
          partyName: null,
        });
      }
    }

    const pendingMediaIds = new Set(
      ((mediaRes.data ?? []) as any[])
        .filter((m) => m.ref_type === 'job' || m.ref_type === 'crm_job' || m.ref_type === 'job_proof')
        .map((m) => m.id as string),
    );
    // Also treat any unexpired upload session as uploading for its media's job when linked.
    const mediaJobById = new Map<string, string>();
    for (const m of (mediaRes.data ?? []) as any[]) {
      if (typeof m.ref_id === 'string' && (m.ref_type === 'job' || m.ref_type === 'crm_job')) {
        mediaJobById.set(m.id as string, m.ref_id);
      }
    }
    const uploadingJobs = new Set<string>();
    for (const session of (uploadsRes.data ?? []) as any[]) {
      const jobId = mediaJobById.get(session.media_id as string);
      if (jobId) uploadingJobs.add(jobId);
      else if (pendingMediaIds.has(session.media_id as string)) {
        // Session exists but we couldn't map to a job — ignored for per-job dots.
      }
    }

    const safetyByJob = new Map<string, LiveMapSafetyFlag[]>();
    for (const row of (safetyRes.data ?? []) as any[]) {
      if (!row.job_id) continue;
      const list = safetyByJob.get(row.job_id) ?? [];
      list.push({
        id: row.id,
        severity: row.severity,
        category: row.category,
        title: row.title,
        status: row.status,
        createdAt: row.created_at,
        source: row.source,
        lat: row.lat == null ? null : Number(row.lat),
        lon: row.lon == null ? null : Number(row.lon),
      });
      safetyByJob.set(row.job_id, list);
    }

    const inputs: LiveMapInputJob[] = openJobs.map((j) => {
      const property = j.property_id ? properties.get(j.property_id) : null;
      return {
        jobId: j.id,
        jobNumber: j.job_number == null ? null : Number(j.job_number),
        title: (j.title as string) || 'Untitled job',
        status: (j.status as string) ?? null,
        address: addressLine(property ?? null),
        propertyLat:
          property?.latitude == null || property?.latitude === undefined
            ? null
            : Number(property.latitude),
        propertyLon:
          property?.longitude == null || property?.longitude === undefined
            ? null
            : Number(property.longitude),
        crew: crewByJob.get(j.id) ?? [],
        parties: partiesByJob.get(j.id) ?? [],
        latestProof: latestProofByJob.get(j.id) ?? null,
        uploading: uploadingJobs.has(j.id),
        filmedToday: filmedToday.has(j.id),
        openSafetyFlags: safetyByJob.get(j.id) ?? [],
      };
    });

    const mapped = buildLiveMapJobs(inputs, now);
    res.json({
      generatedAt: now.toISOString(),
      gaps: [
        'crew_live_positions and /api/locations were removed with the non-sold path — no opt-in live crew GPS',
        'no continuous Field Capture filming heartbeat; on_site ≈ party last_seen within 15 minutes',
        'upload activity only when media_upload_sessions map to a job via media_objects.ref_id',
        'geometry_capture_sessions dropped — room/site tree geo is not used here',
        'true WebRTC live safety sampling is still TODO (near-real-time samples only)',
      ],
      summary: liveMapSummary(mapped),
      jobs: mapped,
    });
  } catch (err) {
    next(err);
  }
});
