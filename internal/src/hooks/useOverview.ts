import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, defaultRange } from '../lib/api';
import type { OverviewPayload } from '../lib/types';

export function useOverview() {
  const [data, setData] = useState<OverviewPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const range = useMemo(() => defaultRange(), []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.overview(range));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load overview');
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    let cancelled = false;
    api
      .overview(range)
      .then((next) => {
        if (!cancelled) {
          setData(next);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not load overview');
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [range]);

  return { data, error, loading, reload: load, range };
}
