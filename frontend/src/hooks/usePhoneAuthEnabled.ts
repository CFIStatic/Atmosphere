import { useEffect, useState } from 'react';
import { api } from '../lib/api';

/** Whether this deployment offers phone sign-in. Hidden until the server says yes. */
export function usePhoneAuthEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let cancelled = false;
    // Optional on older servers and in tests that stub the API.
    const load = typeof api.phoneAuthConfig === 'function' ? api.phoneAuthConfig() : null;
    Promise.resolve(load)
      .then((r) => {
        if (!cancelled) setEnabled(Boolean(r?.enabled));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return enabled;
}
