const KEY = 'atmosphere-internal-staff-email';

export function readRememberedStaffEmail(): string {
  if (typeof localStorage === 'undefined') return '';
  try {
    return localStorage.getItem(KEY)?.trim().toLowerCase() ?? '';
  } catch {
    return '';
  }
}

export function rememberStaffEmail(email: string): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(KEY, email.trim().toLowerCase());
  } catch {
    /* private mode */
  }
}

export function forgetStaffEmail(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* private mode */
  }
}
