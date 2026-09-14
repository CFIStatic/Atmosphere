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
        'wellness_require_alone',
    )
    .eq('id', orgId)
    .maybeSingle();

  if (error || !data) {
    // Missing columns (pre-migration) or missing org → safe defaults.
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
  });
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
  if (Object.keys(row).length) {
    const { error } = await admin.from('orgs').update(row).eq('id', orgId);
    if (error) throw new Error(error.message);
  }
  return loadOrgSafetySettings(admin, orgId);
}
