/**
 * Data hooks for the analytics dashboards.
 *
 * On a range change the previous payload is HELD while the next one loads
 * (`isRefreshing`) instead of being replaced by a skeleton — a dashboard that
 * blanks out on every filter click is unreadable, and the layout jump costs more
 * than the wait.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  analyticsApi,
  AnalyticsError,
  type AnalyticsAccess,
  type OverviewPayload,
  type RangeParams,
} from '../lib/analyticsApi';
import { RANGE_PRESETS, type RangePresetKey } from '../components/analytics/ui';

const DAY_MS = 24 * 60 * 60 * 1000;

export function useAnalyticsAccess(): { access: AnalyticsAccess | null; loading: boolean } {
  const [access, setAccess] = useState<AnalyticsAccess | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    analyticsApi
      .access()
      .then((result) => {
        if (!cancelled) setAccess(result);
      })
      .catch(() => {
        // Not having access is a normal answer, not an error to surface.
        if (!cancelled) setAccess({ scope: null, displayName: null });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { access, loading };
}

export function useRange(initial: RangePresetKey = '12m') {
  const [preset, setPreset] = useState<RangePresetKey>(initial);

  const range = useMemo<RangeParams>(() => {
    const config = RANGE_PRESETS.find((p) => p.key === preset) ?? RANGE_PRESETS[2];
    const to = new Date();
    return { from: new Date(to.getTime() - config.days * DAY_MS), to, months: config.months };
  }, [preset]);

  return { preset, setPreset, range };
}

export function useOverview(range: RangeParams) {
  const [data, setData] = useState<OverviewPayload | null>(null);
  const [error, setError] = useState<AnalyticsError | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const id = ++requestId.current;
    setError(null);
    setRefreshing(true);

    try {
      const payload = await analyticsApi.overview(range);
      // A slow earlier request must not overwrite a newer result.
      if (id !== requestId.current) return;
      setData(payload);
    } catch (err) {
      if (id !== requestId.current) return;
      setError(
        err instanceof AnalyticsError
          ? err
          : new AnalyticsError(0, 'Something went wrong loading analytics.'),
      );
    } finally {
      if (id === requestId.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [range]);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, error, loading, refreshing, reload: load };
}
