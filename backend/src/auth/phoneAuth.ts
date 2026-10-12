/**
 * Phone-number sign-in (one-time SMS code, no password).
 *
 * Supabase Auth owns the code: signInWithOtp({ phone }) texts it through the
 * SMS provider configured in Supabase (Twilio), and verifyOtp returns a normal
 * session. This module only adds what Supabase does not: a feature flag,
 * strict E.164 normalization (US default), and a per-number send throttle so
 * one number cannot be texted in a loop from many IPs.
 *
 * Env: PHONE_AUTH_ENABLED=true turns the option on. Off by default, so the
 * UI never offers a sign-in path that cannot deliver a code.
 */

export function phoneAuthEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.PHONE_AUTH_ENABLED ?? '').trim().toLowerCase() === 'true';
}

/**
 * E.164 with a US default. "(312) 555-0100", "312.555.0100", "1 312 555 0100"
 * and "+13125550100" all become "+13125550100". International numbers need
 * a leading "+". Returns null for anything that cannot be a real number.
 */
export function normalizePhoneE164(raw: string | null | undefined): string | null {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return null;
  if (/[a-z]/i.test(trimmed.replace(/\s*(ext\.?|x)\s*\d+$/i, ''))) return null;
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  if (hasPlus) {
    if (digits.startsWith('1')) return usNumber(digits.slice(1));
    if (digits.length < 8 || digits.length > 15 || digits.startsWith('0')) return null;
    return `+${digits}`;
  }
  if (digits.length === 10) return usNumber(digits);
  if (digits.length === 11 && digits.startsWith('1')) return usNumber(digits.slice(1));
  return null;
}

/** NANP: area code and exchange cannot start with 0 or 1. */
function usNumber(ten: string): string | null {
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(ten)) return null;
  return `+1${ten}`;
}

/** Supabase stores auth.users.phone without the "+". Compare in E.164. */
export function authPhoneToE164(phone: string | null | undefined): string | null {
  const bare = String(phone ?? '').replace(/\D/g, '');
  return bare ? `+${bare}` : null;
}

/** "+13125550100" → "(312) 555-0100"; other countries stay in E.164. */
export function formatPhoneForDisplay(e164: string | null | undefined): string {
  const value = authPhoneToE164(e164);
  if (!value) return '';
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(value);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : value;
}

/** Account label for people without an email: their phone number. */
export function accountLabel(user: { email?: string | null; phone?: string | null }): string {
  const email = String(user.email ?? '').trim();
  return email || formatPhoneForDisplay(user.phone) || 'Account';
}

export type ThrottleVerdict = { ok: true } | { ok: false; retryAfterSeconds: number };

/**
 * Per-number send throttle: one code every 30 s, at most 5 an hour.
 * In-memory is enough here: Supabase also limits OTP sends per project, and
 * this only has to stop one instance from texting a number on a loop.
 */
export function createOtpThrottle(opts: { minGapMs?: number; windowMs?: number; maxPerWindow?: number } = {}) {
  const minGap = opts.minGapMs ?? 30_000;
  const windowMs = opts.windowMs ?? 60 * 60 * 1000;
  const max = opts.maxPerWindow ?? 5;
  const sends = new Map<string, number[]>();

  return {
    check(phone: string, now = Date.now()): ThrottleVerdict {
      const recent = (sends.get(phone) ?? []).filter((t) => now - t < windowMs);
      sends.set(phone, recent);
      const last = recent[recent.length - 1];
      if (last !== undefined && now - last < minGap) {
        return { ok: false, retryAfterSeconds: Math.ceil((minGap - (now - last)) / 1000) };
      }
      if (recent.length >= max) {
        return { ok: false, retryAfterSeconds: Math.ceil((windowMs - (now - recent[0])) / 1000) };
      }
      return { ok: true };
    },
    record(phone: string, now = Date.now()): void {
      const recent = (sends.get(phone) ?? []).filter((t) => now - t < windowMs);
      recent.push(now);
      sends.set(phone, recent);
    },
  };
}

/** Text for a crew/team invite sent by phone. Kept short: one SMS segment where possible. */
export function orgInviteSms(input: { orgName: string; inviterName?: string | null; link: string }): string {
  const org = input.orgName.trim() || 'your team';
  const who = input.inviterName?.trim();
  return `${who ? `${who} invited you` : 'You are invited'} to join ${org} on Atmosphere. Open ${input.link} and sign in with this number. We will text you a 6-digit code.`;
}

/** Text for a sub or homeowner invited to one job by phone. */
export function jobInviteSms(input: { orgName: string; jobTitle?: string | null; link: string }): string {
  const org = input.orgName.trim() || 'Your contractor';
  const job = input.jobTitle?.trim();
  return `${org} shared ${job ? `"${job}"` : 'a job'} with you on Atmosphere. Open ${input.link} and sign in with this number. We will text you a 6-digit code.`;
}
