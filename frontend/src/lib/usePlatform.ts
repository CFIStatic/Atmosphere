import { useCallback, useSyncExternalStore } from 'react';
import { PLATFORM_IDS, type PlatformId } from './platforms';

/**
 * The active platform.
 *
 * It is device-local like the other preferences — which product someone works
 * in all day belongs to their machine, not their account — and it persists so
 * a field technician's phone opens on Field and the office desktop opens on
 * Operations. Navigating to a platform's home sets it; shared screens leave
 * it alone.
 */
const STORAGE_KEY = 'atmosphere.platform';
const DEFAULT: PlatformId = 'operations';

let current: PlatformId = DEFAULT;
const listeners = new Set<() => void>();

function isPlatformId(value: string | null): value is PlatformId {
  return value !== null && (PLATFORM_IDS as string[]).includes(value);
}

export function initPlatform(): void {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    // Sales and Manager used to be stored here. Those products are gone —
    // land on Verification rather than leaving the device stuck on a dead id.
    if (raw === 'sales' || raw === 'manager') {
      current = DEFAULT;
      window.localStorage.setItem(STORAGE_KEY, DEFAULT);
      return;
    }
    if (isPlatformId(raw)) current = raw;
  } catch {
    /* private mode: the default stands for this session */
  }
}

export function getPlatform(): PlatformId {
  return current;
}

export function setPlatform(next: PlatformId): void {
  if (current === next) return;
  current = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* the choice still applies for this session */
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function usePlatform(): [PlatformId, (next: PlatformId) => void] {
  const value = useSyncExternalStore(subscribe, getPlatform, () => DEFAULT);
  const set = useCallback((next: PlatformId) => setPlatform(next), []);
  return [value, set];
}
