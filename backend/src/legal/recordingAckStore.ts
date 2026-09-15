import type { SupabaseClient } from '@supabase/supabase-js';
import { unscopedAdminOrNull } from '../lib/scopedAdmin.js';
import { HttpError } from '../lib/errors.js';
import { config } from '../config.js';
import {
  RECORDING_ACK_REQUIRED_CODE,
  RECORDING_ACK_REQUIRED_MESSAGE,
  RECORDING_DISCLOSURE_VERSION,
  RECORDING_VERSION_MISMATCH_CODE,
  isAcceptableRecordingDisclosureVersion,
  recordingAckStatus,
  type RecordingAckStatus,
} from './recordingDisclosure.js';

type AckRow = {
  disclosure_version: string;
  acknowledged_at: string;
  work_date: string;
  job_id: string;
};

function recordingAdmin(): SupabaseClient {
  const admin = unscopedAdminOrNull();
  if (!admin) {
    throw new HttpError(
      503,
      'Cannot record recording acknowledgments until the server has a service role key.',
      'admin_unavailable',
    );
  }
  return admin;
}

function isMissingAckTable(error: { code?: string; message?: string }): boolean {
  return (
    error.code === '42P01' ||
    error.code === 'PGRST205' ||
    /relation ["']?public\.?recording_acknowledgments["']? does not exist/i.test(error.message ?? '') ||
    /Could not find the table ['"]public\.recording_acknowledgments['"]/i.test(error.message ?? '')
  );
}

export async function loadJobRecordingContext(
  admin: SupabaseClient,
  jobId: string,
): Promise<{ orgId: string; propertyId: string | null }> {
  const { data, error } = await admin
    .from('crm_jobs')
    .select('org_id, property_id')
    .eq('id', jobId)
    .maybeSingle();
  if (error) throw new HttpError(500, error.message, 'recording_ack_job_lookup_failed');
  if (!data?.org_id) throw new HttpError(404, 'Job not found.', 'job_not_found');
  return {
    orgId: data.org_id as string,
    propertyId: (data.property_id as string | null) ?? null,
  };
}

export async function latestRecordingAck(input: {
  admin?: SupabaseClient;
  jobId: string;
  workDate: string;
  actorUserId?: string | null;
  actorPartyId?: string | null;
}): Promise<{ disclosureVersion: string; acknowledgedAt: string } | null> {
  const admin = input.admin ?? recordingAdmin();
  let query = admin
    .from('recording_acknowledgments')
    .select('disclosure_version, acknowledged_at, work_date, job_id')
    .eq('job_id', input.jobId)
    .eq('work_date', input.workDate)
    .eq('disclosure_version', RECORDING_DISCLOSURE_VERSION)
    .order('acknowledged_at', { ascending: false })
    .limit(1);

  if (input.actorUserId) {
    query = query.eq('actor_user_id', input.actorUserId);
  } else if (input.actorPartyId) {
    query = query.eq('actor_party_id', input.actorPartyId);
  } else {
    return null;
  }

  const { data, error } = await query.maybeSingle();
  if (error) {
    if (isMissingAckTable(error)) return null;
    throw new HttpError(500, error.message, 'recording_ack_lookup_failed');
  }
  const row = data as AckRow | null;
  if (!row?.disclosure_version) return null;
  return { disclosureVersion: row.disclosure_version, acknowledgedAt: row.acknowledged_at };
}

/** Prefer party-scoped ack, then user-scoped — either satisfies the gate. */
export async function findRecordingAckForProof(input: {
  admin: SupabaseClient;
  jobId: string;
  workDate: string;
  actorPartyId?: string | null;
  actorUserId?: string | null;
}): Promise<{ disclosureVersion: string; acknowledgedAt: string } | null> {
  if (input.actorPartyId) {
    const byParty = await latestRecordingAck({
      admin: input.admin,
      jobId: input.jobId,
      workDate: input.workDate,
      actorPartyId: input.actorPartyId,
    });
    if (byParty) return byParty;
  }
  if (input.actorUserId) {
    return latestRecordingAck({
      admin: input.admin,
      jobId: input.jobId,
      workDate: input.workDate,
      actorUserId: input.actorUserId,
    });
  }
  return null;
}

export async function loadRecordingAckStatus(input: {
  jobId: string;
  workDate: string;
  actorUserId?: string | null;
  actorPartyId?: string | null;
  admin?: SupabaseClient;
}): Promise<RecordingAckStatus> {
  const ack = await findRecordingAckForProof({
    admin: input.admin ?? recordingAdmin(),
    jobId: input.jobId,
    workDate: input.workDate,
    actorUserId: input.actorUserId,
    actorPartyId: input.actorPartyId,
  });
  return recordingAckStatus({
    jobId: input.jobId,
    workDate: input.workDate,
    acknowledgedVersion: ack?.disclosureVersion ?? null,
    acknowledgedAt: ack?.acknowledgedAt ?? null,
  });
}

export async function recordRecordingAcknowledgment(input: {
  jobId: string;
  workDate: string;
  disclosureVersion: string;
  actorUserId: string;
  actorPartyId?: string | null;
  orgId?: string | null;
  propertyId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  admin?: SupabaseClient;
}): Promise<RecordingAckStatus> {
  if (!isAcceptableRecordingDisclosureVersion(input.disclosureVersion)) {
    throw new HttpError(
      400,
      'Acknowledge the current recording disclosure to continue.',
      RECORDING_VERSION_MISMATCH_CODE,
    );
  }
  if (!input.actorUserId) {
    throw new HttpError(401, 'Sign in to acknowledge recording on this job.', 'auth_required');
  }

  const admin = input.admin ?? recordingAdmin();
  const job = input.orgId
    ? { orgId: input.orgId, propertyId: input.propertyId ?? null }
    : await loadJobRecordingContext(admin, input.jobId);

  const acknowledgedAt = new Date().toISOString();
  const row = {
    org_id: job.orgId,
    job_id: input.jobId,
    property_id: input.propertyId ?? job.propertyId,
    actor_user_id: input.actorUserId,
    actor_party_id: input.actorPartyId ?? null,
    disclosure_version: RECORDING_DISCLOSURE_VERSION,
    work_date: input.workDate,
    acknowledged_at: acknowledgedAt,
    ip: input.ip ?? null,
    user_agent: input.userAgent ?? null,
  };

  const { error } = await admin.from('recording_acknowledgments').upsert(row, {
    onConflict: 'job_id,actor_user_id,work_date,disclosure_version',
  });

  if (error) {
    if (isMissingAckTable(error)) {
      throw new HttpError(
        503,
        'Recording acknowledgments are not available yet.',
        'recording_ack_unavailable',
      );
    }
    throw new HttpError(500, error.message, 'recording_ack_record_failed');
  }

  return recordingAckStatus({
    jobId: input.jobId,
    workDate: input.workDate,
    acknowledgedVersion: RECORDING_DISCLOSURE_VERSION,
    acknowledgedAt,
  });
}

/**
 * Production Field Capture uploads require a same-day ack for the live
 * disclosure version. Development / test stay open so local capture and CI
 * are not blocked before the table exists.
 */
export async function assertRecordingAckForProof(input: {
  admin: SupabaseClient;
  jobId: string;
  workDate: string;
  actorPartyId?: string | null;
  actorUserId?: string | null;
  enforce?: boolean;
}): Promise<void> {
  const enforce = input.enforce ?? config.isProduction;
  if (!enforce) return;

  const ack = await findRecordingAckForProof(input);
  if (!ack) {
    throw new HttpError(403, RECORDING_ACK_REQUIRED_MESSAGE, RECORDING_ACK_REQUIRED_CODE);
  }
}
