/**
 * Alert fanout for safety incidents: EMAIL ONLY, to the account's admins —
 * active org members whose role is Global Admin (incl. the legacy
 * office_manager / owner / admin spellings) plus the org's creator (the
 * account owner) while they are an active member. Every admin is emailed in
 * parallel with a live-view link. No other recipients: no job parties, no
 * recording worker, no custom lists, no webhook, no SMS / voice. The worker's
 * phone is never told about an alert. Incidents also show in Platform.
 * Emails are capped per job per hour (SAFETY_ALERT_CAP_PER_JOB_HOUR).
 *
 * Authorities flag: when the incident recommends contact_authorities AND the
 * org has autoEscalateToAuthorities=true, the payload sets
 * escalateToAuthorities (internal; the email shows only plain-word fields).
 * Atmosphere does NOT call 911 or police APIs.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { sendSystemMail, systemMailConfigured } from '../lib/systemMail.js';
import { isGlobalAdmin } from '../lib/productRoles.js';
import { loadOrgSafetySettings } from './settings.js';
import { countRecentJobAlerts, markIncidentAlerted } from './incidents.js';
import {
  SAFETY_ALERT_CAP_PER_JOB_HOUR,
  type SafetyCategory,
  type SafetyIncident,
  type SafetyRecommendedAction,
} from './types.js';
import { publicAppOrigin } from '../lib/publicAppOrigin.js';
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
      ? 'Org policy autoEscalateToAuthorities is ON. Atmosphere does not call 911; decide yourself whether to call emergency services.'
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

/** Roles that make someone an account admin (Global Admin seat). */
function isAccountAdminRole(role: unknown): boolean {
  const r = typeof role === 'string' ? role.trim().toLowerCase() : '';
  // Historical owner / admin strings are Global Admin (see requireOrgRole).
  return r === 'owner' || r === 'admin' || isGlobalAdmin(r);
}

/**
 * The only people a safety alert emails: active members of the org with the
 * Global Admin role, plus the org's creator (account owner) when they are an
 * active member. Deduped, lowercased.
 */
export async function orgAdminEmails(admin: any, orgId: string): Promise<string[]> {
  const [{ data, error }, ownerRes] = await Promise.all([
    admin
      .from('org_members')
      .select('user_id, role, status, profiles(email)')
      .eq('org_id', orgId)
      .eq('status', 'active'),
    admin.from('orgs').select('created_by').eq('id', orgId).maybeSingle(),
  ]);
  if (error || !data) return [];
  const ownerId: string | null = ownerRes?.data?.created_by ?? null;
  const emails: string[] = [];
  const seen = new Set<string>();
  for (const row of data as any[]) {
    if (row.status !== 'active') continue;
    const isOwner = ownerId != null && row.user_id === ownerId;
    if (!isOwner && !isAccountAdminRole(row.role)) continue;
    const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
    const email = typeof profile?.email === 'string' ? profile.email.trim().toLowerCase() : '';
    if (!email || !email.includes('@') || seen.has(email)) continue;
    seen.add(email);
    emails.push(email);
  }
  return emails;
}

/** The alert email exactly as sent (subject, HTML, text). */
export function safetyAlertEmail(
  incident: SafetyIncident,
  payload: SafetyAlertPayload,
  opts?: { upgraded?: boolean },
): { subject: string; html: string; text: string } {
  const subject = safetyAlertSubject(incident, opts);
  return {
    subject,
    html: safetyEmailHtml(payload),
    text: [
      subject,
      '',
      payload.title,
      '',
      payload.description,
      '',
      ...emailDetails(payload).map(([k, v]) => `${k}: ${v}`),
      '',
      `Open live view: ${payload.liveViewUrl}`,
      `Acknowledge or dismiss (with a reason) in Platform: ${payload.liveViewUrl}`,
      '',
      'Atmosphere never calls 911. If someone is in danger, call emergency services yourself.',
    ].join('\n'),
  };
}

