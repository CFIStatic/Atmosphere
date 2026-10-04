/**
 * SMS / voice escalation for critical safety alerts, behind a provider
 * interface. DISABLED unless the server has an SMS provider configured
 * (TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_FROM_NUMBER) AND the org
 * listed phone numbers (orgs.safety_alert_phones). Voice calls additionally
 * need TWILIO_VOICE_ENABLED=true.
 *
 * Ladder (stops as soon as anyone acknowledges or dismisses in Platform):
 *   t=0                 SMS to the first number
 *   t=+N s (org setting) SMS to the next number, and a voice call to the first
 *   …                   until the list is exhausted
 *
 * Atmosphere NEVER texts or calls 911 / emergency numbers: the phone list
 * refuses them and the provider refuses them again at send time.
 * Timers live in this process: a restart drops the remaining steps (the
 * email + Platform alert already went out). See PR notes.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { isEmergencyServiceNumber } from './settings.js';
import { appendIncidentChannel, getSafetyIncident } from './incidents.js';
import type { OrgSafetySettings, SafetyIncident } from './types.js';

export interface SafetyCallProvider {
  readonly name: string;
  readonly voiceEnabled: boolean;
  sendSms(to: string, body: string): Promise<{ ok: boolean; id?: string | null }>;
  placeCall(to: string, message: string): Promise<{ ok: boolean; id?: string | null }>;
}

type FetchLike = (url: string, init: any) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>;

/** Env vars the Twilio provider needs. Nothing is created by Atmosphere. */
export const TWILIO_ENV_VARS = [
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'TWILIO_FROM_NUMBER',
  'TWILIO_VOICE_ENABLED',
] as const;

function xmlEscape(text: string): string {
  return text.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!);
}

export function twilioProviderFromEnv(
  env: Record<string, string | undefined> = process.env,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
): SafetyCallProvider | null {
  const sid = env.TWILIO_ACCOUNT_SID?.trim();
  const token = env.TWILIO_AUTH_TOKEN?.trim();
  const from = env.TWILIO_FROM_NUMBER?.trim();
  if (!sid || !token || !from) return null;
  const voiceEnabled = env.TWILIO_VOICE_ENABLED === 'true';
  const auth = `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`;
  const base = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}`;

  async function post(path: string, form: Record<string, string>) {
    const res = await fetchImpl(`${base}/${path}`, {
      method: 'POST',
      headers: { authorization: auth, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(10_000),
    });
    let id: string | null = null;
    try {
      id = (await res.json())?.sid ?? null;
    } catch {
      id = null;
    }
    // Never log the provider body: it can echo account details.
    return { ok: res.ok, id };
  }

  return {
    name: 'twilio',
    voiceEnabled,
    async sendSms(to, body) {
      if (isEmergencyServiceNumber(to)) return { ok: false };
      return post('Messages.json', { To: to, From: from, Body: body.slice(0, 640) });
    },
    async placeCall(to, message) {
      if (!voiceEnabled || isEmergencyServiceNumber(to)) return { ok: false };
      const twiml = `<Response><Say voice="alice">${xmlEscape(message)}</Say><Pause length="1"/><Say voice="alice">${xmlEscape(message)}</Say></Response>`;
      return post('Calls.json', { To: to, From: from, Twiml: twiml });
    },
  };
}

let providerOverride: SafetyCallProvider | null | undefined;

/** Tests inject a fake provider; production reads TWILIO_* from the env. */
export function setSafetyCallProviderForTests(provider: SafetyCallProvider | null | undefined): void {
  providerOverride = provider;
}

export function safetyCallProvider(): SafetyCallProvider | null {
  if (providerOverride !== undefined) return providerOverride;
  return twilioProviderFromEnv();
}

export function smsText(incident: SafetyIncident, liveViewUrl: string): string {
  const head =
    incident.confirmation === 'unconfirmed' ? 'Atmosphere UNCONFIRMED safety alert' : 'Atmosphere SAFETY ALERT';
  const what = incident.title.replace(/^Unconfirmed: check live view\s*[—-]\s*/i, '');
  return `${head}: ${what}. Live view: ${liveViewUrl} — acknowledge in Platform. Atmosphere does not call 911.`;
}

export type EscalationStep = { atMs: number; kind: 'sms' | 'voice'; to: string };

/** The ladder as data (exported for tests). */
export function escalationPlan(phones: string[], afterSeconds: number, voiceEnabled: boolean): EscalationStep[] {
  const steps: EscalationStep[] = [];
  const list = phones.filter((p) => !isEmergencyServiceNumber(p));
  list.forEach((phone, i) => {
    steps.push({ atMs: i * afterSeconds * 1000, kind: 'sms', to: phone });
  });
  if (voiceEnabled) {
    list.forEach((phone, i) => {
      steps.push({ atMs: (i + 1) * afterSeconds * 1000, kind: 'voice', to: phone });
    });
  }
  return steps.sort((a, b) => a.atMs - b.atMs);
}

/**
 * Kick off the ladder. Returns false when disabled (no provider or no phones).
 * Each later step first checks the incident is still open.
 */
export function startSafetyEscalation(
  admin: any,
  incident: SafetyIncident,
  settings: OrgSafetySettings,
  payload: { liveViewUrl: string },
  timers: { setTimeout: (fn: () => void, ms: number) => unknown } = { setTimeout },
): boolean {
  const provider = safetyCallProvider();
  if (!provider || !settings.alertPhones?.length) return false;
  const plan = escalationPlan(settings.alertPhones, settings.escalateAfterSeconds || 90, provider.voiceEnabled);
  const text = smsText(incident, payload.liveViewUrl);
  const voice = `Atmosphere safety alert. ${incident.title.replace(/^Unconfirmed: check live view\s*[—-]\s*/i, 'Unconfirmed: ')}. Open the live view in Platform. Atmosphere does not call nine one one.`;

  const runStep = async (step: EscalationStep) => {
    if (step.atMs > 0) {
      const current = await getSafetyIncident(admin, incident.id).catch(() => null);
      if (!current || current.status !== 'open') return;
    }
    try {
      const result = step.kind === 'sms' ? await provider.sendSms(step.to, text) : await provider.placeCall(step.to, voice);
      if (result.ok) await appendIncidentChannel(admin, incident.id, step.kind);
    } catch (err) {
      console.warn(`[safety] ${step.kind} escalation failed:`, err instanceof Error ? err.message : err);
    }
  };

  for (const step of plan) {
    if (step.atMs === 0) {
      void runStep(step);
    } else {
      const handle: any = timers.setTimeout(() => void runStep(step), step.atMs);
      if (handle && typeof handle.unref === 'function') handle.unref();
    }
  }
  return true;
}
