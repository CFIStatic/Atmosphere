/**
 * Alert fanout for safety incidents: email (Resend/SMTP, every recipient in
 * parallel, with a live-view link) + optional webhook + optional SMS / voice
 * escalation (escalation.ts, disabled unless TWILIO_* is configured).
 * Web push: Platform has no web-push subscription infrastructure today, so
 * there is nothing to reuse; email + SMS are the out-of-app channels.
 * Pages are capped per job per hour (SAFETY_ALERT_CAP_PER_JOB_HOUR).
 *
 * Authorities escalation: when the incident recommends contact_authorities AND
 * the org has autoEscalateToAuthorities=true, the payload includes
 * escalateToAuthorities: true. Atmosphere does NOT call 911 or police APIs.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { sendSystemMail, systemMailConfigured } from '../lib/systemMail.js';
import { isGlobalAdmin } from '../lib/productRoles.js';
import { loadOrgSafetySettings } from './settings.js';
import { countRecentJobAlerts, markIncidentAlerted } from './incidents.js';
import { SAFETY_ALERT_CAP_PER_JOB_HOUR, type SafetyIncident } from './types.js';
import { publicAppOrigin } from '../lib/publicAppOrigin.js';
import { startSafetyEscalation } from './escalation.js';
import { safetyProviderOverrides } from './providers.js';

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
  /** Absolute Platform link to the job page with the office live view. */
  liveViewUrl: string;
  /** confirmed = model said real; unconfirmed = check the live view. */
  confirmation: 'confirmed' | 'unconfirmed' | null;
  /** real / joking / staged / media_playback / unclear (null = not checked). */
  reality: string | null;
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
    // The job file (Timeline → "Now") is where the office opens a live recording.
    liveViewUrl: `${safeOrigin()}${
      incident.jobId ? `/job-progress?job=${encodeURIComponent(incident.jobId)}&section=timeline` : '/'
    }`,
    confirmation: incident.confirmation ?? null,
    reality: incident.reality ?? null,
  };
}

function safeOrigin(): string {
  try {
    return publicAppOrigin();
  } catch {
    return 'https://platform.atmosphereteam.com';
  }
}

/** Subject line: unconfirmed alerts say so up front. */
export function safetyAlertSubject(incident: SafetyIncident, opts?: { upgraded?: boolean }): string {
  if (incident.confirmation === 'unconfirmed') {
    const what = incident.title.replace(/^Unconfirmed: check live view\s*[—-]\s*/i, '');
    return `[Atmosphere Safety] UNCONFIRMED — check live view: ${what}`;
  }
  const prefix = opts?.upgraded ? 'NOW CONFIRMED ' : '';
  return `[Atmosphere Safety] ${prefix}${incident.severity.toUpperCase()}: ${incident.title}`;
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
  const banner =
    payload.confirmation === 'unconfirmed'
      ? `<p style="margin:0 0 12px;padding:8px 10px;background:#fff4d6;border:1px solid #e0b100;border-radius:6px"><strong>Unconfirmed.</strong> The automatic check could not tell whether this is real. Open the live view now.</p>`
      : payload.confirmation === 'confirmed'
        ? `<p style="margin:0 0 12px;padding:8px 10px;background:#fde2e2;border:1px solid #d33;border-radius:6px"><strong>Confirmed by a second check</strong> (not a joke, act, or video playing).</p>`
        : '';
  return `<!doctype html><html><body style="font-family:system-ui,sans-serif;line-height:1.45;color:#111">
  <h2 style="margin:0 0 8px">Safety alert · ${escapeHtml(payload.severity)}</h2>
  ${banner}
  <p style="margin:0 0 12px"><strong>${escapeHtml(payload.title)}</strong></p>
  <p style="margin:0 0 16px"><a href="${escapeHtml(payload.liveViewUrl)}" style="display:inline-block;padding:10px 16px;background:#111;color:#fff;border-radius:8px;text-decoration:none">Open live view</a></p>
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
  <p style="font-size:13px">Acknowledge or dismiss (with a reason) in Platform: <a href="${escapeHtml(payload.liveViewUrl)}">${escapeHtml(payload.liveViewUrl)}</a></p>
  <p style="font-size:12px;color:#555">Atmosphere never calls 911. If someone is in danger, call emergency services yourself.</p>
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
  opts?: { upgraded?: boolean },
): Promise<{ channels: string[]; payload: SafetyAlertPayload; capped: boolean }> {
  const settings = await loadOrgSafetySettings(admin, incident.orgId);
  const payload = buildSafetyAlertPayload(incident, settings.autoEscalateToAuthorities);
  const channels: string[] = [];

  // Alert fatigue: past the per-job hourly cap the incident is still recorded
  // and shown in Platform, but nobody is paged again.
  const pagedThisHour = await countRecentJobAlerts(admin, { orgId: incident.orgId, jobId: incident.jobId });
  const capped = pagedThisHour >= SAFETY_ALERT_CAP_PER_JOB_HOUR;

  // Watch severity: still persist the incident, but only email on critical
  // unless a webhook is configured (ops may want all).
  const shouldEmail = incident.severity === 'critical' && !capped;
  const subject = safetyAlertSubject(incident, opts);
  const tasks: Array<Promise<void>> = [];
  const mailOverride = safetyProviderOverrides().sendMail;
  const send = mailOverride ?? sendSystemMail;
  if (shouldEmail && (mailOverride || systemMailConfigured())) {
    tasks.push(
      (async () => {
        const admins = await orgAdminEmails(admin, incident.orgId);
        const recipients = [...new Set([...admins, ...settings.alertEmails])].slice(0, 25);
        if (!recipients.length) return;
        const html = safetyEmailHtml(payload);
        const text = `${subject}\n\n${payload.title}\n\n${payload.description}\n\nLive view: ${payload.liveViewUrl}\n\nAction: ${payload.recommendedAction}\nEscalate flag: ${payload.escalateToAuthorities}\n\n${payload.authoritiesNote}`;
        // Every recipient at once — one slow mailbox never delays the next.
        const results = await Promise.allSettled(
          recipients.map((to) => send({ to, subject, html, text })),
        );
        for (const r of results) {
          if (r.status === 'rejected') {
            console.warn('[safety] email failed:', r.reason instanceof Error ? r.reason.message : r.reason);
          }
        }
        if (results.some((r) => r.status === 'fulfilled' && (r.value as any)?.ok)) channels.push('email');
      })(),
    );
  }

  if (settings.alertWebhookUrl) {
    tasks.push(
      postWebhook(settings.alertWebhookUrl, payload).then((ok) => {
        if (ok) channels.push('webhook');
      }),
    );
  }
  await Promise.all(tasks);

  // Always record an internal channel so Platform can show "alerted".
  channels.push('platform');
  if (capped) channels.push('capped');
  await markIncidentAlerted(admin, incident.id, channels);

  // SMS / voice ladder: disabled unless an SMS provider is configured
  // server-side AND the org listed phone numbers. Never 911. Not awaited.
  if (incident.severity === 'critical' && !capped) {
    startSafetyEscalation(admin, incident, settings, payload);
  }
  return { channels, payload, capped };
}
