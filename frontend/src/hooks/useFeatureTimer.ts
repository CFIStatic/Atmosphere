/**
 * Measures how long someone actually spends in a tool.
 *
 * "Time spent" is easy to overstate, and an overstated engagement number is
 * worse than none — it makes a neglected feature look loved. Three rules keep it
 * honest:
 *
 *  1. Only the FOREGROUND counts. A backgrounded tab stops accumulating the
 *     moment `visibilitychange` fires.
 *  2. Idle time is not usage. After five minutes without a pointer, key or
 *     scroll event the timer pauses itself and resumes on the next interaction.
 *  3. The client is never trusted. Deltas are bounded here, bounded again in the
 *     API, and clamped a third time inside the database function.
 */

import { useEffect, useRef } from 'react';
import { sendHeartbeat } from '../lib/analyticsApi';

const FLUSH_INTERVAL_MS = 30_000;
const IDLE_AFTER_MS = 5 * 60_000;
/** Below this, a flush is not worth a request. */
const MIN_FLUSH_MS = 5_000;

export function useFeatureTimer(featureKey: string, enabled = true): void {
  const sessionId = useRef<string | null>(null);
  const activeSince = useRef<number | null>(null);
  const pendingMs = useRef(0);
  const interactions = useRef(0);
  const lastInteraction = useRef(Date.now());
  const inFlight = useRef(false);

  useEffect(() => {
    if (!enabled) return;

    // A remount for the same feature starts a fresh session rather than
    // resuming a stale one.
    sessionId.current = null;
    pendingMs.current = 0;
    interactions.current = 0;
    lastInteraction.current = Date.now();
    activeSince.current = document.visibilityState === 'visible' ? Date.now() : null;

    /** Move elapsed foreground time into the pending bucket. */
    const accumulate = () => {
      if (activeSince.current === null) return;
      const now = Date.now();
      const idleFor = now - lastInteraction.current;

      if (idleFor > IDLE_AFTER_MS) {
        // Credit up to the point the user went quiet, then pause.
        const creditUntil = lastInteraction.current + IDLE_AFTER_MS;
        pendingMs.current += Math.max(0, creditUntil - activeSince.current);
        activeSince.current = null;
        return;
      }

      pendingMs.current += Math.max(0, now - activeSince.current);
      activeSince.current = now;
    };

    const flush = async (final = false) => {
      accumulate();
      const delta = Math.round(pendingMs.current);
      if (delta < MIN_FLUSH_MS && !final) return;
      if (delta === 0 && sessionId.current !== null) return;
      if (inFlight.current && !final) return;

      pendingMs.current = 0;
      const sent = interactions.current;
      interactions.current = 0;
      inFlight.current = true;

      const id = await sendHeartbeat({
        featureKey,
        sessionId: sessionId.current,
        // The database caps a single delta at five minutes; sending more would
        // silently discard the excess, so cap it here too.
        deltaMs: Math.min(delta, 300_000),
        interactions: Math.min(sent, 1000),
      });
      inFlight.current = false;
      if (id) sessionId.current = id;
    };

    const noteInteraction = () => {
      lastInteraction.current = Date.now();
      interactions.current += 1;
      // Resume after an idle pause.
      if (activeSince.current === null && document.visibilityState === 'visible') {
        activeSince.current = Date.now();
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        lastInteraction.current = Date.now();
        activeSince.current = Date.now();
      } else {
        void flush(true);
        activeSince.current = null;
      }
    };

    const onPageHide = () => {
      void flush(true);
    };

    const timer = window.setInterval(() => void flush(), FLUSH_INTERVAL_MS);

    const interactionEvents = ['pointerdown', 'keydown', 'scroll', 'wheel'] as const;
    interactionEvents.forEach((event) =>
      window.addEventListener(event, noteInteraction, { passive: true }),
    );
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);

    return () => {
      window.clearInterval(timer);
      interactionEvents.forEach((event) => window.removeEventListener(event, noteInteraction));
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      void flush(true);
    };
  }, [featureKey, enabled]);
}
