/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  WELLNESS_DEFAULT_CRITICAL_AFTER_SECONDS,
  WELLNESS_DEFAULT_NO_MOTION_SECONDS,
  type OrgSafetySettings,
} from './types.js';

function clampInt(raw: unknown, fallback: number, min: number, max: number): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function defaults(orgId: string): OrgSafetySettings {
  return {
    orgId,
    autoEscalateToAuthorities: false,
    wellnessCheckEnabled: true,
    wellnessNoMotionSeconds: WELLNESS_DEFAULT_NO_MOTION_SECONDS,
    wellnessCriticalAfterSeconds: WELLNESS_DEFAULT_CRITICAL_AFTER_SECONDS,
    wellnessRequireAlone: true,
    liveSafetyEnabled: true,
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
      'id, safety_auto_escalate_to_authorities, ' +
        'wellness_check_enabled, wellness_no_motion_seconds, wellness_critical_after_seconds, ' +
        'wellness_require_alone, safety_live_enabled',
    )
    .eq('id', orgId)
    .maybeSingle();

  if (error || !data) {
    // Missing columns (pre-migration) or missing org → safe defaults
    // (critical live safety stays ON by default).
    if (error && /safety_live_enabled/.test(error.message ?? '')) {
      return loadLegacyOrgSafetySettings(admin, orgId);
    }
    return defaults(orgId);
  }

  return normalizeWellness({
    orgId,
    autoEscalateToAuthorities: data.safety_auto_escalate_to_authorities === true,
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
  });
}

/** Before the live-safety migration lands: read the older columns only. */
async function loadLegacyOrgSafetySettings(admin: any, orgId: string): Promise<OrgSafetySettings> {
  const { data, error } = await admin
    .from('orgs')
    .select('id, safety_auto_escalate_to_authorities')
    .eq('id', orgId)
    .maybeSingle();
  const base = defaults(orgId);
  if (error || !data) return base;
  return {
    ...base,
    autoEscalateToAuthorities: data.safety_auto_escalate_to_authorities === true,
  };
}

export async function updateOrgSafetySettings(
  admin: any,
  orgId: string,
  patch: {
    autoEscalateToAuthorities?: boolean;
    wellnessCheckEnabled?: boolean;
    wellnessNoMotionSeconds?: number;
    wellnessCriticalAfterSeconds?: number;
    wellnessRequireAlone?: boolean;
    liveSafetyEnabled?: boolean;
  },
): Promise<OrgSafetySettings> {
  const row: Record<string, unknown> = {};
  if (patch.autoEscalateToAuthorities !== undefined) {
    row.safety_auto_escalate_to_authorities = Boolean(patch.autoEscalateToAuthorities);
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
  if (Object.keys(row).length) {
    const { error } = await admin.from('orgs').update(row).eq('id', orgId);
    if (error) throw new Error(error.message);
  }
  return loadOrgSafetySettings(admin, orgId);
}
