const DEMO_KEY = 'atmosphere.internal.demo';

export function isBuildDemo(): boolean {
  return import.meta.env.VITE_DEMO === '1';
}

export function isSessionDemo(): boolean {
  try {
    return sessionStorage.getItem(DEMO_KEY) === '1';
  } catch {
    return false;
  }
}

export function isDemoMode(): boolean {
  return isBuildDemo() || isSessionDemo();
}

export function enableSessionDemo(): void {
  try {
    sessionStorage.setItem(DEMO_KEY, '1');
  } catch {
    /* private mode */
  }
}

export function disableSessionDemo(): void {
  try {
    sessionStorage.removeItem(DEMO_KEY);
  } catch {
    /* private mode */
  }
}
