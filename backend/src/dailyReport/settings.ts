/* eslint-disable @typescript-eslint/no-explicit-any */
import { DEFAULT_FIELD_TIMEZONE } from '../field/todayJobs.js';
import type { DailyReportChannel, OrgDailyReportSettings } from './types.js';

const CHANNELS = new Set<DailyReportChannel>(['email', 'sms', 'email_and_sms']);

function asEmailList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const email = item.trim().toLowerCase();
    if (!email || !email.includes('@') || seen.has(email)) continue;
    seen.add(email);
    out.push(email);
    if (out.length >= 20) break;
  }
  return out;
}

function asChannel(raw: unknown): DailyReportChannel {
  const s = String(raw || '')
    .trim()
    .toLowerCase();
  if (CHANNELS.has(s as DailyReportChannel)) return s as DailyReportChannel;
  return 'email';
}

function asTimezone(raw: unknown): string {
  const tz = typeof raw === 'string' ? raw.trim() : '';
  if (tz.length >= 1 && tz.length <= 64) {
    try {
      // Validate IANA zone via Intl; invalid zones throw or fall back oddly.
      Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date());
      return tz;
    } catch {
      /* fall through */
    }
  }
  return DEFAULT_FIELD_TIMEZONE;
}

function asSendHour(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return 18;
  return Math.max(0, Math.min(23, Math.trunc(n)));
}

export function defaultDailyReportSettings(orgId: string): OrgDailyReportSettings {
  return {
    orgId,
    enabled: false,
    timezone: DEFAULT_FIELD_TIMEZONE,
    channel: 'email',
    sendHour: 18,
    extraEmails: [],
  };
}

export async function loadOrgDailyReportSettings(
  admin: any,
  orgId: string,
): Promise<OrgDailyReportSettings> {
  const { data, error } = await admin
    .from('orgs')
    .select(
      'id, daily_job_report_enabled, daily_job_report_timezone, daily_job_report_channel, daily_job_report_send_hour, daily_job_report_extra_emails',
    )
    .eq('id', orgId)
    .maybeSingle();

  if (error || !data) {
    return defaultDailyReportSettings(orgId);
  }

  return {
    orgId,
    enabled: data.daily_job_report_enabled === true,
    timezone: asTimezone(data.daily_job_report_timezone),
    channel: asChannel(data.daily_job_report_channel),
    sendHour: asSendHour(data.daily_job_report_send_hour),
    extraEmails: asEmailList(data.daily_job_report_extra_emails),
  };
}

export async function updateOrgDailyReportSettings(
  admin: any,
  orgId: string,
  patch: {
    enabled?: boolean;
    timezone?: string;
    channel?: DailyReportChannel;
    sendHour?: number;
    extraEmails?: string[];
  },
): Promise<OrgDailyReportSettings> {
  const row: Record<string, unknown> = {};
  if (patch.enabled !== undefined) row.daily_job_report_enabled = Boolean(patch.enabled);
  if (patch.timezone !== undefined) row.daily_job_report_timezone = asTimezone(patch.timezone);
  if (patch.channel !== undefined) {
    if (!CHANNELS.has(patch.channel)) {
      throw Object.assign(new Error('Invalid channel'), { code: 'invalid_channel' });
    }
    row.daily_job_report_channel = patch.channel;
  }
  if (patch.sendHour !== undefined) row.daily_job_report_send_hour = asSendHour(patch.sendHour);
  if (patch.extraEmails !== undefined) {
    row.daily_job_report_extra_emails = asEmailList(patch.extraEmails);
  }
  if (Object.keys(row).length) {
    const { error } = await admin.from('orgs').update(row).eq('id', orgId);
    if (error) throw new Error(error.message);
  }
  return loadOrgDailyReportSettings(admin, orgId);
}

/** Local hour 0-23 in the given timezone. */
export function localHour(instant: Date, timezone: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      hourCycle: 'h23',
    }).formatToParts(instant);
    const hour = parts.find((p) => p.type === 'hour')?.value;
    const n = hour != null ? Number(hour) : NaN;
    return Number.isFinite(n) ? n : instant.getUTCHours();
  } catch {
    return instant.getUTCHours();
  }
}

export function isPastSendHour(
  instant: Date,
  timezone: string,
  sendHour: number,
): boolean {
  return localHour(instant, timezone) >= asSendHour(sendHour);
}
