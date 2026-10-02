import { useCallback, useEffect, useRef, useState } from 'react';

interface ApiState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

/**
 * Load one API call. Re-runs when `deps` change or `reload()` is called;
 * responses from superseded runs are dropped.
 */
export function useApi<T>(load: () => Promise<T>, deps: unknown[] = []) {
  const [state, setState] = useState<ApiState<T>>({ data: null, error: null, loading: true });
  const [tick, setTick] = useState(0);
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });

  useEffect(() => {
    let cancelled = false;
    loadRef.current().then(
      (data) => {
        if (!cancelled) setState({ data, error: null, loading: false });
      },
      (err: unknown) => {
        if (!cancelled) {
          setState((prev) => ({
            data: prev.data,
            error: err instanceof Error ? err.message : 'Could not load this report',
            loading: false,
          }));
        }
      },
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, ...deps]);

  const reload = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    setTick((t) => t + 1);
  }, []);

  return { ...state, reload };
}
