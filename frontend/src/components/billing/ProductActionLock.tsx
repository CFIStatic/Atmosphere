import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from '../../lib/api';
import { billingStepHref } from '../../lib/firstRun';

/** True when this office still owes a plan. Missing billing calls stay unlocked. */
export function useProductActionsLocked(): boolean {
  const [locked, setLocked] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const load = api.getBillingOnboarding;
    if (typeof load !== 'function') return;
    load()
      .then((status) => {
        if (!cancelled) setLocked(Boolean(status?.required && !status?.complete));
      })
      .catch(() => {
        if (!cancelled) setLocked(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return locked;
}

export function UpgradePrompt() {
  const location = useLocation();
  const next = `${location.pathname}${location.search}`;
  return (
    <p className="text-sm text-ink-700" data-testid="upgrade-prompt">
      Choose a plan to upload, record, share, or invite.{' '}
      <a href={billingStepHref(next)} className="font-semibold text-brand-700 hover:text-brand-800">
        Choose a plan
      </a>
    </p>
  );
}
