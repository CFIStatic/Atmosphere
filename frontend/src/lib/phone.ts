/**
 * Phone numbers for sign-in and invites: E.164 with a US default.
 * Mirrors backend/src/auth/phoneAuth.ts so the form can validate as you type.
 */

export function normalizePhoneE164(raw: string | null | undefined): string | null {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed || /[a-z]/i.test(trimmed)) return null;
  const digits = trimmed.replace(/\D/g, '');
  if (trimmed.startsWith('+')) {
    if (digits.startsWith('1')) return usNumber(digits.slice(1));
    if (digits.length < 8 || digits.length > 15 || digits.startsWith('0')) return null;
    return `+${digits}`;
  }
  if (digits.length === 10) return usNumber(digits);
  if (digits.length === 11 && digits.startsWith('1')) return usNumber(digits.slice(1));
  return null;
}

function usNumber(ten: string): string | null {
  return /^[2-9]\d{2}[2-9]\d{6}$/.test(ten) ? `+1${ten}` : null;
}

/** "+13125550100" → "(312) 555-0100"; other countries stay in E.164. */
export function formatPhone(value: string | null | undefined): string {
  const bare = String(value ?? '').replace(/\D/g, '');
  if (!bare) return '';
  const m = /^1(\d{3})(\d{3})(\d{4})$/.exec(bare);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : `+${bare}`;
}

/** Live formatting for a US number while typing; leaves "+…" input alone. */
export function formatPhoneInput(raw: string): string {
  if (raw.trim().startsWith('+')) return raw;
  const d = raw.replace(/\D/g, '').replace(/^1(?=\d{10})/, '').slice(0, 10);
  if (d.length < 4) return d;
  if (d.length < 7) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

/** What to show for an account: email, else the phone number. */
export function accountContact(user: { email?: string | null; phone?: string | null } | null | undefined): string {
  return user?.email?.trim() || formatPhone(user?.phone) || '';
}
