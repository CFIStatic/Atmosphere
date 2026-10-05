/**
 * Twilio SMS for Chat (e.g. text the adjuster a status request).
 *
 * Env (set on the host; not applied here): TWILIO_ACCOUNT_SID,
 * TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER. Callers must get human approval
 * before sendSms — this module never bypasses that.
 */
export type SmsSendInput = {
  to: string;
  body: string;
  orgId?: string;
  jobId?: string | null;
};

export type SmsSendResult =
  | { ok: true; provider: 'twilio'; id: string }
  | { ok: false; reason: 'not_configured' | 'invalid_number' | 'provider_error'; message: string };

function twilioCreds(): { sid: string; token: string; from: string } | null {
  const sid = String(process.env.TWILIO_ACCOUNT_SID ?? '').trim();
  const token = String(process.env.TWILIO_AUTH_TOKEN ?? '').trim();
  const from = String(process.env.TWILIO_FROM_NUMBER ?? '').trim();
  if (!sid || !token || !from) return null;
  return { sid, token, from };
}

/** True when Twilio env vars are present for this deployment. */
export function smsProviderConfigured(): boolean {
  return twilioCreds() != null;
}

/** Normalize to E.164-ish digits for Twilio; US 10-digit → +1. */
export function normalizeSmsNumber(raw: string): string | null {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return null;
  const digits = trimmed.replace(/[^\d+]/g, '');
  const bare = digits.replace(/\D/g, '');
  if (digits.startsWith('+') && bare.length >= 8 && bare.length <= 15) return `+${bare}`;
  if (bare.length === 10) return `+1${bare}`;
  if (bare.length === 11 && bare.startsWith('1')) return `+${bare}`;
  if (bare.length >= 8 && bare.length <= 15) return `+${bare}`;
  return null;
}

/**
 * Send an SMS via Twilio. Refuses when not configured or the number is invalid.
 * Never call this until the person has approved the exact body in Chat.
 */
export async function sendSms(input: SmsSendInput): Promise<SmsSendResult> {
  const creds = twilioCreds();
  if (!creds) {
    return {
      ok: false,
      reason: 'not_configured',
      message:
        'SMS is not connected yet. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM_NUMBER on the server, then try again.',
    };
  }
  const to = normalizeSmsNumber(input.to);
  if (!to) {
    return { ok: false, reason: 'invalid_number', message: 'That phone number does not look valid.' };
  }
  const body = String(input.body ?? '').trim();
  if (!body) {
    return { ok: false, reason: 'invalid_number', message: 'The text body is empty.' };
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(creds.sid)}/Messages.json`;
  const auth = Buffer.from(`${creds.sid}:${creds.token}`).toString('base64');
  const form = new URLSearchParams({ To: to, From: creds.from, Body: body });

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    });
    const json = (await res.json().catch(() => ({}))) as { sid?: string; message?: string; error_message?: string };
    if (!res.ok) {
      const msg = String(json.message || json.error_message || `Twilio HTTP ${res.status}`).trim();
      return { ok: false, reason: 'provider_error', message: msg || 'Twilio could not send that text.' };
    }
    const id = String(json.sid ?? '').trim();
    if (!id) {
      return { ok: false, reason: 'provider_error', message: 'Twilio did not return a message id.' };
    }
    return { ok: true, provider: 'twilio', id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Twilio request failed';
    return { ok: false, reason: 'provider_error', message: msg };
  }
}
