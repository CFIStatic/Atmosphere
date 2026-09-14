/* eslint-disable @typescript-eslint/no-explicit-any */
import type { OrgSafetySettings } from './types.js';

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

export async function loadOrgSafetySettings(
  admin: any,
  orgId: string,
): Promise<OrgSafetySettings> {
  const { data, error } = await admin
    .from('orgs')
    .select(
      'id, safety_auto_escalate_to_authorities, safety_alert_webhook_url, safety_alert_emails',
    )
    .eq('id', orgId)
    .maybeSingle();

  if (error || !data) {
    // Missing columns (pre-migration) or missing org → safe defaults.
    return {
      orgId,
      autoEscalateToAuthorities: false,
      alertWebhookUrl: null,
      alertEmails: [],
    };
  }

  const webhook =
    typeof data.safety_alert_webhook_url === 'string' &&
    data.safety_alert_webhook_url.trim().startsWith('http')
      ? data.safety_alert_webhook_url.trim().slice(0, 2000)
      : null;

  return {
    orgId,
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
  if (Object.keys(row).length) {
    const { error } = await admin.from('orgs').update(row).eq('id', orgId);
    if (error) throw new Error(error.message);
  }
  return loadOrgSafetySettings(admin, orgId);
}
