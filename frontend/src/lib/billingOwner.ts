import { useEffect, useState } from 'react';
import { api } from './api';
import { getBillingOnboardingShared } from './billingOnboardingShared';

/**
 * Billing and Usage belong to the organization's owner: the account that
 * created it. The server answers 403 to everyone else; this only decides
 * whether to show the tab. null while loading, false on any failure.
 */
export function useIsOrgOwner(enabled = true): boolean | null {
  const [owner, setOwner] = useState<boolean | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    getBillingOnboardingShared(api.getBillingOnboarding)
      .then((status) => {
        if (!cancelled) setOwner(status.isCreator === true);
      })
      .catch(() => {
        if (!cancelled) setOwner(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return enabled ? owner : false;
}
