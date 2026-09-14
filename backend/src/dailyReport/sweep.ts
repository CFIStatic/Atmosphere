/**
 * End-of-day Glance report sweep — opt-in orgs, org timezone, idempotent day.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { localDayKey } from '../lib/localDayKey.js';
import { unscopedAdminOrNull } from '../lib/scopedAdmin.js';
import { logger } from '../lib/logger.js';
import { composeDailyGlance } from './compose.js';
import { dailyJobReportEmail } from './email.js';
import { resolveDailyReportRecipients } from './recipients.js';
import { sendDailyJobReport } from './send.js';
import {
  isPastSendHour,
  loadOrgDailyReportSettings,
} from './settings.js';
import { publicAppOrigin } from '../lib/publicAppOrigin.js';

const INTERVAL_MS = 5 * 60_000;
const BATCH_ORGS = 25;
const BATCH_JOBS = 40;

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

type ProofRow = {
  id: string;
  job_id: string;
  clip_id?: string | null;
  work_date?: string | null;
  phase?: string | null;
  received_at?: string | null;
  ai_summary?: string | null;
  ai_findings?: unknown;
  title?: string | null;
};

async function listEnabledOrgs(admin: any): Promise<{ id: string; name: string | null }[]> {
  const { data, error } = await admin
    .from('orgs')
    .select('id, name, daily_job_report_enabled')
    .eq('daily_job_report_enabled', true)
    .limit(BATCH_ORGS);
  if (error) {
    // Pre-migration: column missing — treat as no orgs.
    if (/daily_job_report_enabled|column .* does not exist/i.test(error.message)) {
      return [];
    }
    logger.warn('daily_report_orgs_failed', { detail: error.message });
    return [];
  }
  return (data ?? []).map((row: any) => ({
    id: String(row.id),
    name: typeof row.name === 'string' ? row.name : null,
  }));
}

async function alreadyReported(
  admin: any,
  orgId: string,
  jobId: string,
  localDay: string,
): Promise<boolean> {
  const { data } = await admin
    .from('daily_job_reports')
    .select('id, status')
    .eq('org_id', orgId)
    .eq('job_id', jobId)
    .eq('local_day', localDay)
    .maybeSingle();
  if (!data) return false;
  return data.status === 'sent' || data.status === 'skipped' || data.status === 'pending';
}

async function upsertReport(
  admin: any,
  row: Record<string, unknown>,
): Promise<string | null> {
  const { data, error } = await admin
    .from('daily_job_reports')
    .upsert(row, { onConflict: 'org_id,job_id,local_day' })
    .select('id')
    .maybeSingle();
  if (error) {
    logger.warn('daily_report_upsert_failed', { detail: error.message });
    return null;
  }
  return data?.id ? String(data.id) : null;
}

export async function processOrgDailyReports(
  admin: any,
  org: { id: string; name: string | null },
  now: Date = new Date(),
): Promise<number> {
  const settings = await loadOrgDailyReportSettings(admin, org.id);
  if (!settings.enabled) return 0;
  if (!isPastSendHour(now, settings.timezone, settings.sendHour)) return 0;

  const localDay = localDayKey(now, settings.timezone);

  const { data: proofs, error } = await admin
    .from('job_proofs')
    .select(
      'id, job_id, clip_id, work_date, phase, received_at, ai_summary, ai_findings, title',
    )
    .eq('org_id', org.id)
    .eq('work_date', localDay)
    .order('received_at', { ascending: true })
    .limit(500);

  if (error) {
    logger.warn('daily_report_proofs_failed', { orgId: org.id, detail: error.message });
    return 0;
  }

  const byJob = new Map<string, ProofRow[]>();
  for (const row of (proofs ?? []) as ProofRow[]) {
    const jobId = String(row.job_id);
    const list = byJob.get(jobId) ?? [];
    list.push(row);
    byJob.set(jobId, list);
  }

  let finished = 0;
  let processed = 0;
  for (const [jobId, jobProofs] of byJob) {
    if (processed >= BATCH_JOBS) break;
    processed += 1;
    if (await alreadyReported(admin, org.id, jobId, localDay)) continue;

    const { data: job } = await admin
      .from('crm_jobs')
      .select('id, title')
      .eq('id', jobId)
      .maybeSingle();

    const report = composeDailyGlance({
      orgId: org.id,
      jobId,
      jobTitle: job?.title ?? null,
      orgName: org.name,
      localDay,
      timezone: settings.timezone,
      proofs: jobProofs,
    });

    const recipients = await resolveDailyReportRecipients(
      admin,
      org.id,
      jobId,
      settings.extraEmails,
    );

    if (jobProofs.length === 0) {
      await upsertReport(admin, {
        org_id: org.id,
        job_id: jobId,
        local_day: localDay,
        timezone: settings.timezone,
        channel: settings.channel,
        status: 'skipped',
        recipient_emails: recipients.emails,
        recipient_phones: recipients.phones,
        clip_count: 0,
        summary: { overview: report.overview, clips: [] },
        updated_at: new Date().toISOString(),
      });
      finished += 1;
      continue;
    }

    if (recipients.emails.length === 0) {
      await upsertReport(admin, {
        org_id: org.id,
        job_id: jobId,
        local_day: localDay,
        timezone: settings.timezone,
        channel: settings.channel,
        status: 'skipped',
        recipient_emails: [],
        recipient_phones: recipients.phones,
        clip_count: report.clips.length,
        summary: { overview: report.overview, clipCount: report.clips.length },
        error: 'no_recipients',
        updated_at: new Date().toISOString(),
      });
      finished += 1;
      continue;
    }

    const mail = dailyJobReportEmail({ report, origin: publicAppOrigin() });
    await upsertReport(admin, {
      org_id: org.id,
      job_id: jobId,
      local_day: localDay,
      timezone: settings.timezone,
      channel: settings.channel,
      status: 'pending',
      recipient_emails: recipients.emails,
      recipient_phones: recipients.phones,
      subject: mail.subject,
      body_text: mail.text,
      body_html: mail.html,
      clip_count: report.clips.length,
      summary: {
        overview: report.overview,
        clips: report.clips.map((c) => ({
          proofId: c.proofId,
          title: c.title,
          headline: c.headline,
          points: c.points,
          privacyProtected: c.privacyProtected,
        })),
      },
      updated_at: new Date().toISOString(),
    });

    const sent = await sendDailyJobReport({
      report,
      recipients,
      channel: settings.channel,
    });

    await upsertReport(admin, {
      org_id: org.id,
      job_id: jobId,
      local_day: localDay,
      timezone: settings.timezone,
      channel: settings.channel,
      status: sent.ok ? 'sent' : 'failed',
      recipient_emails: sent.emailed.length ? sent.emailed : recipients.emails,
      recipient_phones: recipients.phones,
      subject: mail.subject,
      body_text: mail.text,
      body_html: mail.html,
      clip_count: report.clips.length,
      summary: {
        overview: report.overview,
        smsSkipped: sent.smsSkipped,
        clips: report.clips.map((c) => ({
          proofId: c.proofId,
          title: c.title,
          headline: c.headline,
          points: c.points,
          privacyProtected: c.privacyProtected,
        })),
      },
      error: sent.error ?? null,
      sent_at: sent.ok ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    });
    finished += 1;
  }

  return finished;
}

export async function sweepDailyJobReports(now: Date = new Date()): Promise<number> {
  const admin = unscopedAdminOrNull();
  if (!admin) return 0;
  const orgs = await listEnabledOrgs(admin);
  let total = 0;
  for (const org of orgs) {
    total += await processOrgDailyReports(admin, org, now);
  }
  return total;
}

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const n = await sweepDailyJobReports();
    if (n > 0) logger.info('daily_report_sweep', { finished: n });
  } catch (err) {
    logger.warn('daily_report_sweep_failed', {
      detail: err instanceof Error ? err.message : String(err),
    });
  } finally {
    running = false;
  }
}

export function startDailyJobReportSweep(): void {
  if (timer) return;
  void tick();
  timer = setInterval(() => void tick(), INTERVAL_MS);
  timer.unref?.();
}

export function stopDailyJobReportSweep(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}

/** Manual / QA: compose+send one job for a local day (ignores send hour). */
export async function runDailyReportNow(input: {
  orgId: string;
  jobId: string;
  localDay?: string;
}): Promise<{ status: string; emailed: string[]; error?: string }> {
  const admin = unscopedAdminOrNull();
  if (!admin) return { status: 'failed', emailed: [], error: 'no_admin' };
  const settings = await loadOrgDailyReportSettings(admin, input.orgId);
  const localDay = input.localDay || localDayKey(new Date(), settings.timezone);

  const { data: org } = await admin.from('orgs').select('id, name').eq('id', input.orgId).maybeSingle();
  const { data: job } = await admin
    .from('crm_jobs')
    .select('id, title')
    .eq('id', input.jobId)
    .maybeSingle();
  const { data: proofs } = await admin
    .from('job_proofs')
    .select(
      'id, job_id, clip_id, work_date, phase, received_at, ai_summary, ai_findings, title',
    )
    .eq('org_id', input.orgId)
    .eq('job_id', input.jobId)
    .eq('work_date', localDay)
    .order('received_at', { ascending: true });

  const report = composeDailyGlance({
    orgId: input.orgId,
    jobId: input.jobId,
    jobTitle: job?.title ?? null,
    orgName: org?.name ?? null,
    localDay,
    timezone: settings.timezone,
    proofs: (proofs ?? []) as ProofRow[],
  });
  const recipients = await resolveDailyReportRecipients(
    admin,
    input.orgId,
    input.jobId,
    settings.extraEmails,
  );
  if (!proofs?.length) {
    return { status: 'skipped', emailed: [], error: 'no_clips' };
  }
  if (!recipients.emails.length) {
    return { status: 'skipped', emailed: [], error: 'no_recipients' };
  }
  const sent = await sendDailyJobReport({
    report,
    recipients,
    channel: settings.channel,
  });
  const mail = dailyJobReportEmail({ report, origin: publicAppOrigin() });
  await upsertReport(admin, {
    org_id: input.orgId,
    job_id: input.jobId,
    local_day: localDay,
    timezone: settings.timezone,
    channel: settings.channel,
    status: sent.ok ? 'sent' : 'failed',
    recipient_emails: sent.emailed,
    recipient_phones: recipients.phones,
    subject: mail.subject,
    body_text: mail.text,
    body_html: mail.html,
    clip_count: report.clips.length,
    summary: { overview: report.overview, manual: true },
    error: sent.error ?? null,
    sent_at: sent.ok ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  });
  return { status: sent.ok ? 'sent' : 'failed', emailed: sent.emailed, error: sent.error };
}
