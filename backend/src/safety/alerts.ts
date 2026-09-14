/**
 * Alert fanout for safety incidents: email (Resend/SMTP) + optional webhook.
 *
 * Authorities escalation: when the incident recommends contact_authorities AND
 * the org has autoEscalateToAuthorities=true, the payload includes
 * escalateToAuthorities: true. Atmosphere does NOT call 911 or police APIs.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { sendSystemMail, systemMailConfigured } from '../lib/systemMail.js';
import { isGlobalAdmin } from '../lib/productRoles.js';
import { loadOrgSafetySettings } from './settings.js';
import { markIncidentAlerted } from './incidents.js';
import type { SafetyIncident } from './types.js';

export type SafetyAlertPayload = {
  type: 'atmosphere.safety_incident';
  incidentId: string;
  orgId: string;
  jobId: string | null;
  proofId: string | null;
  clipId: string | null;
  category: string;
  severity: string;
  confidence: number;
  title: string;
  description: string;
  clipTimestampSeconds: number | null;
  location: {
    lat: number | null;
    lon: number | null;
    label: string | null;
  };
  recommendedAction: string;
  /** True only when org policy allows AND recommendedAction is contact_authorities. */
  escalateToAuthorities: boolean;
  /**
   * Atmosphere never auto-dials emergency services. When escalateToAuthorities
   * is true, the org's external automation may act — still prefer human confirm.
   */
  authoritiesNote: string;
  source: string;
  createdAt: string;
  platformPath: string;
};

export function buildSafetyAlertPayload(
  incident: SafetyIncident,
  autoEscalate: boolean,
): SafetyAlertPayload {
  const escalate =
    autoEscalate && incident.recommendedAction === 'contact_authorities';
  return {
    type: 'atmosphere.safety_incident',
    incidentId: incident.id,
    orgId: incident.orgId,
    jobId: incident.jobId,
    proofId: incident.proofId,
    clipId: incident.clipId,
    category: incident.category,
    severity: incident.severity,
    confidence: incident.confidence,
    title: incident.title,
    description: incident.description,
    clipTimestampSeconds: incident.clipTimestampSeconds,
    location: {
      lat: incident.lat,
      lon: incident.lon,
      label: incident.locationLabel,
    },
    recommendedAction: incident.recommendedAction,
    escalateToAuthorities: escalate,
    authoritiesNote: escalate
      ? 'Org policy autoEscalateToAuthorities is ON. Atmosphere does not call 911; your webhook/ops runbook may escalate with human confirmation preferred.'
      : 'Authorities escalation is gated off (default). Set orgs.safety_auto_escalate_to_authorities=true to flag escalateToAuthorities on contact_authorities incidents. Atmosphere never dials 911.',
    source: incident.source,
    createdAt: incident.createdAt,
    platformPath: incident.jobId
      ? `/jobs/${incident.jobId}`
      : '/safety',
  };
}

async function orgAdminEmails(admin: any, orgId: string): Promise<string[]> {
  const { data, error } = await admin
    .from('org_members')
    .select('role, status, profiles(email)')
    .eq('org_id', orgId)
    .eq('status', 'active');
  if (error || !data) return [];
  const emails: string[] = [];
  const seen = new Set<string>();
  for (const row of data as any[]) {
    if (!isGlobalAdmin(row.role)) continue;
    const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
    const email = typeof profile?.email === 'string' ? profile.email.trim().toLowerCase() : '';
    if (!email || seen.has(email)) continue;
    seen.add(email);
    emails.push(email);
  }
  return emails;
}

function safetyEmailHtml(payload: SafetyAlertPayload): string {
  const loc =
    payload.location.label ||
    (payload.location.lat != null && payload.location.lon != null
      ? `${payload.location.lat.toFixed(5)}, ${payload.location.lon.toFixed(5)}`
      : 'Unknown location');
  const ts =
    payload.clipTimestampSeconds != null
      ? `${payload.clipTimestampSeconds}s into clip`
      : 'timestamp unknown';
  return `<!doctype html><html><body style="font-family:system-ui,sans-serif;line-height:1.45;color:#111">
  <h2 style="margin:0 0 8px">Safety alert · ${escapeHtml(payload.severity)}</h2>
  <p style="margin:0 0 12px"><strong>${escapeHtml(payload.title)}</strong></p>
  <p>${escapeHtml(payload.description)}</p>
  <ul>
    <li>Category: ${escapeHtml(payload.category)}</li>
    <li>Confidence: ${(payload.confidence * 100).toFixed(0)}%</li>
    <li>Clip: ${escapeHtml(ts)}</li>
    <li>Location: ${escapeHtml(loc)}</li>
    <li>Recommended: ${escapeHtml(payload.recommendedAction)}</li>
    <li>Escalate to authorities flag: ${payload.escalateToAuthorities ? 'YES (policy on — no auto-dial)' : 'no'}</li>
  </ul>
  <p style="color:#555;font-size:13px">${escapeHtml(payload.authoritiesNote)}</p>
  <p style="font-size:13px">Ack or dismiss in Platform · job ${escapeHtml(payload.jobId ?? 'n/a')}</p>
</body></html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function postWebhook(url: string, payload: SafetyAlertPayload): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'Atmosphere-SafetyAlerts/1.0',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8_000),
    });
    return res.ok;
  } catch (err) {
    console.warn('[safety] webhook failed:', err instanceof Error ? err.message : err);
    return false;
  }
}

/**
 * Fan out alerts for a newly created incident. Safe to call fire-and-forget.
 * Rate-limit / dedup is handled at create time.
 */
export async function fanoutSafetyAlert(
  admin: any,
  incident: SafetyIncident,
): Promise<{ channels: string[]; payload: SafetyAlertPayload }> {
  const settings = await loadOrgSafetySettings(admin, incident.orgId);
  const payload = buildSafetyAlertPayload(incident, settings.autoEscalateToAuthorities);
  const channels: string[] = [];

  // Watch severity: still persist the incident, but only email on critical
  // unless a webhook is configured (ops may want all).
  const shouldEmail = incident.severity === 'critical';
  if (shouldEmail && systemMailConfigured()) {
    const admins = await orgAdminEmails(admin, incident.orgId);
    const recipients = [...new Set([...admins, ...settings.alertEmails])].slice(0, 25);
    if (recipients.length) {
      let emailed = false;
      for (const to of recipients) {
        try {
          const result = await sendSystemMail({
            to,
            subject: `[Atmosphere Safety] ${incident.severity.toUpperCase()}: ${incident.title}`,
            html: safetyEmailHtml(payload),
            text: `${payload.title}\n\n${payload.description}\n\nAction: ${payload.recommendedAction}\nEscalate flag: ${payload.escalateToAuthorities}\n\n${payload.authoritiesNote}`,
          });
          if (result.ok) emailed = true;
        } catch (err) {
          console.warn('[safety] email failed:', err instanceof Error ? err.message : err);
        }
      }
      if (emailed) channels.push('email');
    }
  }

  if (settings.alertWebhookUrl) {
    const ok = await postWebhook(settings.alertWebhookUrl, payload);
    if (ok) channels.push('webhook');
  }

  // Always record an internal channel so Platform can show "alerted".
  channels.push('platform');
  await markIncidentAlerted(admin, incident.id, channels);
  return { channels, payload };
}
