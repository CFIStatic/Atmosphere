import { useEffect, useState } from 'react';
import { adminApi, type PlatformAccess } from '../lib/adminApi';

export function usePlatformAdminAccess(): { access: PlatformAccess | null; loading: boolean } {
  const [access, setAccess] = useState<PlatformAccess | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    adminApi
      .access()
      .then((result) => {
        if (!cancelled) setAccess(result);
      })
      .catch(() => {
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
