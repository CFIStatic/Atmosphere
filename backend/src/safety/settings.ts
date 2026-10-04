/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  WELLNESS_DEFAULT_CRITICAL_AFTER_SECONDS,
  WELLNESS_DEFAULT_NO_MOTION_SECONDS,
  type OrgSafetySettings,
} from './types.js';

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

/**
 * Emergency-service numbers are never dialled or texted by Atmosphere. A
 * phone list that contains one is refused, not silently trimmed.
 */
const EMERGENCY_NUMBERS = new Set(['911', '112', '999', '000', '110', '119', '100', '101', '102', '108', '933']);

export function isEmergencyServiceNumber(raw: string): boolean {
  const digits = String(raw || '').replace(/[^\d]/g, '');
  if (!digits) return false;
  if (EMERGENCY_NUMBERS.has(digits)) return true;
  // +1 911, 1-911 and similar dressings of a short emergency code.
  if (/^1?(911|933)$/.test(digits)) return true;
  return digits.length <= 4;
}

/** E.164 only (+ and 8–15 digits). Emergency / short codes are refused. */
export function asPhoneList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const phone = item.replace(/[\s().-]/g, '');
    if (!/^\+[1-9]\d{7,14}$/.test(phone)) continue;
    if (isEmergencyServiceNumber(phone)) continue;
    if (!out.includes(phone)) out.push(phone);
    if (out.length >= 10) break;
  }
  return out;
}

function clampInt(raw: unknown, fallback: number, min: number, max: number): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function defaults(orgId: string): OrgSafetySettings {
  return {
    orgId,
    autoEscalateToAuthorities: false,
    alertWebhookUrl: null,
    alertEmails: [],
    wellnessCheckEnabled: true,
    wellnessNoMotionSeconds: WELLNESS_DEFAULT_NO_MOTION_SECONDS,
    wellnessCriticalAfterSeconds: WELLNESS_DEFAULT_CRITICAL_AFTER_SECONDS,
    wellnessRequireAlone: true,
    liveSafetyEnabled: true,
    alertPhones: [],
    escalateAfterSeconds: 90,
  };
}

function normalizeWellness(settings: OrgSafetySettings): OrgSafetySettings {
  const noMotion = clampInt(
    settings.wellnessNoMotionSeconds,
    WELLNESS_DEFAULT_NO_MOTION_SECONDS,
    60,
    7200,
  );
  let critical = clampInt(
    settings.wellnessCriticalAfterSeconds,
    WELLNESS_DEFAULT_CRITICAL_AFTER_SECONDS,
    60,
    14400,
  );
  if (critical < noMotion) critical = noMotion;
  return {
    ...settings,
    wellnessNoMotionSeconds: noMotion,
    wellnessCriticalAfterSeconds: critical,
  };
}

export async function loadOrgSafetySettings(
  admin: any,
  orgId: string,
): Promise<OrgSafetySettings> {
  const { data, error } = await admin
    .from('orgs')
    .select(
      'id, safety_auto_escalate_to_authorities, safety_alert_webhook_url, safety_alert_emails, ' +
        'wellness_check_enabled, wellness_no_motion_seconds, wellness_critical_after_seconds, ' +
        'wellness_require_alone, safety_live_enabled, safety_alert_phones, safety_escalate_after_seconds',
    )
    .eq('id', orgId)
    .maybeSingle();

  if (error || !data) {
    // Missing columns (pre-migration) or missing org → safe defaults
    // (critical live safety stays ON by default).
    if (error && /safety_live_enabled|safety_alert_phones|safety_escalate_after_seconds/.test(error.message ?? '')) {
      return loadLegacyOrgSafetySettings(admin, orgId);
    }
    return defaults(orgId);
  }

  const webhook =
    typeof data.safety_alert_webhook_url === 'string' &&
    data.safety_alert_webhook_url.trim().startsWith('http')
      ? data.safety_alert_webhook_url.trim().slice(0, 2000)
      : null;

  return normalizeWellness({
    orgId,
    autoEscalateToAuthorities: data.safety_auto_escalate_to_authorities === true,
    alertWebhookUrl: webhook,
    alertEmails: asEmailList(data.safety_alert_emails),
    wellnessCheckEnabled: data.wellness_check_enabled !== false,
    wellnessNoMotionSeconds: clampInt(
      data.wellness_no_motion_seconds,
      WELLNESS_DEFAULT_NO_MOTION_SECONDS,
      60,
      7200,
    ),
    wellnessCriticalAfterSeconds: clampInt(
      data.wellness_critical_after_seconds,
      WELLNESS_DEFAULT_CRITICAL_AFTER_SECONDS,
      60,
      14400,
    ),
    wellnessRequireAlone: data.wellness_require_alone !== false,
    liveSafetyEnabled: data.safety_live_enabled !== false,
    alertPhones: asPhoneList(data.safety_alert_phones),
    escalateAfterSeconds: clampInt(data.safety_escalate_after_seconds, 90, 30, 1800),
  });
}

