import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';

/**
 * Sharing this device's position with the rest of the crew.
 *
 * Built on `navigator.geolocation.watchPosition`, which means the browser's
 * own permission prompt sits in front of it and the operating system shows its
 * own indicator while it runs. Both are good: this is not a capability that
 * should be possible to acquire quietly, and the platform's own signals are
 * more trustworthy than anything this app draws.
 *
 * Three deliberate choices about how it behaves:
 *
 *   It only starts when the person has said yes on the server too. Browser
 *   permission and the org-level opt-in are different things — somebody can
 *   have granted the site location access last month for something else — and
 *   sharing with colleagues requires the second, explicit one.
 *
 *   It throttles. A phone in a moving truck fires this every second or two,
 *   and a position that precise is not more useful for "who is closest" while
 *   being a great deal more revealing about a route.
 *
 *   It stops cleanly. A watch left running after somebody switches sharing off
 *   would keep the OS indicator lit and keep sending, and both would be a
 *   breach of what they were told.
 */

export interface LiveLocationState {
  /** The server-side decision. Browser permission is separate. */
  sharing: boolean;
  /** True while a watch is actually running. */
  active: boolean;
  /** The last fix, for the indicator. */
  lastFix: { lat: number; lon: number; accuracyM: number | null; at: string } | null;
  /** Set when the browser refused or could not get a fix. */
  error: string | null;
  loading: boolean;
}

/** How often a position is actually sent, whatever the device offers. */
const MIN_INTERVAL_MS = 20_000;

/** A fix this coarse is not worth sending — it would be a wrong dot on a map. */
const MAX_USEFUL_ACCURACY_M = 2_000;

export function useLiveLocation() {
  const [state, setState] = useState<LiveLocationState>({
    sharing: false,
    active: false,
    lastFix: null,
    error: null,
    loading: true,
  });

  const watchId = useRef<number | null>(null);
  const lastSent = useRef(0);

  const stopWatch = useCallback(() => {
    if (watchId.current !== null) {
      navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
    }
    setState((s) => ({ ...s, active: false }));
  }, []);

  const startWatch = useCallback(() => {
    if (watchId.current !== null) return;
    if (!('geolocation' in navigator)) {
      setState((s) => ({ ...s, error: 'This device cannot report its location.' }));
      return;
    }

    watchId.current = navigator.geolocation.watchPosition(
      (position) => {
        const { latitude, longitude, accuracy, heading, speed } = position.coords;

        setState((s) => ({
          ...s,
          active: true,
          error: null,
          lastFix: {
            lat: latitude,
            lon: longitude,
            accuracyM: accuracy ?? null,
            at: new Date().toISOString(),
          },
        }));

        // A fix accurate to two kilometres would draw a confident dot in the
        // wrong place, which is worse than no dot.
        if (typeof accuracy === 'number' && accuracy > MAX_USEFUL_ACCURACY_M) return;

        const now = Date.now();
        if (now - lastSent.current < MIN_INTERVAL_MS) return;
        lastSent.current = now;

        void api
          .pingLocation({
            lat: latitude,
            lon: longitude,
            accuracy: accuracy ?? null,
            heading: typeof heading === 'number' && !Number.isNaN(heading) ? heading : null,
            speed: typeof speed === 'number' && !Number.isNaN(speed) ? speed : null,
          })
          .then((res) => {
            // The server refuses when consent has been withdrawn — including
            // from another device — so this is how a watch learns to stop.
            if (!res.recorded) {
              stopWatch();
              setState((s) => ({ ...s, sharing: false }));
            }
          })
          .catch(() => {
            /* a dropped ping is not worth interrupting somebody's day over */
          });
      },
      (err) => {
        setState((s) => ({
          ...s,
          active: false,
          error:
            err.code === err.PERMISSION_DENIED
              ? 'Location is blocked for this site. Allow it in your browser settings to share.'
              : 'Could not get a location fix.',
        }));
      },
      { enableHighAccuracy: true, maximumAge: 15_000, timeout: 30_000 },
    );
  }, [stopWatch]);

  // What the server thinks, on mount.
  useEffect(() => {
    let live = true;
    api
      .locationSharing()
      .then((res) => {
        if (!live) return;
        setState((s) => ({ ...s, sharing: res.sharing, loading: false }));
      })
      .catch(() => {
        if (live) setState((s) => ({ ...s, loading: false }));
      });
    return () => {
      live = false;
    };
  }, []);

  // Start and stop with the decision, and always stop on unmount — a watch
  // outliving the page keeps the OS indicator lit for no reason.
  useEffect(() => {
    if (state.sharing) startWatch();
    else stopWatch();
    return stopWatch;
  }, [state.sharing, startWatch, stopWatch]);

  const setSharing = useCallback(
    async (next: boolean) => {
      setState((s) => ({ ...s, error: null }));
      try {
        const res = await api.setLocationSharing(next);
        setState((s) => ({ ...s, sharing: res.sharing }));
        return res;
      } catch (err) {
        setState((s) => ({
          ...s,
          error: err instanceof Error ? err.message : 'Could not change that.',
        }));
        return null;
      }
    },
    [],
  );

  return { ...state, setSharing };
}
