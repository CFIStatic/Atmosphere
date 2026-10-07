/**
 * "Include internal & test accounts" toggle (analytics audit 2026-10-07).
 *
 * Off by default: every report shows customers only. Jettx staff orgs,
 * TEST / demo orgs and comp accounts are left out until staff switch this on.
 * The choice is remembered per browser. The server ignores it for investors.
 */
export const INCLUDE_INTERNAL_STORAGE_KEY = 'atmosphere-analytics.include-internal';

let current: boolean | null = null;
const listeners = new Set<() => void>();

function read(): boolean {
  try {
    return window.localStorage.getItem(INCLUDE_INTERNAL_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function getIncludeInternal(): boolean {
  if (current === null) current = read();
  return current;
}

export function setIncludeInternal(value: boolean): void {
  current = value;
  try {
    window.localStorage.setItem(INCLUDE_INTERNAL_STORAGE_KEY, value ? '1' : '0');
  } catch {
    // Storage disabled: the choice lasts for this visit only.
  }
  listeners.forEach((fn) => fn());
}

export function onIncludeInternalChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Test helper: forget the cached value so the next read hits storage. */
export function resetIncludeInternalForTests(): void {
  current = null;
}

/** Query-string fragment ("&internal=1" or "") for report requests. */
export function internalParam(prefix: '&' | '?' = '&'): string {
  return getIncludeInternal() ? `${prefix}internal=1` : '';
}
