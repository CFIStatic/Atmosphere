/**
 * Sticky A/B assignment for product experiments.
 *
 * Calls the BFF once per mount; the database keeps the variant sticky per user.
 * Failures are silent — the UI falls back to the control experience.
 */

import { useEffect, useState } from 'react';

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '';

export type ExperimentAssignment = {
  experimentKey: string;
  variantKey: string;
  sticky: boolean;
};

async function postJson<T>(path: string, body: unknown): Promise<T | null> {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      keepalive: true,
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export function useExperiment(experimentKey: string, enabled = true): {
  variantKey: string | null;
  loading: boolean;
  track: (eventName: string, props?: Record<string, unknown>) => void;
} {
  const [variantKey, setVariantKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(enabled);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void postJson<ExperimentAssignment>('/api/telemetry/experiment/assign', {
      experimentKey,
    }).then((assignment) => {
      if (cancelled) return;
      setVariantKey(assignment?.variantKey ?? null);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [experimentKey, enabled]);

  const track = (eventName: string, props?: Record<string, unknown>) => {
    void postJson('/api/telemetry/experiment/event', {
      experimentKey,
      eventName,
      props: props ?? {},
    });
  };

  return { variantKey, loading, track };
}