/** Before the live-safety migration lands: read the older columns only. */
async function loadLegacyOrgSafetySettings(admin: any, orgId: string): Promise<OrgSafetySettings> {
  const { data, error } = await admin
    .from('orgs')
    .select('id, safety_auto_escalate_to_authorities, safety_alert_webhook_url, safety_alert_emails')
    .eq('id', orgId)
    .maybeSingle();
  const base = defaults(orgId);
  if (error || !data) return base;
  const webhook =
    typeof data.safety_alert_webhook_url === 'string' && data.safety_alert_webhook_url.trim().startsWith('http')
      ? data.safety_alert_webhook_url.trim().slice(0, 2000)
      : null;
  return {
    ...base,
    autoEscalateToAuthorities: data.safety_auto_escalate_to_authorities === true,
    alertWebhookUrl: webhook,
    alertEmails: asEmailList(data.safety_alert_emails),
  };
}

export async function updateOrgSafetySettings(
  admin: any,
  orgId: string,
  patch: {
    autoEscalateToAuthorities?: boolean;
    alertWebhookUrl?: string | null;
    alertEmails?: string[];
    wellnessCheckEnabled?: boolean;
    wellnessNoMotionSeconds?: number;
    wellnessCriticalAfterSeconds?: number;
    wellnessRequireAlone?: boolean;
    liveSafetyEnabled?: boolean;
    alertPhones?: string[];
    escalateAfterSeconds?: number;
  },
): Promise<OrgSafetySettings> {
  const row: Record<string, unknown> = {};
  if (patch.autoEscalateToAuthorities !== undefined) {
    row.safety_auto_escalate_to_authorities = Boolean(patch.autoEscalateToAuthorities);
  }
  if (patch.alertWebhookUrl !== undefined) {
    const url = patch.alertWebhookUrl?.trim() || null;
    if (url && !/^https:\/\//i.test(url)) {
      throw Object.assign(new Error('Webhook URL must be https.'), { code: 'invalid_webhook' });
    }
    row.safety_alert_webhook_url = url ? url.slice(0, 2000) : null;
  }
  if (patch.alertEmails !== undefined) {
    row.safety_alert_emails = asEmailList(patch.alertEmails);
  }
  if (patch.wellnessCheckEnabled !== undefined) {
    row.wellness_check_enabled = Boolean(patch.wellnessCheckEnabled);
  }
  if (patch.wellnessNoMotionSeconds !== undefined) {
    row.wellness_no_motion_seconds = clampInt(
      patch.wellnessNoMotionSeconds,
      WELLNESS_DEFAULT_NO_MOTION_SECONDS,
      60,
      7200,
    );
  }
  if (patch.wellnessCriticalAfterSeconds !== undefined) {
    row.wellness_critical_after_seconds = clampInt(
      patch.wellnessCriticalAfterSeconds,
      WELLNESS_DEFAULT_CRITICAL_AFTER_SECONDS,
      60,
      14400,
    );
  }
  if (patch.wellnessRequireAlone !== undefined) {
    row.wellness_require_alone = Boolean(patch.wellnessRequireAlone);
  }
  if (patch.liveSafetyEnabled !== undefined) {
    row.safety_live_enabled = Boolean(patch.liveSafetyEnabled);
  }
  if (patch.alertPhones !== undefined) {
    const bad = (patch.alertPhones ?? []).find((p) => isEmergencyServiceNumber(p));
    if (bad) {
      throw Object.assign(new Error('Atmosphere never texts or calls emergency services. Remove that number.'), {
        code: 'emergency_number_refused',
      });
    }
    row.safety_alert_phones = asPhoneList(patch.alertPhones);
  }
  if (patch.escalateAfterSeconds !== undefined) {
    row.safety_escalate_after_seconds = clampInt(patch.escalateAfterSeconds, 90, 30, 1800);
  }
  if (Object.keys(row).length) {
    const { error } = await admin.from('orgs').update(row).eq('id', orgId);
    if (error) throw new Error(error.message);
  }
  return loadOrgSafetySettings(admin, orgId);
}