/** Plain-word labels for the email — every category and recommendation. */
export const SAFETY_CATEGORY_LABELS: Record<SafetyCategory, string> = {
  fall_person_down: 'Fall / person down',
  physical_violence: 'Physical violence',
  verbal_threat: 'Verbal threat',
  medical_distress: 'Medical distress',
  other_emergency: 'Other emergency',
  silent_panic_wellness: 'No movement (wellness check)',
};

export const SAFETY_ACTION_LABELS: Record<SafetyRecommendedAction, string> = {
  monitor: 'Keep an eye on it',
  dispatch_help: 'Send someone to help',
  contact_authorities: 'Contact authorities',
};

function plainLabel(map: Record<string, string>, code: string): string {
  return map[code] ?? code.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

/** 35 → "0:35"; 3725 → "1:02:05". */
export function formatRecordingTime(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

function emailDetails(payload: SafetyAlertPayload): Array<[string, string]> {
  const loc =
    payload.location.label ||
    (payload.location.lat != null && payload.location.lon != null
      ? `${payload.location.lat.toFixed(5)}, ${payload.location.lon.toFixed(5)}`
      : 'Unknown');
  return [
    ['Category', plainLabel(SAFETY_CATEGORY_LABELS, payload.category)],
    ['Confidence', `${(payload.confidence * 100).toFixed(0)}%`],
    [
      'Time in recording',
      payload.clipTimestampSeconds != null ? formatRecordingTime(payload.clipTimestampSeconds) : 'Unknown',
    ],
    ['Location', loc],
    ['Recommended', plainLabel(SAFETY_ACTION_LABELS, payload.recommendedAction)],
  ];
}

function safetyEmailHtml(payload: SafetyAlertPayload): string {
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
${emailDetails(payload)
  .map(([k, v]) => `    <li>${escapeHtml(k)}: ${escapeHtml(v)}</li>`)
  .join('\n')}
  </ul>
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

/**
 * Email the account admins about a newly created (or upgraded) incident.
 * Safe to call fire-and-forget. Rate-limit / dedup is handled at create time.
 */
export async function fanoutSafetyAlert(
  admin: any,
  incident: SafetyIncident,
  opts?: { upgraded?: boolean },
): Promise<{ channels: string[]; payload: SafetyAlertPayload; capped: boolean; recipients: string[] }> {
  const settings = await loadOrgSafetySettings(admin, incident.orgId);
  const payload = buildSafetyAlertPayload(incident, settings.autoEscalateToAuthorities);
  const channels: string[] = [];
  let recipients: string[] = [];

  // Alert fatigue: past the per-job hourly cap the incident is still recorded
  // and shown in Platform, but nobody is emailed again.
  const pagedThisHour = await countRecentJobAlerts(admin, { orgId: incident.orgId, jobId: incident.jobId });
  const capped = pagedThisHour >= SAFETY_ALERT_CAP_PER_JOB_HOUR;

  // Watch severity: persisted and shown in Platform; only critical is emailed.
  const shouldEmail = incident.severity === 'critical' && !capped;
  const mailOverride = safetyProviderOverrides().sendMail;
  const send = mailOverride ?? sendSystemMail;
  if (shouldEmail && (mailOverride || systemMailConfigured())) {
    recipients = (await orgAdminEmails(admin, incident.orgId)).slice(0, 25);
    if (recipients.length) {
      const { subject, html, text } = safetyAlertEmail(incident, payload, opts);
      // Every admin at once — one slow mailbox never delays the next.
      const results = await Promise.allSettled(
        recipients.map((to) => send({ to, subject, html, text })),
      );
      for (const r of results) {
        if (r.status === 'rejected') {
          console.warn('[safety] email failed:', r.reason instanceof Error ? r.reason.message : r.reason);
        }
      }
      if (results.some((r) => r.status === 'fulfilled' && (r.value as any)?.ok)) channels.push('email');
    }
  }

  // Always record an internal channel so Platform can show "alerted".
  channels.push('platform');
  if (capped) channels.push('capped');
  await markIncidentAlerted(admin, incident.id, channels);
  return { channels, payload, capped, recipients };
}
